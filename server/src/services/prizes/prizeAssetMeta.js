/**
 * Resolve display metadata + USD price for prize assets (SPL / NFT / SOL).
 */

import { PublicKey } from "@solana/web3.js";
import { getSolanaConnection } from "./prizeFunding.js";

const jupiterCache = new Map(); // mint -> { at, data }
const assetCache = new Map();
const priceCache = new Map();
const TTL_MS = 10 * 60 * 1000;
const PRICE_TTL_MS = 60 * 1000;

function cacheGet(map, key, ttl = TTL_MS) {
  const hit = map.get(key);
  if (!hit) return null;
  if (Date.now() - hit.at > ttl) {
    map.delete(key);
    return null;
  }
  return hit.data;
}

function cacheSet(map, key, data) {
  map.set(key, { at: Date.now(), data });
}

async function fetchWithTimeout(url, options = {}, ms = 8000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), ms);
  try {
    return await fetch(url, { ...options, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

async function fetchJupiterToken(mint) {
  const cached = cacheGet(jupiterCache, mint);
  if (cached) return cached;
  // lite-api search is more reliable than tokens.jup.ag for newer mints
  try {
    const res = await fetchWithTimeout(
      `https://lite-api.jup.ag/tokens/v2/search?query=${encodeURIComponent(mint)}`,
      { headers: { Accept: "application/json" } }
    );
    if (res.ok) {
      const list = await res.json();
      const hit = Array.isArray(list)
        ? list.find((t) => String(t?.id || "").toLowerCase() === mint.toLowerCase()) || list[0]
        : null;
      if (hit && String(hit.id || "").toLowerCase() === mint.toLowerCase()) {
        const data = {
          name: hit.name || null,
          symbol: hit.symbol || null,
          image: hit.icon || hit.logoURI || null,
          decimals: typeof hit.decimals === "number" ? hit.decimals : null,
        };
        cacheSet(jupiterCache, mint, data);
        return data;
      }
    }
  } catch {
    /* fall through */
  }
  try {
    const res = await fetchWithTimeout(
      `https://tokens.jup.ag/token/${encodeURIComponent(mint)}`,
      { headers: { Accept: "application/json" } }
    );
    if (!res.ok) return null;
    const json = await res.json();
    const data = {
      name: json?.name || null,
      symbol: json?.symbol || null,
      image: json?.logoURI || json?.icon || null,
      decimals: typeof json?.decimals === "number" ? json.decimals : null,
    };
    cacheSet(jupiterCache, mint, data);
    return data;
  } catch {
    return null;
  }
}

async function fetchMintDecimalsOnChain(mint) {
  try {
    const connection = getSolanaConnection();
    const info = await connection.getParsedAccountInfo(new PublicKey(mint));
    const decimals = info?.value?.data?.parsed?.info?.decimals;
    return typeof decimals === "number" ? decimals : null;
  } catch {
    return null;
  }
}

/**
 * DexScreener: price + optional name/symbol/image from the richest pair.
 */
async function fetchDexScreenerToken(mint) {
  const cached = cacheGet(assetCache, `dex:${mint}`);
  if (cached) return cached;
  try {
    const res = await fetchWithTimeout(
      `https://api.dexscreener.com/latest/dex/tokens/${encodeURIComponent(mint)}`
    );
    if (!res.ok) return null;
    const json = await res.json();
    const pairs = Array.isArray(json?.pairs) ? json.pairs : [];
    if (!pairs.length) return null;
    const ranked = [...pairs].sort(
      (a, b) => Number(b?.liquidity?.usd || 0) - Number(a?.liquidity?.usd || 0)
    );
    const best = ranked[0];
    const base = best?.baseToken?.address?.toLowerCase() === mint.toLowerCase()
      ? best.baseToken
      : best?.quoteToken?.address?.toLowerCase() === mint.toLowerCase()
        ? best.quoteToken
        : best?.baseToken;
    const prices = ranked
      .map((p) => Number(p?.priceUsd))
      .filter((n) => Number.isFinite(n) && n > 0);
    const priceUsd = prices.sort((a, b) => b - a)[0] ?? null;
    const data = {
      name: base?.name || null,
      symbol: base?.symbol || null,
      image: best?.info?.imageUrl || null,
      priceUsd,
    };
    cacheSet(assetCache, `dex:${mint}`, data);
    if (priceUsd != null) cacheSet(priceCache, mint, priceUsd);
    return data;
  } catch {
    return null;
  }
}

async function fetchTokenPriceUsd(mint) {
  const cached = cacheGet(priceCache, mint, PRICE_TTL_MS);
  if (cached != null) return cached;
  const dex = await fetchDexScreenerToken(mint);
  if (dex?.priceUsd != null) return dex.priceUsd;
  try {
    const res = await fetchWithTimeout(
      `https://api.jup.ag/price/v2?ids=${encodeURIComponent(mint)}`,
      { headers: { Accept: "application/json" } }
    );
    if (res.ok) {
      const json = await res.json();
      const price = Number(json?.data?.[mint]?.price);
      if (Number.isFinite(price) && price > 0) {
        cacheSet(priceCache, mint, price);
        return price;
      }
    }
  } catch {
    /* ignore */
  }
  return null;
}

async function fetchSolPriceUsd() {
  const key = "So11111111111111111111111111111111111111112";
  return fetchTokenPriceUsd(key);
}

const ME_HEADERS = {
  Accept: "application/json",
  "User-Agent": "BUX-Poker/1.0 (+https://bux-poker.xyz)",
};

function lamportsOrSolToSol(n) {
  const v = Number(n);
  if (!Number.isFinite(v) || v <= 0) return null;
  // ME collection stats use lamports; token listing price is usually SOL
  return v > 1000 ? v / 1e9 : v;
}

/**
 * Magic Eden token metadata + listing price.
 * https://api-mainnet.magiceden.dev/v2/tokens/{mint}
 */
async function fetchMagicEdenToken(mint) {
  const cached = cacheGet(assetCache, `me:token:${mint}`);
  if (cached) return cached;
  try {
    const res = await fetchWithTimeout(
      `https://api-mainnet.magiceden.dev/v2/tokens/${encodeURIComponent(mint)}`,
      { headers: ME_HEADERS }
    );
    if (!res.ok) return null;
    const json = await res.json();
    if (!json || typeof json !== "object" || !Object.keys(json).length) {
      cacheSet(assetCache, `me:token:${mint}`, null);
      return null;
    }
    const listingSol =
      Number(json.price) > 0
        ? Number(json.price)
        : lamportsOrSolToSol(json?.priceInfo?.solPrice?.rawAmount);
    const data = {
      name: json.name || null,
      symbol: json.collection || json.collectionName || null,
      image: json.image || json.animationUrl || null,
      collectionSymbol: json.collection || null,
      collectionName: json.collectionName || null,
      listingSol: listingSol ?? null,
      source: "magiceden",
    };
    cacheSet(assetCache, `me:token:${mint}`, data);
    return data;
  } catch {
    return null;
  }
}

/**
 * Magic Eden collection floor (lamports) by collection symbol.
 */
async function fetchMagicEdenFloorSol(collectionSymbol) {
  if (!collectionSymbol) return null;
  const cached = cacheGet(priceCache, `me:floor:${collectionSymbol}`, PRICE_TTL_MS);
  if (cached != null) return cached;
  try {
    const res = await fetchWithTimeout(
      `https://api-mainnet.magiceden.dev/v2/collections/${encodeURIComponent(collectionSymbol)}/stats`,
      { headers: ME_HEADERS }
    );
    if (!res.ok) return null;
    const json = await res.json();
    const floorSol = lamportsOrSolToSol(json?.floorPrice);
    if (floorSol == null) return null;
    cacheSet(priceCache, `me:floor:${collectionSymbol}`, floorSol);
    return floorSol;
  } catch {
    return null;
  }
}

async function fetchDasAsset(mint) {
  const cached = cacheGet(assetCache, `das:${mint}`);
  if (cached) return cached;
  const rpc = process.env.SOLANA_RPC_URL;
  if (!rpc) return null;
  try {
    const res = await fetchWithTimeout(rpc, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: "bux-prize-meta",
        method: "getAsset",
        params: { id: mint },
      }),
    });
    if (!res.ok) return null;
    const json = await res.json();
    const result = json?.result;
    if (!result) return null;
    const content = result.content || {};
    const meta = content.metadata || {};
    const files = content.files || [];
    const image =
      content.links?.image ||
      files.find((f) => f?.uri)?.uri ||
      files.find((f) => f?.cdn_uri)?.cdn_uri ||
      null;
    const name = meta.name || result?.content?.metadata?.name || null;
    const collection =
      result.grouping?.find((g) => g.group_key === "collection")?.group_value ||
      null;
    const data = {
      name,
      symbol: meta.symbol || null,
      image,
      collection,
    };
    cacheSet(assetCache, `das:${mint}`, data);
    return data;
  } catch {
    return null;
  }
}

