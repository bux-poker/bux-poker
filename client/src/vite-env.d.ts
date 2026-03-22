/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_API_BASE_URL?: string;
  readonly VITE_SOCKET_URL?: string;
  /** Only if you must use Render for OAuth: https://bux-poker-server.onrender.com (avoid on Vercel prod) */
  readonly VITE_DISCORD_LOGIN_BASE_URL?: string;
  /** Set to "true" to use VITE_DISCORD_LOGIN_BASE_URL / Render even on bux-poker.pro */
  readonly VITE_FORCE_RENDER_DISCORD_OAUTH?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
