import type { AxiosInstance } from 'axios';

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

/**
 * Forces `baseURL` to same-origin on every request (runs in the browser). Build-time folding cannot
 * strip this, so production stays correct even if `VITE_API_BASE_URL` is baked to the Fly URL.
 */
export function enforceBuxPokerSameOriginApiBase(client: AxiosInstance): void {
  client.interceptors.request.use((config) => {
    if (typeof window !== 'undefined' && import.meta.env.PROD) {
      const h = window.location.hostname.toLowerCase();
      if (h === 'bux-poker.pro' || h === 'www.bux-poker.pro') {
        config.baseURL = '';
      }
    }
    return config;
  });
}
