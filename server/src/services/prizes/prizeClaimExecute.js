import { prisma } from "../../config/database.js";
import { getWalletPlaceItems } from "./prizeStructure.js";
import { isPrizeWalletConfigured, loadPrizeWalletKeypair } from "./prizeWallet.js";
import {
  executePlacePayout,
  solscanTxUrl,
  validateRecipientAddress,
} from "./prizePayout.js";

/** @type {Map<string, Promise<unknown>>} */
const claimLocks = new Map();

function httpError(message, status) {
  const err = new Error(message);
  err.status = status;
  return err;
}

function getPlaceItems(prizeStructureJson, finishingPlace) {
  return getWalletPlaceItems(prizeStructureJson, finishingPlace);
}

async function claimTournamentPrizeInner({
  tournamentId,
  userId,
  recipientAddress,
}) {
  const recipientPubkey = validateRecipientAddress(recipientAddress);

  const tournament = await prisma.tournament.findUnique({
    where: { id: tournamentId },
    select: {
      id: true,
      hasPrizes: true,
      prizeMode: true,
      prizeStructureJson: true,
      prizeWalletAddress: true,
      prizeWalletSecretEnc: true,
    },
  });

  if (!tournament) throw httpError("Tournament not found", 404);
  if (!tournament.hasPrizes || tournament.prizeMode !== "WALLET") {
    throw httpError("This tournament does not support wallet prize claims", 400);
  }
  if (!isPrizeWalletConfigured(tournament)) {
    throw httpError("Prize wallet is not configured", 503);
  }

  const claim = await prisma.prizeClaim.findUnique({
    where: { tournamentId_userId: { tournamentId, userId } },
  });

  if (!claim) {
    throw httpError("You do not have a prize claim for this tournament", 404);
  }

  if (claim.status === "CLAIMED") {
    const txSignatures = JSON.parse(claim.txSignaturesJson || "[]");
    return {
      alreadyClaimed: true,
      claim: {
        ...claim,
        txSignatures,
        solscanUrls: txSignatures.map(solscanTxUrl),
      },
    };
  }

  if (claim.status === "EXPIRED" || claim.status === "SWEPT") {
    throw httpError("Your claim period has ended", 410);
  }

  if (claim.status !== "ELIGIBLE") {
    throw httpError(`Claim is not available (status: ${claim.status})`, 400);
  }

  const now = new Date();
  if (claim.eligibleUntil && claim.eligibleUntil < now) {
    await prisma.prizeClaim.update({
      where: { id: claim.id },
      data: { status: "EXPIRED" },
    });
    throw httpError("Your claim period has expired", 410);
  }

  const placeItems = getPlaceItems(
    tournament.prizeStructureJson,
    claim.finishingPlace
  );
  if (placeItems.length === 0) {
    throw httpError("No prize assets configured for your finishing place", 400);
  }

  const keypair = loadPrizeWalletKeypair(tournament);
  const txSignatures = await executePlacePayout({
    keypair,
    recipientPubkey,
    placeItems,
  });

  const marked = await prisma.prizeClaim.updateMany({
    where: { id: claim.id, status: "ELIGIBLE" },
    data: {
      status: "CLAIMED",
      recipientAddress: recipientPubkey.toBase58(),
      txSignaturesJson: JSON.stringify(txSignatures),
      claimedAt: new Date(),
    },
  });

  if (marked.count === 0) {
    const err = new Error("Prize was already claimed");
    err.status = 409;
    throw err;
  }

  const updated = await prisma.prizeClaim.findUnique({ where: { id: claim.id } });

  return {
    alreadyClaimed: false,
    claim: {
      ...updated,
      txSignatures,
      solscanUrls: txSignatures.map(solscanTxUrl),
    },
  };
}

export async function claimTournamentPrize(args) {
  const lockKey = `tournament:${args.tournamentId}:${args.userId}`;
  const existing = claimLocks.get(lockKey);
  if (existing) return existing;

  const work = claimTournamentPrizeInner(args).finally(() => {
    claimLocks.delete(lockKey);
  });
  claimLocks.set(lockKey, work);
  return work;
}

async function claimLeaguePrizeInner({ leagueId, userId, recipientAddress }) {
  const recipientPubkey = validateRecipientAddress(recipientAddress);

  const league = await prisma.league.findUnique({
    where: { id: leagueId },
    select: {
      id: true,
      status: true,
      prizePlaces: true,
      prizeMode: true,
      prizeStructureJson: true,
      prizeWalletAddress: true,
      prizeWalletSecretEnc: true,
    },
  });

  if (!league) throw httpError("League not found", 404);
  if (league.status !== "COMPLETED") {
    throw httpError("League prizes are available after the league completes", 400);
  }
  if (!league.prizePlaces || league.prizeMode !== "WALLET") {
    throw httpError("This league does not support wallet prize claims", 400);
  }
  if (!isPrizeWalletConfigured(league)) {
    throw httpError("Prize wallet is not configured", 503);
  }

  const claim = await prisma.prizeClaim.findUnique({
    where: { leagueId_userId: { leagueId, userId } },
  });

  if (!claim) {
    throw httpError("You do not have a prize claim for this league", 404);
  }

  if (claim.status === "CLAIMED") {
    const txSignatures = JSON.parse(claim.txSignaturesJson || "[]");
    return {
      alreadyClaimed: true,
      claim: {
        ...claim,
        txSignatures,
        solscanUrls: txSignatures.map(solscanTxUrl),
      },
    };
  }

  if (claim.status === "EXPIRED" || claim.status === "SWEPT") {
    throw httpError("Your claim period has ended", 410);
  }

  if (claim.status !== "ELIGIBLE") {
    throw httpError(`Claim is not available (status: ${claim.status})`, 400);
  }

  const now = new Date();
  if (claim.eligibleUntil && claim.eligibleUntil < now) {
    await prisma.prizeClaim.update({
      where: { id: claim.id },
      data: { status: "EXPIRED" },
    });
    throw httpError("Your claim period has expired", 410);
  }

  const placeItems = getPlaceItems(league.prizeStructureJson, claim.finishingPlace);
  if (placeItems.length === 0) {
    throw httpError("No prize assets configured for your finishing place", 400);
  }

  const keypair = loadPrizeWalletKeypair(league);
  const txSignatures = await executePlacePayout({
    keypair,
    recipientPubkey,
    placeItems,
  });

  const marked = await prisma.prizeClaim.updateMany({
    where: { id: claim.id, status: "ELIGIBLE" },
    data: {
      status: "CLAIMED",
      recipientAddress: recipientPubkey.toBase58(),
      txSignaturesJson: JSON.stringify(txSignatures),
      claimedAt: new Date(),
    },
  });

  if (marked.count === 0) {
    const err = new Error("Prize was already claimed");
    err.status = 409;
    throw err;
  }

  const updated = await prisma.prizeClaim.findUnique({ where: { id: claim.id } });

  return {
    alreadyClaimed: false,
    claim: {
      ...updated,
      txSignatures,
      solscanUrls: txSignatures.map(solscanTxUrl),
    },
  };
}

export async function claimLeaguePrize(args) {
  const lockKey = `league:${args.leagueId}:${args.userId}`;
  const existing = claimLocks.get(lockKey);
  if (existing) return existing;

  const work = claimLeaguePrizeInner(args).finally(() => {
    claimLocks.delete(lockKey);
  });
  claimLocks.set(lockKey, work);
  return work;
}
