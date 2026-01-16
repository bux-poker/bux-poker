-- AlterTable
ALTER TABLE "Tournament" ADD COLUMN IF NOT EXISTS "startedAt" TIMESTAMP(3);

-- AlterEnum (if SEATED doesn't exist)
DO $$ 
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_enum WHERE enumlabel = 'SEATED' AND enumtypid = (SELECT oid FROM pg_type WHERE typname = 'TournamentStatus')) THEN
        ALTER TYPE "TournamentStatus" ADD VALUE 'SEATED';
    END IF;
END $$;
