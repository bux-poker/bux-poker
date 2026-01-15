import { PrismaClient } from '@prisma/client';

// ULTRA-OPTIMIZED: Maximum performance database configuration
const prisma = new PrismaClient({
  log: [], // NO LOGGING AT ALL
  datasources: {
    db: {
      url: process.env.DATABASE_URL
    }
  },
  // ULTRA-OPTIMIZED: Maximum connection pooling and performance
  __internal: {
    engine: {
      binaryTargets: ['native'],
      connectionLimit: 50, // Increased from 20
      poolTimeout: 30000, // Increased from 20000
      queryTimeout: 15000, // Increased from 10000
      connectionTimeout: 10000, // Added connection timeout
      maxConnections: 50, // Added max connections
      minConnections: 5, // Added min connections
      acquireTimeoutMillis: 10000, // Added acquire timeout
      createTimeoutMillis: 10000, // Added create timeout
      destroyTimeoutMillis: 5000, // Added destroy timeout
      idleTimeoutMillis: 30000, // Added idle timeout
      reapIntervalMillis: 1000, // Added reap interval
      createRetryIntervalMillis: 200 // Added retry interval
    }
  }
});

// NOTE: Removed previous hard guard that forcibly blocked Game.status='FINISHED'.
// Game completion must be allowed so the lifecycle can progress correctly.

// Handle graceful shutdown
process.on('beforeExit', async () => {
  await prisma.$disconnect();
});

export { prisma };