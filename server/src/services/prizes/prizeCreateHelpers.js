import { prisma } from "../../config/database.js";
import {
  lamportsToSolString,
  validateAndNormalizePrizeConfig,
} from "./prizeStructure.js";
import {
  getSharedPrizeWalletAddress,
  isPrizeWalletConfigured,
  isSharedPrizeWalletConfigured,
} from "./prizeWallet.js";
import { buildPrizeDepositRequirements } from "./prizeDeposit.js";

export async function resolvePrizeClaimServerId(prizeClaimServerId) {
  if (!prizeClaimServerId) return null;
  const byInternal = await prisma.discordServer.findUnique({
    where: { id: String(prizeClaimServerId) },
    select: { id: true },
  });
  if (byInternal) return byInternal.id;
  const byGuild = await prisma.discordServer.findUnique({
    where: { serverId: String(prizeClaimServerId) },
    select: { id: true },
  });
  return byGuild?.id ?? null;
}

/**
 * Build prisma create/update fields for tournament or league prize config.
 */
export async function buildPrizeFieldsFromRequest(body, { maxPlayers, requirePrizes }) {
  const {
    prizePlaces,
    prizeMode,
    prizeStructure,
    refundWalletAddress,
    prizeClaimServerId,
  } = body;

  if (!requirePrizes) {
    return {
      prizePlaces: 0,
      prizeMode: null,
      prizeStructureJson: "[]",
      prizeWalletAddress: null,
      prizeWalletSecretEnc: null,
      prizeFundingStatus: null,
      prizeFeeSolLamports: null,
      refundWalletAddress: null,
      prizeClaimServerId: null,
      hasPrizes: false,
    };
  }

  const claimServerInternalId = await resolvePrizeClaimServerId(prizeClaimServerId);

  const normalized = validateAndNormalizePrizeConfig({
    prizePlaces,
    prizeMode,
    prizeStructure,
    maxPlayers,
    refundWalletAddress,
    prizeClaimServerId: claimServerInternalId,
  });

  if (normalized.prizeMode === "MANUAL" && !claimServerInternalId) {
    const err = new Error("Invalid prize claim Discord server");
    err.status = 400;
    throw err;
  }

  const base = {
    prizePlaces: normalized.prizePlaces,
    prizeMode: normalized.prizeMode,
    prizeStructureJson: normalized.prizeStructureJson,
    prizeFundingStatus: normalized.prizeFundingStatus,
    prizeFeeSolLamports: normalized.prizeFeeSolLamports,
    refundWalletAddress: normalized.refundWalletAddress,
    prizeClaimServerId: claimServerInternalId,
    hasPrizes: true,
    prizeWalletAddress: null,
    prizeWalletSecretEnc: null,
  };

  if (normalized.prizeMode === "WALLET") {
    if (!isSharedPrizeWalletConfigured()) {
      const err = new Error(
        "Shared prize wallet is not configured on the server. Set PRIZE_WALLET_PRIVATE_KEY (Fly secret) before creating auto-claim tournaments."
      );
      err.status = 503;
      throw err;
    }
    const sharedAddress = getSharedPrizeWalletAddress();
    const depositRequirements = buildPrizeDepositRequirements({
      prizeStructureJson: normalized.prizeStructureJson,
      feeLamports: normalized.prizeFeeSolLamports,
      prizeWalletAddress: sharedAddress,
    });

    return {
      ...base,
      prizeWalletAddress: sharedAddress,
      // Signing uses Fly env key; do not store per-event secrets.
      prizeWalletSecretEnc: null,
      prizeFundingStatus: "PENDING",
      prizeFundingSummary: {
        prizeWalletAddress: sharedAddress,
        requiredFeeSol: lamportsToSolString(normalized.prizeFeeSolLamports),
        fundingStatus: "PENDING",
        walletConfigured: true,
      },
      depositRequirements,
    };
  }

  return base;
}

export function attachPrizeFundingSummary(record) {
  if (!record) return record;
  const walletConfigured = isPrizeWalletConfigured(record);
  const { prizeWalletSecretEnc: _secret, ...safe } = record;
  if (safe.prizeMode !== "WALLET") return safe;

  let depositRequirements = null;
  try {
    if (safe.prizeStructureJson && safe.prizeWalletAddress) {
      depositRequirements = buildPrizeDepositRequirements({
        prizeStructureJson: safe.prizeStructureJson,
        feeLamports: safe.prizeFeeSolLamports,
        prizeWalletAddress: safe.prizeWalletAddress,
      });
    }
  } catch {
    depositRequirements = null;
  }

  return {
    ...safe,
    prizeFeeSolLamports:
      safe.prizeFeeSolLamports != null
        ? safe.prizeFeeSolLamports.toString()
        : null,
    depositRequirements,
    prizeFundingSummary: safe.prizeFundingSummary ?? {
      prizeWalletAddress: safe.prizeWalletAddress,
      requiredFeeSol: safe.prizeFeeSolLamports
        ? lamportsToSolString(safe.prizeFeeSolLamports)
        : null,
      fundingStatus: safe.prizeFundingStatus,
      walletConfigured,
    },
  };
}
