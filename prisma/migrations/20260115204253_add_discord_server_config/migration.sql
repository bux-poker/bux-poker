/*
  Warnings:

  - Added the required column `updatedAt` to the `DiscordServer` table without a default value. This is not possible if the table is not empty.

*/
-- AlterTable
-- Add columns safely, handling existing data
DO $$ 
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'DiscordServer' AND column_name = 'adminRoleId') THEN
    ALTER TABLE "DiscordServer" ADD COLUMN "adminRoleId" TEXT;
  END IF;
  
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'DiscordServer' AND column_name = 'inviteLink') THEN
    ALTER TABLE "DiscordServer" ADD COLUMN "inviteLink" TEXT;
  END IF;
  
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'DiscordServer' AND column_name = 'setupCompleted') THEN
    ALTER TABLE "DiscordServer" ADD COLUMN "setupCompleted" BOOLEAN NOT NULL DEFAULT false;
  END IF;
  
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'DiscordServer' AND column_name = 'updatedAt') THEN
    ALTER TABLE "DiscordServer" ADD COLUMN "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;
  END IF;
END $$;

-- CreateTable
CREATE TABLE "TournamentPost" (
    "id" TEXT NOT NULL,
    "tournamentId" TEXT NOT NULL,
    "serverId" TEXT NOT NULL,
    "messageId" TEXT,
    "postedAt" TIMESTAMP(3),

    CONSTRAINT "TournamentPost_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "TournamentPost_tournamentId_serverId_key" ON "TournamentPost"("tournamentId", "serverId");

-- AddForeignKey
ALTER TABLE "TournamentPost" ADD CONSTRAINT "TournamentPost_tournamentId_fkey" FOREIGN KEY ("tournamentId") REFERENCES "Tournament"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TournamentPost" ADD CONSTRAINT "TournamentPost_serverId_fkey" FOREIGN KEY ("serverId") REFERENCES "DiscordServer"("id") ON DELETE CASCADE ON UPDATE CASCADE;
