import { PublicKey } from "@solana/web3.js";
import {
  TOKEN_PROGRAM_ID,
  TOKEN_2022_PROGRAM_ID,
  ASSOCIATED_TOKEN_PROGRAM_ID,
  getAssociatedTokenAddress,
  getAccount,
} from "@solana/spl-token";
import { getSolanaConnection } from "./prizeFunding.js";
import { buildPrizeDepositRequirements } from "./prizeDeposit.js";
import { getSharedPrizeWalletAddress } from "./prizeWallet.js";
import {
  fetchCoreAsset,
  buildCoreTransferInstruction,
  serializeInstruction,
} from "./mplCore.js";

function httpError(message, status) {
  const err = new Error(message);
  err.status = status;
  return err;
}

async function findSourceTokenAccount(connection, owner, mint, need) {
  for (const programId of [TOKEN_PROGRAM_ID, TOKEN_2022_PROGRAM_ID]) {
    const resp = await connection.getParsedTokenAccountsByOwner(owner, {
      programId,
    });
    for (const acct of resp.value) {
      const info = acct.account.data.parsed?.info;
      if (!info || info.mint !== mint.toBase58()) continue;
      const amount = BigInt(info.tokenAmount?.amount || 0);
      if (amount >= need) {
        return { source: acct.pubkey.toBase58(), tokenProgramId: programId };
      }
    }
  }
  return null;
}

/**
 * Build deposit plan + fresh blockhash using the API host RPC (avoids browser 403 on public RPC).
 * Supports classic SPL / Token-2022 tokens and Metaplex Core NFTs.
 */
export async function preparePrizeDeposit({
  prizeStructureJson,
  feeLamports,
  prizeWalletAddress,
  payerAddress,
}) {
  const payerStr = String(payerAddress ?? "").trim();
  if (!payerStr) throw httpError("payerAddress is required", 400);

  let payer;
  try {
    payer = new PublicKey(payerStr);
  } catch {
    throw httpError("Invalid payerAddress", 400);
  }

  const destStr =
    String(prizeWalletAddress || "").trim() || getSharedPrizeWalletAddress();
  if (!destStr) {
    throw httpError(
      "Shared prize wallet is not configured (PRIZE_WALLET_PRIVATE_KEY)",
      503
    );
  }
  const dest = new PublicKey(destStr);

  const requirements = buildPrizeDepositRequirements({
    prizeStructureJson,
    feeLamports,
    prizeWalletAddress: destStr,
  });

  const connection = getSolanaConnection();
  const { blockhash, lastValidBlockHeight } =
    await connection.getLatestBlockhash("confirmed");

  const tokenTransfers = [];
  const coreTransferInstructions = [];

  for (const s of requirements.spl) {
    const mint = new PublicKey(s.mint);
    const need = BigInt(s.amount);
    const found = await findSourceTokenAccount(connection, payer, mint, need);
    if (!found) {
      throw httpError(
        `Funding wallet is missing token ${s.mint.slice(0, 8)}… (need ${s.amount})`,
        400
      );
    }
    const tokenProgramId = found.tokenProgramId;
    const ata = await getAssociatedTokenAddress(
      mint,
      dest,
      false,
      tokenProgramId,
      ASSOCIATED_TOKEN_PROGRAM_ID
    );
    let createDestAta = false;
    try {
      await getAccount(connection, ata, "confirmed", tokenProgramId);
    } catch {
      createDestAta = true;
    }
    tokenTransfers.push({
      mint: s.mint,
      amount: s.amount,
      source: found.source,
      destinationAta: ata.toBase58(),
      createDestAta,
      tokenProgramId: tokenProgramId.toBase58(),
    });
  }

  for (const n of requirements.nfts) {
    const core = await fetchCoreAsset(connection, n.mint);
    if (core) {
      if (core.owner !== payerStr) {
        throw httpError(
          `Funding wallet does not own Core NFT ${n.mint.slice(0, 8)}… (held by ${core.owner.slice(0, 4)}…${core.owner.slice(-4)})`,
          400
        );
      }
      const ix = buildCoreTransferInstruction({
        asset: n.mint,
        collection: core.collection,
        payer,
        authority: payer,
        newOwner: dest,
      });
      coreTransferInstructions.push(serializeInstruction(ix));
      continue;
    }

    const mint = new PublicKey(n.mint);
    const found = await findSourceTokenAccount(connection, payer, mint, 1n);
    if (!found) {
      throw httpError(
        `Funding wallet is missing NFT ${n.mint.slice(0, 8)}… (need 1). Checked SPL Token, Token-2022, and Metaplex Core.`,
        400
      );
    }
    const tokenProgramId = found.tokenProgramId;
    const ata = await getAssociatedTokenAddress(
      mint,
      dest,
      false,
      tokenProgramId,
      ASSOCIATED_TOKEN_PROGRAM_ID
    );
    let createDestAta = false;
    try {
      await getAccount(connection, ata, "confirmed", tokenProgramId);
    } catch {
      createDestAta = true;
    }
    tokenTransfers.push({
      mint: n.mint,
      amount: "1",
      source: found.source,
      destinationAta: ata.toBase58(),
      createDestAta,
      tokenProgramId: tokenProgramId.toBase58(),
    });
  }

  return {
    blockhash,
    lastValidBlockHeight,
    feePayer: payerStr,
    prizeWalletAddress: destStr,
    solLamports: requirements.solLamports,
    solAmount: requirements.solAmount,
    tokenTransfers,
    coreTransferInstructions,
    tokenProgramId: TOKEN_PROGRAM_ID.toBase58(),
    associatedTokenProgramId: ASSOCIATED_TOKEN_PROGRAM_ID.toBase58(),
  };
}

export async function sendSignedPrizeDepositTransaction(signedTransactionBase64) {
  const raw = String(signedTransactionBase64 ?? "").trim();
  if (!raw) throw httpError("signedTransaction is required (base64)", 400);

  let bytes;
  try {
    bytes = Buffer.from(raw, "base64");
  } catch {
    throw httpError("signedTransaction must be base64", 400);
  }
  if (!bytes.length) throw httpError("signedTransaction is empty", 400);

  const connection = getSolanaConnection();
  const signature = await connection.sendRawTransaction(bytes, {
    skipPreflight: false,
    preflightCommitment: "confirmed",
    maxRetries: 3,
  });

  const latest = await connection.getLatestBlockhash("confirmed");
  await connection.confirmTransaction(
    {
      signature,
      blockhash: latest.blockhash,
      lastValidBlockHeight: latest.lastValidBlockHeight,
    },
    "confirmed"
  );

  return { signature };
}
