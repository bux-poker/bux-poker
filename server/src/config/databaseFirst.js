import { PrismaClient } from '@prisma/client';

/**
 * DATABASE-FIRST DATABASE CONFIGURATION
 * No hard guards - database is the single source of truth
 */
const prisma = new PrismaClient({
  log: [], // NO LOGGING IN PRODUCTION - PERFORMANCE CRITICAL
  datasources: {
    db: {
      url: process.env.NEW_DATABASE_URL || process.env.DATABASE_URL
    }
  }
});

export { prisma };
