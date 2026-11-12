/** Prefer gateways that actually serve NFT image CIDs (nftstorage.link often 403s). */
export const IPFS_GATEWAYS = [
  "https://ipfs.filebase.io/ipfs/",
  "https://ipfs.io/ipfs/",
  "https://dweb.link/ipfs/",
  "https://nftstorage.link/ipfs/",
  "https://w3s.link/ipfs/",
] as const;

/**
 * Extract `CID/...path` from ipfs:// or https://.../ipfs/... URLs.
 */
export function extractIpfsPath(url: string | null | undefined): string | null {
  if (!url) return null;
  const raw = String(url).trim();
  if (!raw) return null;
  if (raw.startsWith("ipfs://")) {
    return raw.slice("ipfs://".length).replace(/^ipfs\//, "");
  }
  const m = raw.match(/\/ipfs\/([^?#]+)/i);
  return m ? m[1] : null;
}

/** Rewrite IPFS / protocol-relative URLs to a browser-loadable https URL. */
export function normalizeNftImageUrl(
  url: string | null | undefined,
  gatewayIndex = 0
): string | null {
  if (!url) return null;
  let u = String(url).trim();
  if (!u) return null;
  if (u.startsWith("//")) u = `https:${u}`;

  const path = extractIpfsPath(u);
  if (path) {
    const gw = IPFS_GATEWAYS[Math.min(gatewayIndex, IPFS_GATEWAYS.length - 1)];
    return `${gw}${path}`;
  }
  return u;
}

export function nextIpfsGatewayUrl(
  url: string | null | undefined,
  failedSrc: string | null | undefined
): string | null {
  const path = extractIpfsPath(url) || extractIpfsPath(failedSrc);
  if (!path) return null;
  const failed = String(failedSrc || "");
  const currentIdx = IPFS_GATEWAYS.findIndex((g) => failed.startsWith(g));
  const nextIdx = currentIdx >= 0 ? currentIdx + 1 : 1;
  if (nextIdx >= IPFS_GATEWAYS.length) return null;
  return `${IPFS_GATEWAYS[nextIdx]}${path}`;
}
