import { prisma } from "../../config/database.js";
import { WALLET_CLAIM_EXPIRY_DAYS } from "./prizeStructure.js";

/**
 * Create or update a prize claim when a paid finishing place is locked in.
 */
export async function ensureTournamentPrizeClaim(tournamentId, userId, finishingPlace) {
  if (!userId || finishingPlace == null) return;

  const tournament = await prisma.tournament.findUnique({
    where: { id: tournamentId },
    select: {
      hasPrizes: true,
      prizePlaces: true,
      prizeMode: true,
      status: true,
    },
  });

  if (
    !tournament?.hasPrizes ||
    tournament.status === "CANCELLED" ||
    finishingPlace < 1 ||
    finishingPlace > tournament.prizePlaces
  ) {
    return;
  }

  const eligibleFrom = new Date();
  const eligibleUntil =
    tournament.prizeMode === "WALLET"
      ? new Date(
          eligibleFrom.getTime() + WALLET_CLAIM_EXPIRY_DAYS * 24 * 60 * 60 * 1000
        )
      : null;

  const status =
    tournament.prizeMode === "WALLET" ? "ELIGIBLE" : "MANUAL_PENDING";

  await prisma.prizeClaim.upsert({
    where: {
      tournamentId_userId: { tournamentId, userId },
    },
    create: {
      tournamentId,
      userId,
      finishingPlace,
      status,
      eligibleFrom,
      eligibleUntil,
    },
    update: {
      finishingPlace,
      status,
      eligibleFrom,
      eligibleUntil,
    },
  });
}

export async function ensureTournamentPrizeClaimForPlayerId(
  tournamentId,
  playerId,
  finishingPlace
) {
  const player = await prisma.player.findUnique({
    where: { id: playerId },
    select: { userId: true },
  });
  if (!player?.userId) return;
  await ensureTournamentPrizeClaim(
    tournamentId,
    player.userId,
    finishingPlace
  );
}

export async function getViewerPrizeClaim(tournamentId, userId) {
  if (!userId) return null;
  return prisma.prizeClaim.findUnique({
    where: { tournamentId_userId: { tournamentId, userId } },
  });
}

export async function listTournamentPrizeClaims(tournamentId) {
  return prisma.prizeClaim.findMany({
    where: { tournamentId },
    include: {
      user: { select: { id: true, username: true, avatarUrl: true } },
    },
    orderBy: { finishingPlace: "asc" },
  });
}
