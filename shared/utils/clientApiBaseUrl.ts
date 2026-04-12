/**
 * On production bux-poker hosts, `/api` is proxied to Fly (Vercel rewrite). Use same-origin there
 * even when `VITE_API_BASE_URL` is still set to `https://bux-poker.fly.dev` from older deploy config.
 */
export function getClientApiBaseUrl(): string {
  const raw = import.meta.env.VITE_API_BASE_URL;
  const fromEnv =
    raw != null && String(raw).trim() !== '' ? String(raw).replace(/\/+$/, '') : '';

  if (typeof window === 'undefined') {
    return fromEnv;
  }
  if (import.meta.env.DEV) {
    return fromEnv;
  }

  const h = window.location.hostname.toLowerCase();
  if (h === 'bux-poker.pro' || h === 'www.bux-poker.pro') {
    return '';
  }

  return fromEnv;
}
