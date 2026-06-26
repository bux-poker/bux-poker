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
  const claim = await prisma.prizeClaim.findUnique({
    where: { tournamentId_userId: { tournamentId, userId } },
  });
  if (!claim) return null;
  return serializePrizeClaim(claim);
}

export function serializePrizeClaim(claim) {
  let txSignatures = [];
  try {
    txSignatures = JSON.parse(claim.txSignaturesJson || "[]");
  } catch {
    txSignatures = [];
  }
  return {
    id: claim.id,
    finishingPlace: claim.finishingPlace,
    status: claim.status,
    eligibleFrom: claim.eligibleFrom,
    eligibleUntil: claim.eligibleUntil,
    claimedAt: claim.claimedAt,
    recipientAddress: claim.recipientAddress,
    txSignatures,
    solscanUrls: txSignatures.map(
      (sig) => `https://solscan.io/tx/${sig}`
    ),
  };
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

export function sortLeagueStandings(rows) {
  return [...rows].sort((a, b) => {
    if (b.points !== a.points) return b.points - a.points;
    const af = a.bestFinish ?? 999;
    const bf = b.bestFinish ?? 999;
    return af - bf;
  });
}

async function ensureLeaguePrizeClaimForUser(leagueId, userId, finishingPlace, prizeMode) {
  const existing = await prisma.prizeClaim.findUnique({
    where: { leagueId_userId: { leagueId, userId } },
  });
  if (existing && (existing.status === "CLAIMED" || existing.status === "SWEPT")) {
    return;
  }

  const eligibleFrom = new Date();
  const eligibleUntil =
    prizeMode === "WALLET"
      ? new Date(
          eligibleFrom.getTime() + WALLET_CLAIM_EXPIRY_DAYS * 24 * 60 * 60 * 1000
        )
      : null;
  const status = prizeMode === "WALLET" ? "ELIGIBLE" : "MANUAL_PENDING";

  if (existing) {
    await prisma.prizeClaim.update({
      where: { id: existing.id },
      data: { finishingPlace, status, eligibleFrom, eligibleUntil },
    });
    return;
  }

  await prisma.prizeClaim.create({
    data: {
      leagueId,
      userId,
      finishingPlace,
      status,
      eligibleFrom,
      eligibleUntil,
    },
  });
}

/**
 * Create prize claims for paid league standings when the league completes.
 */
export async function ensureLeaguePrizeClaims(leagueId) {
  const league = await prisma.league.findUnique({
    where: { id: leagueId },
    select: {
      status: true,
      prizePlaces: true,
      prizeMode: true,
    },
  });
  if (!league || league.status !== "COMPLETED") return;
  if (!league.prizePlaces || league.prizePlaces < 1 || !league.prizeMode) return;

  const standings = await prisma.leagueStanding.findMany({
    where: { leagueId },
  });
  const sorted = sortLeagueStandings(standings);
  const paid = sorted.slice(0, league.prizePlaces);

  for (let i = 0; i < paid.length; i++) {
    await ensureLeaguePrizeClaimForUser(
      leagueId,
      paid[i].userId,
      i + 1,
      league.prizeMode
    );
  }

  if (paid.length > 0) {
    console.log(
      `[PRIZES] Created/updated ${paid.length} league prize claim(s) for ${leagueId}`
    );
  }
}

export async function getViewerLeaguePrizeClaim(leagueId, userId) {
  if (!userId) return null;
  const claim = await prisma.prizeClaim.findUnique({
    where: { leagueId_userId: { leagueId, userId } },
  });
  if (!claim) return null;
  return serializePrizeClaim(claim);
}
