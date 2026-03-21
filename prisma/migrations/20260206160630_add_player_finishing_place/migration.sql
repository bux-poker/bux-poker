-- AlterTable
ALTER TABLE "DiscordServer" ALTER COLUMN "updatedAt" DROP DEFAULT;

-- AlterTable
ALTER TABLE "Player" ADD COLUMN     "finishingPlace" INTEGER;