function parseNftNumber(name) {
  if (!name) return null;
  const m = String(name).match(/#\s*(\d+)\s*$/);
  return m ? m[1] : null;
}

/**
 * @param {{ kind: string, mint?: string }}
 */
export async function resolvePrizeAssetMeta({ kind, mint }) {
  const k = String(kind || "").toUpperCase();
  if (k === "SOL") {
    const priceUsd = await fetchSolPriceUsd();
    return {
      name: "Solana",
      symbol: "SOL",
      image: "/images/solana-sol.svg",
      number: null,
      decimals: 9,
      priceUsd: priceUsd ?? null,
      floorUsd: null,
    };
  }
  if (!mint) {
    return {
      name: null,
      symbol: null,
      image: null,
      number: null,
      decimals: null,
      priceUsd: null,
      floorUsd: null,
    };
  }

  if (k === "SPL") {
    const [jup, dex, onChainDecimals] = await Promise.all([
      fetchJupiterToken(mint),
      fetchDexScreenerToken(mint),
      fetchMintDecimalsOnChain(mint),
    ]);
    const decimals = jup?.decimals ?? onChainDecimals ?? null;
    const priceUsd = dex?.priceUsd ?? (await fetchTokenPriceUsd(mint));
    return {
      name: jup?.name || dex?.name || "Token",
      symbol: jup?.symbol || dex?.symbol || null,
      image: jup?.image || dex?.image || null,
      number: null,
      decimals,
      priceUsd: priceUsd ?? null,
      floorUsd: null,
    };
  }

  if (k === "NFT") {
    const me = await fetchMagicEdenToken(mint);
    if (me) {
      const floorSol =
        (await fetchMagicEdenFloorSol(me.collectionSymbol)) ?? me.listingSol;
      const solUsd = await fetchSolPriceUsd();
      const floorUsd =
        floorSol != null && solUsd != null ? floorSol * solUsd : null;
      return {
        name: me.name || me.collectionName || "NFT",
        symbol: me.collectionSymbol || me.symbol || null,
        image: me.image || null,
        number: parseNftNumber(me.name),
        decimals: 0,
        priceUsd: floorUsd,
        floorUsd,
        floorSol: floorSol ?? null,
        collectionName: me.collectionName || null,
        source: "magiceden",
        found: true,
      };
    }

    // Fallback: DAS / indexer when ME has no record yet
    const das = await fetchDasAsset(mint);
    if (das?.name || das?.image) {
      let floorSol = null;
      let floorUsd = null;
      // DAS collection is often a mint address; ME stats need a symbol — skip if unknown
      if (das.collection && !/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(das.collection)) {
        floorSol = await fetchMagicEdenFloorSol(das.collection);
        const solUsd = await fetchSolPriceUsd();
        if (floorSol != null && solUsd != null) floorUsd = floorSol * solUsd;
      }
      return {
        name: das.name || "NFT",
        symbol: das.symbol || null,
        image: das.image || null,
        number: parseNftNumber(das.name),
        decimals: 0,
        priceUsd: floorUsd,
        floorUsd,
        floorSol,
        collectionName: null,
        source: "das",
        found: true,
      };
    }

    return {
      name: null,
      symbol: null,
      image: null,
      number: null,
      decimals: 0,
      priceUsd: null,
      floorUsd: null,
      floorSol: null,
      collectionName: null,
      source: "magiceden",
      found: false,
      error: "NFT not found on Magic Eden — check the mint address",
    };
  }

  return {
    name: null,
    symbol: null,
    image: null,
    number: null,
    decimals: null,
    priceUsd: null,
    floorUsd: null,
  };
}
