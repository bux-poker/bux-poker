import { PublicKey } from "@solana/web3.js";
import { TOKEN_PROGRAM_ID } from "@solana/spl-token";
import {
  aggregateWalletRequirements,
  getSolanaConnection,
} from "./prizeFunding.js";
import { lamportsToSolString } from "./prizeStructure.js";
import { getSharedPrizeWalletAddress } from "./prizeWallet.js";

/**
 * Human-readable + machine deposit instructions for funding THIS event only.
 */
export function buildPrizeDepositRequirements({
  prizeStructureJson,
  feeLamports,
  prizeWalletAddress,
}) {
  const dest =
    String(prizeWalletAddress || "").trim() || getSharedPrizeWalletAddress();
  if (!dest) {
    const err = new Error(
      "Shared prize wallet is not configured (set PRIZE_WALLET_PRIVATE_KEY on the API host)"
    );
    err.status = 503;
    throw err;
  }

  const req = aggregateWalletRequirements(prizeStructureJson, feeLamports);
  const spl = [...req.splByMint.entries()].map(([mint, amount]) => ({
    mint,
    amount: amount.toString(),
  }));

  return {
    prizeWalletAddress: dest,
    solLamports: req.totalSolLamports.toString(),
    solAmount: lamportsToSolString(req.totalSolLamports),
    feeSol: lamportsToSolString(feeLamports ?? 0),
    spl,
    nfts: req.nftMints.map((mint) => ({ mint })),
    rpcUrl: process.env.SOLANA_RPC_URL || "https://api.mainnet-beta.solana.com",
  };
}

function accountKeys(tx) {
  const message = tx.transaction.message;
  const keys = message.accountKeys || [];
  return keys.map((k) => (typeof k === "string" ? k : k.pubkey?.toBase58?.() || k.toString()));
}

/**
 * Verify a confirmed deposit tx sent the required SOL (+ optional SPL/NFT) to the vault.
 * Cover-this-event amounts only — does not look at prior vault balance.
 */
export async function verifyPrizeDepositTransaction({
  signature,
  prizeStructureJson,
  feeLamports,
  prizeWalletAddress,
}) {
  const dest = String(prizeWalletAddress || "").trim();
  if (!dest) {
    const err = new Error("Prize wallet address missing");
    err.status = 400;
    throw err;
  }

  const requirements = buildPrizeDepositRequirements({
    prizeStructureJson,
    feeLamports,
    prizeWalletAddress: dest,
  });

  const connection = getSolanaConnection();
  const tx = await connection.getParsedTransaction(signature, {
    maxSupportedTransactionVersion: 0,
    commitment: "confirmed",
  });

  if (!tx || !tx.meta || tx.meta.err) {
    const err = new Error("Deposit transaction not found or failed on-chain");
    err.status = 400;
    throw err;
  }

  const keys = accountKeys(tx);
  const destIndex = keys.findIndex((k) => k === dest);
  if (destIndex < 0) {
    const err = new Error("Deposit transaction does not involve the prize wallet");
    err.status = 400;
    throw err;
  }

  const pre = BigInt(tx.meta.preBalances[destIndex] ?? 0);
  const post = BigInt(tx.meta.postBalances[destIndex] ?? 0);
  const solReceived = post > pre ? post - pre : 0n;
  const needSol = BigInt(requirements.solLamports);

  const missing = [];
  if (solReceived < needSol) {
    missing.push(
      `SOL: deposit sent ${lamportsToSolString(solReceived)}, need ${requirements.solAmount}`
    );
  }

  /** @type {Map<string, bigint>} */
  const tokenGains = new Map();
  const preTokens = tx.meta.preTokenBalances || [];
  const postTokens = tx.meta.postTokenBalances || [];

  for (const postBal of postTokens) {
    if (postBal.owner !== dest) continue;
    const mint = postBal.mint;
    const postAmt = BigInt(postBal.uiTokenAmount?.amount || 0);
    const preBal = preTokens.find(
      (p) => p.owner === dest && p.mint === mint && p.accountIndex === postBal.accountIndex
    );
    const preAmt = BigInt(preBal?.uiTokenAmount?.amount || 0);
    const gain = postAmt > preAmt ? postAmt - preAmt : 0n;
    if (gain > 0n) {
      tokenGains.set(mint, (tokenGains.get(mint) || 0n) + gain);
    }
  }

  // Also catch brand-new ATAs (no pre balance row)
  for (const postBal of postTokens) {
    if (postBal.owner !== dest) continue;
    const mint = postBal.mint;
    if (tokenGains.has(mint)) continue;
    const hadPre = preTokens.some((p) => p.owner === dest && p.mint === mint);
    if (!hadPre) {
      const postAmt = BigInt(postBal.uiTokenAmount?.amount || 0);
      if (postAmt > 0n) tokenGains.set(mint, postAmt);
    }
  }

  for (const { mint, amount } of requirements.spl) {
    const got = tokenGains.get(mint) || 0n;
    const need = BigInt(amount);
    if (got < need) {
      missing.push(`SPL ${mint.slice(0, 8)}…: got ${got}, need ${need}`);
    }
  }

  for (const { mint } of requirements.nfts) {
    const got = tokenGains.get(mint) || 0n;
    if (got < 1n) {
      missing.push(`NFT ${mint.slice(0, 8)}… not received`);
    }
  }

  if (missing.length) {
    const err = new Error(`Deposit incomplete: ${missing.join("; ")}`);
    err.status = 400;
    err.missing = missing;
    throw err;
  }

  // Sanity: destination is a valid pubkey
  try {
    new PublicKey(dest);
  } catch {
    const err = new Error("Invalid prize wallet address");
    err.status = 400;
    throw err;
  }

  return {
    ok: true,
    signature,
    requirements,
    tokenProgramId: TOKEN_PROGRAM_ID.toBase58(),
  };
}
