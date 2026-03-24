// Import from our fixed generate path so the client is found on Render (prestart generates to server/.prisma/client)
import { PrismaClient } from '../../.prisma/client/index.js';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

// Load environment variables from server/.env
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
dotenv.config({ path: path.resolve(__dirname, '../../.env') });

/**
 * Prisma pool tuning: **append only** missing query params — never rewrite existing `connection_limit` /
 * `pool_timeout` in DATABASE_URL. Replacing values (e.g. 9→18) can break Supabase pooler (P1001, join-table fails).
 * To raise limits: edit DATABASE_URL on Render, or set PRISMA_CONNECTION_LIMIT / PRISMA_POOL_TIMEOUT when params are absent.
 */
function databaseUrlWithPoolDefaults() {
  let url = process.env.DATABASE_URL;
  if (!url || typeof url !== "string") return url;
  const limit = process.env.PRISMA_CONNECTION_LIMIT || "15";
  const timeout = process.env.PRISMA_POOL_TIMEOUT || "45";
  const parts = [];
  if (!/[?&]connection_limit=/i.test(url)) {
    parts.push(`connection_limit=${encodeURIComponent(String(limit))}`);
  }
  if (!/[?&]pool_timeout=/i.test(url)) {
    parts.push(`pool_timeout=${encodeURIComponent(String(timeout))}`);
  }
  if (parts.length === 0) return url;
  const sep = url.includes("?") ? "&" : "?";
  return `${url}${sep}${parts.join("&")}`;
}

const resolvedDatabaseUrl = databaseUrlWithPoolDefaults();
if (process.env.NODE_ENV === "production" && resolvedDatabaseUrl) {
  const lim = resolvedDatabaseUrl.match(/connection_limit=(\d+)/i);
  const to = resolvedDatabaseUrl.match(/pool_timeout=(\d+)/i);
  console.log(
    `[DB] Prisma pool: connection_limit=${lim?.[1] ?? "?"}, pool_timeout=${to?.[1] ?? "?"}`
  );
}

// Standard Prisma client — avoid undocumented __internal engine overrides (can break Prisma 5+ / 6+).
const prisma = new PrismaClient({
  log:
    process.env.NODE_ENV === "production"
      ? ["error"]
      : ["warn", "error"],
  datasources: {
    db: {
      url: resolvedDatabaseUrl,
    },
  },
});

// NOTE: Removed previous hard guard that forcibly blocked Game.status='FINISHED'.
// Game completion must be allowed so the lifecycle can progress correctly.

// Handle graceful shutdown
process.on('beforeExit', async () => {
  await prisma.$disconnect();
});

export { prisma };