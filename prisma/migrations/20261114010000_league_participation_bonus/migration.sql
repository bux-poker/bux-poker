-- Track applied participation bonus so we can idempotently award +5/+10 for 50%/80% attendance.
ALTER TABLE "LeagueStanding" ADD COLUMN IF NOT EXISTS "participationBonusPoints" INTEGER NOT NULL DEFAULT 0;
