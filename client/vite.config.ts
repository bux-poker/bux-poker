import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import path from "path";

/** Dev-only: same URL as production so /bot-invite serves bot-invite.html (correct OG in prod). */
function botInvitePathPlugin() {
  return {
    name: "bot-invite-path",
    configureServer(server) {
      server.middlewares.use((req, _res, next) => {
        const raw = req.url ?? "";
        const pathname = raw.split("?")[0];
        if (pathname === "/bot-invite" || pathname === "/bot-invite/") {
          const qs = raw.includes("?") ? "?" + raw.slice(raw.indexOf("?") + 1) : "";
          req.url = "/bot-invite.html" + qs;
        }
        next();
      });
    },
  };
}

export default defineConfig({
  plugins: [react(), botInvitePathPlugin()],
  build: {
    rollupOptions: {
      input: {
        main: path.resolve(__dirname, "index.html"),
        botInvite: path.resolve(__dirname, "bot-invite.html"),
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

