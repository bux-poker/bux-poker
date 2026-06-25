-- CreateEnum
CREATE TYPE "PrizeMode" AS ENUM ('MANUAL', 'WALLET');

-- CreateEnum
CREATE TYPE "PrizeFundingStatus" AS ENUM ('PENDING', 'PARTIAL', 'FUNDED');

-- CreateEnum
CREATE TYPE "PrizeClaimStatus" AS ENUM ('ELIGIBLE', 'CLAIMED', 'MANUAL_PENDING', 'EXPIRED', 'SWEPT');

-- AlterTable Tournament
ALTER TABLE "Tournament" ADD COLUMN     "prizeMode" "PrizeMode",
ADD COLUMN     "prizeStructureJson" TEXT NOT NULL DEFAULT '[]',
ADD COLUMN     "prizeWalletAddress" TEXT,
ADD COLUMN     "prizeWalletSecretEnc" TEXT,
ADD COLUMN     "prizeFundingStatus" "PrizeFundingStatus",
ADD COLUMN     "prizeFeeSolLamports" BIGINT,
ADD COLUMN     "refundWalletAddress" TEXT,
ADD COLUMN     "prizeClaimServerId" TEXT,
ADD COLUMN     "hasPrizes" BOOLEAN NOT NULL DEFAULT true;

ALTER TABLE "Tournament" ALTER COLUMN "prizePlaces" SET DEFAULT 0;

-- AlterTable League
ALTER TABLE "League" ADD COLUMN     "prizePlaces" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "prizeMode" "PrizeMode",
ADD COLUMN     "prizeStructureJson" TEXT NOT NULL DEFAULT '[]',
ADD COLUMN     "prizeWalletAddress" TEXT,
ADD COLUMN     "prizeWalletSecretEnc" TEXT,
ADD COLUMN     "prizeFundingStatus" "PrizeFundingStatus",
ADD COLUMN     "prizeFeeSolLamports" BIGINT,
ADD COLUMN     "refundWalletAddress" TEXT,
ADD COLUMN     "prizeClaimServerId" TEXT;

-- CreateTable PrizeClaim
CREATE TABLE "PrizeClaim" (
    "id" TEXT NOT NULL,
    "tournamentId" TEXT,
    "leagueId" TEXT,
    "userId" TEXT NOT NULL,
    "finishingPlace" INTEGER NOT NULL,
    "status" "PrizeClaimStatus" NOT NULL DEFAULT 'MANUAL_PENDING',
    "eligibleFrom" TIMESTAMP(3),
    "eligibleUntil" TIMESTAMP(3),
    "recipientAddress" TEXT,
    "txSignaturesJson" TEXT NOT NULL DEFAULT '[]',
    "claimedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PrizeClaim_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "PrizeClaim_tournamentId_userId_key" ON "PrizeClaim"("tournamentId", "userId");

-- CreateIndex
CREATE UNIQUE INDEX "PrizeClaim_leagueId_userId_key" ON "PrizeClaim"("leagueId", "userId");

-- AddForeignKey
ALTER TABLE "Tournament" ADD CONSTRAINT "Tournament_prizeClaimServerId_fkey" FOREIGN KEY ("prizeClaimServerId") REFERENCES "DiscordServer"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "League" ADD CONSTRAINT "League_prizeClaimServerId_fkey" FOREIGN KEY ("prizeClaimServerId") REFERENCES "DiscordServer"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PrizeClaim" ADD CONSTRAINT "PrizeClaim_tournamentId_fkey" FOREIGN KEY ("tournamentId") REFERENCES "Tournament"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PrizeClaim" ADD CONSTRAINT "PrizeClaim_leagueId_fkey" FOREIGN KEY ("leagueId") REFERENCES "League"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PrizeClaim" ADD CONSTRAINT "PrizeClaim_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
