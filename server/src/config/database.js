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
 * Prisma pool tuning. Logs showed production stuck at connection_limit=9 / pool_timeout=10 — too small
 * under socket + polls + consolidation. We **raise** low limits (replace in URL), not only append when absent.
 * Set PRISMA_CONNECTION_LIMIT / PRISMA_POOL_TIMEOUT on Render to override targets.
 */
function databaseUrlWithPoolDefaults() {
  let url = process.env.DATABASE_URL;
  if (!url || typeof url !== "string") return url;
  const targetLimit = Math.max(
    1,
    parseInt(process.env.PRISMA_CONNECTION_LIMIT || "18", 10)
  );
  const targetTimeout = Math.max(
    1,
    parseInt(process.env.PRISMA_POOL_TIMEOUT || "45", 10)
  );

  let out = url;
  const limMatch = out.match(/connection_limit=(\d+)/i);
  if (limMatch) {
    const cur = parseInt(limMatch[1], 10);
    if (cur < targetLimit) {
      out = out.replace(/connection_limit=\d+/i, `connection_limit=${targetLimit}`);
    }
  } else {
    out += (out.includes("?") ? "&" : "?") + `connection_limit=${targetLimit}`;
  }

  const toMatch = out.match(/pool_timeout=(\d+)/i);
  if (toMatch) {
    const cur = parseInt(toMatch[1], 10);
    if (cur < targetTimeout) {
      out = out.replace(/pool_timeout=\d+/i, `pool_timeout=${targetTimeout}`);
    }
  } else {
    out += (out.includes("?") ? "&" : "?") + `pool_timeout=${targetTimeout}`;
  }
  return out;
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