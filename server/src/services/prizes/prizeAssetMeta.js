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

async function fetchTokenPriceUsd(mint) {
  const cached = cacheGet(priceCache, mint, PRICE_TTL_MS);
  if (cached != null) return cached;
  // DexScreener first — no API key, reliable for SPL.
  try {
    const res = await fetchWithTimeout(
      `https://api.dexscreener.com/latest/dex/tokens/${encodeURIComponent(mint)}`
    );
    if (res.ok) {
      const json = await res.json();
      const pairs = Array.isArray(json?.pairs) ? json.pairs : [];
      const best = pairs
        .map((p) => Number(p?.priceUsd))
        .filter((n) => Number.isFinite(n) && n > 0)
        .sort((a, b) => b - a)[0];
      if (best != null) {
        cacheSet(priceCache, mint, best);
        return best;
      }
    }
  } catch {
    /* fall through */
  }
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

async function fetchDasAsset(mint) {
  const cached = cacheGet(assetCache, mint);
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
    cacheSet(assetCache, mint, data);
    return data;
  } catch {
    return null;
  }
}

async function fetchNftFloorUsd(collectionOrMint) {
  if (!collectionOrMint) return null;
  const cached = cacheGet(priceCache, `nft:${collectionOrMint}`, PRICE_TTL_MS);
  if (cached != null) return cached;
  try {
    // Magic Eden collection stats (collection symbol or address)
    const res = await fetchWithTimeout(
      `https://api-mainnet.magiceden.dev/v2/collections/${encodeURIComponent(collectionOrMint)}/stats`,
      { headers: { Accept: "application/json" } }
    );
    if (res.ok) {
      const json = await res.json();
      const floorSol = Number(json?.floorPrice);
      if (Number.isFinite(floorSol) && floorSol > 0) {
        // ME returns floor in lamports sometimes; if huge, treat as lamports
        const sol = floorSol > 1000 ? floorSol / 1e9 : floorSol;
        const solUsd = await fetchSolPriceUsd();
        if (solUsd) {
          const usd = sol * solUsd;
          cacheSet(priceCache, `nft:${collectionOrMint}`, usd);
          return usd;
        }
      }
    }
  } catch {
    /* ignore */
  }
  return null;
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
    const jup = await fetchJupiterToken(mint);
    let decimals = jup?.decimals ?? null;
    if (decimals == null) decimals = await fetchMintDecimalsOnChain(mint);
    const priceUsd = await fetchTokenPriceUsd(mint);
    return {
      name: jup?.name || "Token",
      symbol: jup?.symbol || null,
      image: jup?.image || null,
      number: null,
      decimals,
      priceUsd: priceUsd ?? null,
      floorUsd: null,
    };
  }

  if (k === "NFT") {
    const das = await fetchDasAsset(mint);
    if (das) {
      const floorUsd = await fetchNftFloorUsd(das.collection || mint);
      return {
        name: das.name || "NFT",
        symbol: das.symbol || null,
        image: das.image || null,
        number: parseNftNumber(das.name),
        decimals: 0,
        priceUsd: floorUsd,
        floorUsd,
      };
    }
    const jup = await fetchJupiterToken(mint);
    return {
      name: jup?.name || "NFT",
      symbol: jup?.symbol || null,
      image: jup?.image || null,
      number: parseNftNumber(jup?.name),
      decimals: 0,
      priceUsd: null,
      floorUsd: null,
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
