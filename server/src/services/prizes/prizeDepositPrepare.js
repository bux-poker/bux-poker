import {
  PublicKey,
  SystemProgram,
  Transaction,
} from "@solana/web3.js";
import {
  TOKEN_PROGRAM_ID,
  TOKEN_2022_PROGRAM_ID,
  ASSOCIATED_TOKEN_PROGRAM_ID,
  getAssociatedTokenAddress,
  getAccount,
  createAssociatedTokenAccountInstruction,
  createTransferInstruction,
} from "@solana/spl-token";
import { getSolanaConnection } from "./prizeFunding.js";
import { buildPrizeDepositRequirements } from "./prizeDeposit.js";
import { getSharedPrizeWalletAddress } from "./prizeWallet.js";
import {
  fetchCoreAsset,
  buildCoreTransferInstruction,
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
        return { source: acct.pubkey, tokenProgramId: programId };
      }
    }
  }
  return null;
}

/**
 * Build a ready-to-sign deposit transaction on the API host.
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

  const tx = new Transaction();
  const solLamports = BigInt(requirements.solLamports || "0");
  if (solLamports > 0n) {
    tx.add(
      SystemProgram.transfer({
        fromPubkey: payer,
        toPubkey: dest,
        lamports: Number(solLamports),
      })
    );
  }

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
    const { source, tokenProgramId } = found;
    const ata = await getAssociatedTokenAddress(
      mint,
      dest,
      false,
      tokenProgramId,
      ASSOCIATED_TOKEN_PROGRAM_ID
    );
    try {
      await getAccount(connection, ata, "confirmed", tokenProgramId);
    } catch {
      tx.add(
        createAssociatedTokenAccountInstruction(
          payer,
          ata,
          dest,
          mint,
          tokenProgramId,
          ASSOCIATED_TOKEN_PROGRAM_ID
        )
      );
    }
    tx.add(
      createTransferInstruction(
        source,
        ata,
        payer,
        need,
        [],
        tokenProgramId
      )
    );
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
      tx.add(
        buildCoreTransferInstruction({
          asset: n.mint,
          collection: core.collection,
          payer,
          authority: payer,
          newOwner: dest,
        })
      );
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
    const { source, tokenProgramId } = found;
    const ata = await getAssociatedTokenAddress(
      mint,
      dest,
      false,
      tokenProgramId,
      ASSOCIATED_TOKEN_PROGRAM_ID
    );
    try {
      await getAccount(connection, ata, "confirmed", tokenProgramId);
    } catch {
      tx.add(
        createAssociatedTokenAccountInstruction(
          payer,
          ata,
          dest,
          mint,
          tokenProgramId,
          ASSOCIATED_TOKEN_PROGRAM_ID
        )
      );
    }
    tx.add(
      createTransferInstruction(source, ata, payer, 1n, [], tokenProgramId)
    );
  }

  if (tx.instructions.length === 0) {
    throw httpError("Nothing to deposit", 400);
  }

  tx.feePayer = payer;
  tx.recentBlockhash = blockhash;

  // Preflight on the API host so we fail with real logs before wallet prompt when possible.
  try {
    const sim = await connection.simulateTransaction(tx);
    if (sim.value.err) {
      const logs = (sim.value.logs || []).slice(-12).join(" | ");
      throw httpError(
        `Deposit simulation failed: ${JSON.stringify(sim.value.err)}${logs ? ` — ${logs}` : ""}`,
        400
      );
    }
  } catch (err) {
    if (err.status) throw err;
    // Non-fatal if simulate API shape differs; wallet + send-raw still gate.
    console.warn("[PRIZE DEPOSIT] prepare simulate warning:", err?.message || err);
  }

  const transactionBase64 = tx
    .serialize({ requireAllSignatures: false, verifySignatures: false })
    .toString("base64");

  return {
    blockhash,
    lastValidBlockHeight,
    feePayer: payerStr,
    prizeWalletAddress: destStr,
    solLamports: requirements.solLamports,
    solAmount: requirements.solAmount,
    transactionBase64,
    tokenProgramId: TOKEN_PROGRAM_ID.toBase58(),
    associatedTokenProgramId: ASSOCIATED_TOKEN_PROGRAM_ID.toBase58(),
  };
}

async function formatSendError(connection, err) {
  const msg = String(err?.message || "Transaction failed");
  let logs = err?.logs;
  if ((!logs || !logs.length) && typeof err?.getLogs === "function") {
    try {
      logs = await err.getLogs(connection);
    } catch {
      /* ignore */
    }
  }
  if (/blockhash/i.test(msg) || /BlockhashNotFound/i.test(msg)) {
    return "Deposit blockhash expired — click Deposit again and approve within ~60 seconds.";
  }
  const logTail =
    Array.isArray(logs) && logs.length
      ? ` — ${logs.slice(-12).join(" | ")}`
      : "";
  if (!logTail && /simulation failed/i.test(msg)) {
    return `${msg} Often caused by a stale blockhash or public RPC rate limits — retry Deposit and approve quickly.`;
  }
  return `${msg}${logTail}`;
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

  let txBlockhash = null;
  let parsedTx = null;
  try {
    parsedTx = Transaction.from(bytes);
    txBlockhash = parsedTx.recentBlockhash || null;
  } catch (err) {
    throw httpError(
      `Could not decode signed transaction: ${err?.message || err}`,
      400
    );
  }

  if (txBlockhash) {
    try {
      const valid = await connection.isBlockhashValid(txBlockhash, {
        commitment: "processed",
      });
      if (valid?.value === false) {
        throw httpError(
          "Deposit blockhash expired — click Deposit again and approve within ~60 seconds.",
          400
        );
      }
    } catch (err) {
      if (err.status) throw err;
      console.warn(
        "[PRIZE DEPOSIT] isBlockhashValid failed:",
        err?.message || err
      );
    }
  }

  // Skip RPC preflight: we already simulate during prepare. Public mainnet RPC
  // often returns empty-log simulation failures (429 / flaky) on sendTransaction.
  let signature;
  try {
    signature = await connection.sendRawTransaction(bytes, {
      skipPreflight: true,
      maxRetries: 5,
      preflightCommitment: "confirmed",
    });
  } catch (err) {
    console.error("[PRIZE DEPOSIT] sendRawTransaction failed:", err?.message || err);
    throw httpError(await formatSendError(connection, err), 400);
  }

  console.log("[PRIZE DEPOSIT] submitted", signature);

  try {
    const latest = await connection.getLatestBlockhash("confirmed");
    await connection.confirmTransaction(
      {
        signature,
        blockhash: txBlockhash || latest.blockhash,
        lastValidBlockHeight: latest.lastValidBlockHeight,
      },
      "confirmed"
    );
  } catch (err) {
    // Tx may still land; confirm endpoint verifies vault balances / Core ownership.
    console.warn(
      "[PRIZE DEPOSIT] confirm wait failed:",
      err?.message || err,
      "sig",
      signature
    );
  }

  return { signature };
}
