// Import from our fixed generate path so the client is found on Render (prestart generates to server/.prisma/client)
import { PrismaClient } from '../../.prisma/client/index.js';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

// Load environment variables from server/.env
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
dotenv.config({ path: path.resolve(__dirname, '../../.env') });

// Standard Prisma client — avoid undocumented __internal engine overrides (can break Prisma 5+ / 6+).
// Tune pooling via DATABASE_URL query params (e.g. ?connection_limit=10&pool_timeout=20) on hosted Postgres.
const prisma = new PrismaClient({
  log:
    process.env.NODE_ENV === "production"
      ? ["error"]
      : ["warn", "error"],
  datasources: {
    db: {
      url: process.env.DATABASE_URL,
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