-- Fix drift so Prisma migrate can run. Run this once, then run the steps in MIGRATE.md
-- Use: psql $DATABASE_URL -f prisma/fix-and-migrate.sql
-- Or paste into Supabase SQL Editor and run.

-- DiscordServer.updatedAt should have DEFAULT now() (drift fix)
ALTER TABLE "DiscordServer"
  ALTER COLUMN "updatedAt" SET DEFAULT now();
