/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_API_BASE_URL?: string;
  readonly VITE_SOCKET_URL?: string;
  /** Force Discord login to start on Render (or another host), e.g. https://bux-poker-server.onrender.com */
  readonly VITE_DISCORD_LOGIN_BASE_URL?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
