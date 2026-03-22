-- AlterTable
ALTER TABLE "Tournament" ADD COLUMN IF NOT EXISTS "registrationOpensAt" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "League" ADD COLUMN IF NOT EXISTS "description" TEXT;

-- AlterTable
ALTER TABLE "League" ADD COLUMN IF NOT EXISTS "timezone" TEXT;

-- AlterTable
ALTER TABLE "League" ADD COLUMN IF NOT EXISTS "createdById" TEXT;

-- AddForeignKey
ALTER TABLE "League" DROP CONSTRAINT IF EXISTS "League_createdById_fkey";
ALTER TABLE "League" ADD CONSTRAINT "League_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AlterTable
ALTER TABLE "LeagueGame" ADD COLUMN IF NOT EXISTS "registrationCountAtClose" INTEGER;

-- AlterTable
ALTER TABLE "LeagueGame" ADD COLUMN IF NOT EXISTS "pointsAwardedAt" TIMESTAMP(3);

-- RecreateForeignKey
ALTER TABLE "LeagueGame" DROP CONSTRAINT IF EXISTS "LeagueGame_tournamentId_fkey";
ALTER TABLE "LeagueGame" ADD CONSTRAINT "LeagueGame_tournamentId_fkey" FOREIGN KEY ("tournamentId") REFERENCES "Tournament"("id") ON DELETE CASCADE ON UPDATE CASCADE;
