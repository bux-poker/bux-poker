import { prisma } from "../../config/database.js";
import { isPrizeWalletConfigured } from "./prizeWallet.js";

function walletNotReadyError(kind) {
  if (!kind?.prizeWalletAddress || !kind?.prizeWalletSecretEnc) {
    return "Prize wallet address and private key must be configured before starting";
  }
  if (kind.prizeFundingStatus !== "FUNDED") {
    return "Prize wallet must be fully funded before starting";
  }
  return null;
}

/**
 * Block start until wallet-mode prizes have credentials + funding.
 * Standalone tournaments use their row; league legs use the parent league row.
 */
export async function assertPrizeWalletReadyForStart(tournament) {
  if (tournament.hasPrizes && tournament.prizeMode === "WALLET") {
    const msg = walletNotReadyError(tournament);
    if (msg) throw new Error(msg);
    return;
  }

  if (tournament.hasPrizes === false) {
    const leg = await prisma.leagueGame.findFirst({
      where: { tournamentId: tournament.id },
      include: {
        league: {
          select: {
            prizeMode: true,
            prizeWalletAddress: true,
            prizeWalletSecretEnc: true,
            prizeFundingStatus: true,
          },
        },
      },
    });
    if (leg?.league?.prizeMode === "WALLET") {
      const msg = walletNotReadyError(leg.league);
      if (msg) throw new Error(msg);
    }
  }
}

export { isPrizeWalletConfigured };
