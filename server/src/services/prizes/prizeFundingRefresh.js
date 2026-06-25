import { prisma } from "../../config/database.js";
import { attachPrizeFundingSummary } from "./prizeCreateHelpers.js";
import { checkPrizeWalletFunding } from "./prizeFunding.js";
import { isPrizeWalletConfigured } from "./prizeWallet.js";

export async function refreshTournamentPrizeFunding(tournamentId) {
  const tournament = await prisma.tournament.findUnique({
    where: { id: tournamentId },
  });
  if (!tournament) {
    const err = new Error("Tournament not found");
    err.status = 404;
    throw err;
  }
  if (tournament.prizeMode !== "WALLET") {
    const err = new Error("Tournament does not use wallet prize mode");
    err.status = 400;
    throw err;
  }
  if (!isPrizeWalletConfigured(tournament)) {
    const err = new Error("Prize wallet address and private key must be configured first");
    err.status = 400;
    throw err;
  }

  const check = await checkPrizeWalletFunding({
    walletAddress: tournament.prizeWalletAddress,
    prizeStructureJson: tournament.prizeStructureJson,
    feeLamports: tournament.prizeFeeSolLamports,
  });

  const updated = await prisma.tournament.update({
    where: { id: tournamentId },
    data: { prizeFundingStatus: check.funded ? "FUNDED" : check.status },
  });

  return {
    ...attachPrizeFundingSummary(updated),
    fundingCheck: check,
  };
}

export async function refreshLeaguePrizeFunding(leagueId) {
  const league = await prisma.league.findUnique({ where: { id: leagueId } });
  if (!league) {
    const err = new Error("League not found");
    err.status = 404;
    throw err;
  }
  if (league.prizeMode !== "WALLET") {
    const err = new Error("League does not use wallet prize mode");
    err.status = 400;
    throw err;
  }
  if (!isPrizeWalletConfigured(league)) {
    const err = new Error("Prize wallet address and private key must be configured first");
    err.status = 400;
    throw err;
  }

  const check = await checkPrizeWalletFunding({
    walletAddress: league.prizeWalletAddress,
    prizeStructureJson: league.prizeStructureJson,
    feeLamports: league.prizeFeeSolLamports,
  });

  const updated = await prisma.league.update({
    where: { id: leagueId },
    data: { prizeFundingStatus: check.funded ? "FUNDED" : check.status },
  });

  return {
    ...attachPrizeFundingSummary(updated),
    fundingCheck: check,
  };
}
