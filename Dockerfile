# BUX Poker API — deploy with: fly deploy (from repo root)
# Expects prisma/ at repo root and server/ app; DATABASE_URL etc. via fly secrets.
FROM node:20-bookworm-slim

WORKDIR /app

COPY prisma ./prisma

COPY server/package.json server/package-lock.json ./server/
WORKDIR /app/server
RUN npm ci --omit=dev

COPY server ./

# Ensure client is generated (postinstall may have run before full COPY)
RUN npx prisma generate --schema=../prisma/schema.prisma

ENV NODE_ENV=production
# Fly sets PORT to match fly.toml internal_port; default avoids listening on 3000 by mistake.
ENV PORT=8080
EXPOSE 8080

# Migrations run in fly.toml [deploy].release_command — not here — so the HTTP server can bind before health checks.
CMD ["node", "--dns-result-order=ipv4first", "src/index.js"]
