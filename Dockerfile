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
EXPOSE 3000

# prestart runs migrations; then start (see server/package.json)
CMD ["npm", "start"]
