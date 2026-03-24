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
 * Append Prisma pool query params when missing so production isn't stuck at defaults like limit=9/timeout=10.
 * Override via DATABASE_URL or set PRISMA_CONNECTION_LIMIT / PRISMA_POOL_TIMEOUT on the host.
 */
function databaseUrlWithPoolDefaults() {
  let url = process.env.DATABASE_URL;
  if (!url || typeof url !== "string") return url;
  const hasLimit = /[?&]connection_limit=/i.test(url);
  const hasTimeout = /[?&]pool_timeout=/i.test(url);
  if (hasLimit && hasTimeout) return url;
  const limit =
    process.env.PRISMA_CONNECTION_LIMIT ||
    (hasLimit ? null : "15");
  const timeout =
    process.env.PRISMA_POOL_TIMEOUT ||
    (hasTimeout ? null : "30");
  const parts = [];
  if (!hasLimit && limit != null) {
    parts.push(`connection_limit=${encodeURIComponent(String(limit))}`);
  }
  if (!hasTimeout && timeout != null) {
    parts.push(`pool_timeout=${encodeURIComponent(String(timeout))}`);
  }
  if (parts.length === 0) return url;
  const sep = url.includes("?") ? "&" : "?";
  return `${url}${sep}${parts.join("&")}`;
}

// Standard Prisma client — avoid undocumented __internal engine overrides (can break Prisma 5+ / 6+).
const prisma = new PrismaClient({
  log:
    process.env.NODE_ENV === "production"
      ? ["error"]
      : ["warn", "error"],
  datasources: {
    db: {
      url: databaseUrlWithPoolDefaults(),
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