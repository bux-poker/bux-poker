import { PublicKey } from "@solana/web3.js";
import {
  TOKEN_PROGRAM_ID,
  ASSOCIATED_TOKEN_PROGRAM_ID,
  getAssociatedTokenAddress,
  getAccount,
} from "@solana/spl-token";
import { getSolanaConnection } from "./prizeFunding.js";
import { buildPrizeDepositRequirements } from "./prizeDeposit.js";
import { getSharedPrizeWalletAddress } from "./prizeWallet.js";

function httpError(message, status) {
  const err = new Error(message);
  err.status = status;
  return err;
}

async function findSourceTokenAccount(connection, owner, mint, need) {
  const resp = await connection.getParsedTokenAccountsByOwner(owner, {
    programId: TOKEN_PROGRAM_ID,
  });
  for (const acct of resp.value) {
    const info = acct.account.data.parsed?.info;
    if (!info || info.mint !== mint.toBase58()) continue;
    const amount = BigInt(info.tokenAmount?.amount || 0);
    if (amount >= need) return acct.pubkey.toBase58();
  }
  return null;
}

/**
 * Build deposit plan + fresh blockhash using the API host RPC (avoids browser 403 on public RPC).
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
  const transfers = [
    ...requirements.spl.map((s) => ({ mint: s.mint, amount: s.amount })),
    ...requirements.nfts.map((n) => ({ mint: n.mint, amount: "1" })),
  ];

  for (const t of transfers) {
    const mint = new PublicKey(t.mint);
    const need = BigInt(t.amount);
    const source = await findSourceTokenAccount(connection, payer, mint, need);
    if (!source) {
      throw httpError(
        `Funding wallet is missing token ${t.mint.slice(0, 8)}… (need ${t.amount})`,
        400
      );
    }
    const ata = await getAssociatedTokenAddress(
      mint,
      dest,
      false,
      TOKEN_PROGRAM_ID,
      ASSOCIATED_TOKEN_PROGRAM_ID
    );
    let createDestAta = false;
    try {
      await getAccount(connection, ata, "confirmed", TOKEN_PROGRAM_ID);
    } catch {
      createDestAta = true;
    }
    tokenTransfers.push({
      mint: t.mint,
      amount: t.amount,
      source,
      destinationAta: ata.toBase58(),
      createDestAta,
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
