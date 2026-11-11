/**
 * Resolve display metadata for prize assets (SPL / NFT mints).
 * SOL is handled on the client with a static logo.
 */

const jupiterCache = new Map(); // mint -> { at, data }
const assetCache = new Map();
const TTL_MS = 10 * 60 * 1000;

function cacheGet(map, key) {
  const hit = map.get(key);
  if (!hit) return null;
  if (Date.now() - hit.at > TTL_MS) {
    map.delete(key);
    return null;
  }
  return hit.data;
}

function cacheSet(map, key, data) {
  map.set(key, { at: Date.now(), data });
}

async function fetchJupiterToken(mint) {
  const cached = cacheGet(jupiterCache, mint);
  if (cached) return cached;
  try {
    const res = await fetch(`https://tokens.jup.ag/token/${encodeURIComponent(mint)}`, {
      headers: { Accept: "application/json" },
    });
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

async function fetchDasAsset(mint) {
  const cached = cacheGet(assetCache, mint);
  if (cached) return cached;
  const rpc = process.env.SOLANA_RPC_URL;
  if (!rpc) return null;
  try {
    const res = await fetch(rpc, {
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
    // Prefer collection + name; fall back to raw name (often includes #123)
    const data = {
      name,
      symbol: meta.symbol || null,
      image,
      collection: result.grouping?.find((g) => g.group_key === "collection")?.group_value || null,
    };
    cacheSet(assetCache, mint, data);
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
 * @returns {Promise<{ name: string|null, symbol: string|null, image: string|null, number: string|null }>}
 */
export async function resolvePrizeAssetMeta({ kind, mint }) {
  const k = String(kind || "").toUpperCase();
  if (k === "SOL") {
    return {
      name: "Solana",
      symbol: "SOL",
      image: "/images/solana-sol.svg",
      number: null,
    };
  }
  if (!mint) {
    return { name: null, symbol: null, image: null, number: null };
  }

  if (k === "SPL") {
    const jup = await fetchJupiterToken(mint);
    return {
      name: jup?.name || "Token",
      symbol: jup?.symbol || null,
      image: jup?.image || null,
      number: null,
      decimals: jup?.decimals ?? null,
    };
  }

  if (k === "NFT") {
    const das = await fetchDasAsset(mint);
    if (das) {
      return {
        name: das.name || "NFT",
        symbol: das.symbol || null,
        image: das.image || null,
        number: parseNftNumber(das.name),
      };
    }
    // Soft fallback: Jupiter rarely has NFTs but harmless
    const jup = await fetchJupiterToken(mint);
    return {
      name: jup?.name || "NFT",
      symbol: jup?.symbol || null,
      image: jup?.image || null,
      number: parseNftNumber(jup?.name),
    };
  }

  return { name: null, symbol: null, image: null, number: null };
}
