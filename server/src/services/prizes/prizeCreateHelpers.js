import { prisma } from "../../config/database.js";
import { createPrizeWalletRecord } from "./prizeWallet.js";
import {
  lamportsToSolString,
  validateAndNormalizePrizeConfig,
} from "./prizeStructure.js";

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
    const wallet = createPrizeWalletRecord();
    return {
      ...base,
      ...wallet,
      prizeFundingSummary: {
        prizeWalletAddress: wallet.prizeWalletAddress,
        requiredFeeSol: lamportsToSolString(normalized.prizeFeeSolLamports),
        fundingStatus: "PENDING",
      },
    };
  }

  return base;
}

export function attachPrizeFundingSummary(record) {
  if (!record) return record;
  const { prizeWalletSecretEnc: _secret, ...safe } = record;
  if (safe.prizeMode !== "WALLET") return safe;
  return {
    ...safe,
    prizeFeeSolLamports:
      safe.prizeFeeSolLamports != null
        ? safe.prizeFeeSolLamports.toString()
        : null,
    prizeFundingSummary: safe.prizeFundingSummary ?? {
      prizeWalletAddress: safe.prizeWalletAddress,
      requiredFeeSol: safe.prizeFeeSolLamports
        ? lamportsToSolString(safe.prizeFeeSolLamports)
        : null,
      fundingStatus: safe.prizeFundingStatus,
    },
  };
}
