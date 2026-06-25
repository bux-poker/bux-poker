import { prisma } from "../../config/database.js";
import { getWalletPlaceItems } from "./prizeStructure.js";
import { isPrizeWalletConfigured, loadPrizeWalletKeypair } from "./prizeWallet.js";
import {
  executePlacePayout,
  validateRecipientAddress,
} from "./prizePayout.js";

/** @type {Map<string, Promise<unknown>>} */
const sweepLocks = new Map();

/**
 * Mark wallet claims past eligibleUntil as EXPIRED (sweep pending).
 */
export async function markExpiredEligibleClaims() {
  const now = new Date();
  const result = await prisma.prizeClaim.updateMany({
    where: {
      status: "ELIGIBLE",
      eligibleUntil: { lte: now },
      tournamentId: { not: null },
    },
    data: { status: "EXPIRED" },
  });
  return result.count;
}

/**
 * Sweep one expired claim's place assets to the tournament refund wallet.
 */
export async function sweepExpiredPrizeClaim(claimId) {
  const existing = sweepLocks.get(claimId);
  if (existing) return existing;

  const work = sweepExpiredPrizeClaimInner(claimId).finally(() => {
    sweepLocks.delete(claimId);
  });
  sweepLocks.set(claimId, work);
  return work;
}

async function sweepExpiredPrizeClaimInner(claimId) {
  const claim = await prisma.prizeClaim.findUnique({
    where: { id: claimId },
    include: {
      tournament: {
        select: {
          id: true,
          name: true,
          prizeMode: true,
          prizeStructureJson: true,
          prizeWalletAddress: true,
          prizeWalletSecretEnc: true,
          refundWalletAddress: true,
        },
      },
    },
  });

  if (!claim?.tournamentId || !claim.tournament) return { skipped: true };
  if (claim.status === "SWEPT" || claim.status === "CLAIMED") {
    return { skipped: true, reason: claim.status };
  }
  if (claim.status !== "EXPIRED" && claim.status !== "ELIGIBLE") {
    return { skipped: true, reason: claim.status };
  }

  const tournament = claim.tournament;
  if (tournament.prizeMode !== "WALLET") return { skipped: true };

  const now = new Date();
  if (claim.eligibleUntil && claim.eligibleUntil > now && claim.status === "ELIGIBLE") {
    return { skipped: true, reason: "not_due" };
  }

  if (claim.status === "ELIGIBLE") {
    await prisma.prizeClaim.updateMany({
      where: { id: claimId, status: "ELIGIBLE" },
      data: { status: "EXPIRED" },
    });
  }

  if (!tournament.refundWalletAddress) {
    console.error(
      `[PRIZES] Cannot sweep claim ${claimId}: tournament ${tournament.id} missing refundWalletAddress`
    );
    return { failed: true, reason: "no_refund_address" };
  }

  if (!isPrizeWalletConfigured(tournament)) {
    console.error(
      `[PRIZES] Cannot sweep claim ${claimId}: prize wallet not configured for ${tournament.id}`
    );
    return { failed: true, reason: "wallet_not_configured" };
  }

  const placeItems = getWalletPlaceItems(
    tournament.prizeStructureJson,
    claim.finishingPlace
  );
  if (placeItems.length === 0) {
    await prisma.prizeClaim.updateMany({
      where: { id: claimId, status: "EXPIRED" },
      data: { status: "SWEPT", txSignaturesJson: "[]" },
    });
    return { swept: true, txSignatures: [] };
  }

  const refundPubkey = validateRecipientAddress(tournament.refundWalletAddress);
  const keypair = loadPrizeWalletKeypair(tournament);

  let txSignatures;
  try {
    txSignatures = await executePlacePayout({
      keypair,
      recipientPubkey: refundPubkey,
      placeItems,
    });
  } catch (err) {
    console.error(
      `[PRIZES] Sweep failed for claim ${claimId} (${tournament.name}, place ${claim.finishingPlace}):`,
      err?.message || err
    );
    return { failed: true, error: err?.message || String(err) };
  }

  const marked = await prisma.prizeClaim.updateMany({
    where: { id: claimId, status: "EXPIRED" },
    data: {
      status: "SWEPT",
      txSignaturesJson: JSON.stringify(txSignatures),
      recipientAddress: refundPubkey.toBase58(),
      claimedAt: new Date(),
    },
  });

  if (marked.count === 0) {
    return { skipped: true, reason: "already_swept_or_claimed" };
  }

  console.log(
    `[PRIZES] Swept expired claim ${claimId} place ${claim.finishingPlace} → refund (${txSignatures.length} tx)`
  );

  return { swept: true, txSignatures };
}

/**
 * Process all expired wallet claims due for sweep.
 */
export async function runExpiredPrizeClaimsTick() {
  const marked = await markExpiredEligibleClaims();
  if (marked > 0) {
    console.log(`[PRIZES] Marked ${marked} eligible claim(s) as EXPIRED`);
  }

  const due = await prisma.prizeClaim.findMany({
    where: {
      status: "EXPIRED",
      tournamentId: { not: null },
      tournament: { prizeMode: "WALLET" },
    },
    select: { id: true },
    take: 20,
  });

  let swept = 0;
  let failed = 0;

  for (const row of due) {
    try {
      const result = await sweepExpiredPrizeClaim(row.id);
      if (result?.swept) swept += 1;
      else if (result?.failed) failed += 1;
    } catch (err) {
      failed += 1;
      console.error(`[PRIZES] Sweep tick error for ${row.id}:`, err?.message || err);
    }
  }

  return { marked, due: due.length, swept, failed };
}
