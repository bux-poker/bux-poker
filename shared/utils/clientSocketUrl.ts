const DEFAULT_PROD_SOCKET = "https://bux-poker.fly.dev";

function isLocalHostname(host: string): boolean {
  const h = host.split(":")[0]?.toLowerCase() || "";
  return h === "localhost" || h === "127.0.0.1" || h === "[::1]";
}

function isLocalEnvUrl(url: string): boolean {
  try {
    return isLocalHostname(new URL(url).hostname);
  } catch {
    return false;
  }
}

/**
 * Socket.IO must hit Fly directly (Vercel does not proxy websockets).
 * Ignore VITE_* values that point at localhost when the page is served from a real host —
 * common when Vercel env was copied from server/.env.
 */
export function getSocketServerUrl(): string {
  const fromSocket = String(import.meta.env.VITE_SOCKET_URL ?? "").trim();
  const fromApi = String(import.meta.env.VITE_API_BASE_URL ?? "").trim();
  const devFallback = "http://localhost:3000";

  if (typeof window === "undefined") {
    return (
      fromSocket ||
      fromApi ||
      (import.meta.env.PROD ? DEFAULT_PROD_SOCKET : devFallback)
    );
  }

  if (isLocalHostname(window.location.hostname)) {
    return fromSocket || fromApi || devFallback;
  }

  const candidate = fromSocket || fromApi;
  if (candidate && !isLocalEnvUrl(candidate)) {
    return candidate.replace(/\/+$/, "");
  }

  return DEFAULT_PROD_SOCKET;
}
