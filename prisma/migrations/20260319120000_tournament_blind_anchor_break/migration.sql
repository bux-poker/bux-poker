-- Synchronized blind clock: anchor time, scheduled breaks, hand-barrier acks

ALTER TABLE "Tournament" ADD COLUMN "blindPeriodAnchorAt" TIMESTAMP(3),
ADD COLUMN "tournamentBreakUntilAt" TIMESTAMP(3),
ADD COLUMN "awaitingHandsForBlindClock" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN "blindScheduleBarrier" INTEGER NOT NULL DEFAULT 0;

ALTER TABLE "Game" ADD COLUMN "blindBarrierAck" INTEGER NOT NULL DEFAULT 0;

-- Existing RUNNING tournaments: keep wall-clock-aligned anchor so behavior does not jump backward
UPDATE "Tournament"
SET
  "blindPeriodAnchorAt" = "startedAt",
  "awaitingHandsForBlindClock" = false,
  "blindScheduleBarrier" = 0
WHERE "status" = 'RUNNING' AND "startedAt" IS NOT NULL;
