-- Idempotent: safe if column already exists (typical cause of failed 20260207 migration)
ALTER TABLE "Tournament" ADD COLUMN IF NOT EXISTS "startScheduledAt" TIMESTAMP(3);
