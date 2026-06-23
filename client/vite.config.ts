import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import path from "path";

/**
 * Vercel: Project → Settings → General → Root Directory must be `client` (this folder).
 * If the repo root is used as the Vercel root, the deployed JS will not match this config and
 * will omit shared/ code paths — e.g. same-origin `/api` fixes for bux-poker.pro.
 */

/** Dev-only: serve OG shell for /invite (matches Vercel rewrites). */
function invitePathPlugin() {
  return {
    name: "invite-path",
    configureServer(server) {
      server.middlewares.use((req, _res, next) => {
        const raw = req.url ?? "";
        const pathname = raw.split("?")[0];
        const qs = raw.includes("?") ? "?" + raw.slice(raw.indexOf("?") + 1) : "";
        if (
          pathname === "/invite" ||
          pathname === "/invite/" ||
          pathname === "/discord-bot" ||
          pathname === "/discord-bot/" ||
          pathname === "/bot-invite" ||
          pathname === "/bot-invite/"
        ) {
          req.url = "/invite.html" + qs;
        }
        next();
      });
    },
  };
}

export default defineConfig({
  plugins: [react(), invitePathPlugin()],
  build: {
    rollupOptions: {
      input: {
        main: path.resolve(__dirname, "index.html"),
        invite: path.resolve(__dirname, "invite.html"),
      },
    },
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "src"),
      "@shared": path.resolve(__dirname, "../shared"),
      react: path.resolve(__dirname, "node_modules/react"),
      "react-dom": path.resolve(__dirname, "node_modules/react-dom"),
      axios: path.resolve(__dirname, "node_modules/axios"),
      "@emoji-mart/react": path.resolve(__dirname, "node_modules/@emoji-mart/react"),
      "@emoji-mart/data": path.resolve(__dirname, "node_modules/@emoji-mart/data")
    }
  },
  server: {
    port: 5173,
    proxy: {
      "/api": {
        target: "http://localhost:3000",
        changeOrigin: true
      },
      "/socket.io": {
        target: "http://localhost:3000",
        ws: true
      }
    }
  }
});

