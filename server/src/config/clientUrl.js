/** Public web app (Vercel). Used when CLIENT_URL is unset or still points at localhost. */
export const DEFAULT_PROD_CLIENT_URL = "https://bux-poker-puce.vercel.app";

function isLocalClientUrl(url) {
  if (!url) return true;
  try {
    const h = new URL(url).hostname.toLowerCase();
    return h === "localhost" || h === "127.0.0.1" || h === "[::1]";
  } catch {
    return true;
  }
}

/** Resolved site URL for Discord embeds, OAuth redirects, and copy shown to players. */
export function resolveClientUrl() {
  const fromEnv = String(process.env.CLIENT_URL || "").trim().replace(/\/+$/, "");
  if (fromEnv && !isLocalClientUrl(fromEnv)) {
    return fromEnv;
  }
  return DEFAULT_PROD_CLIENT_URL;
}

export function siteHostnameFromClientUrl(clientUrl) {
  try {
    return new URL(clientUrl).hostname.replace(/^www\./i, "");
  } catch {
    return new URL(DEFAULT_PROD_CLIENT_URL).hostname;
  }
}
