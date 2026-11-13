import { PublicKey } from "@solana/web3.js";
import { TOKEN_PROGRAM_ID } from "@solana/spl-token";
import {
  aggregateWalletRequirements,
  getSolanaConnection,
} from "./prizeFunding.js";
import { lamportsToSolString } from "./prizeStructure.js";
import { getSharedPrizeWalletAddress } from "./prizeWallet.js";
import { fetchCoreAsset } from "./mplCore.js";

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
  return keys.map((k) =>
    typeof k === "string" ? k : k.pubkey?.toBase58?.() || k.toString()
  );
}

function normalizeSignatures(input) {
  if (Array.isArray(input)) {
    return [...new Set(input.map((s) => String(s ?? "").trim()).filter(Boolean))];
  }
  const one = String(input ?? "").trim();
  return one ? [one] : [];
}

/**
 * Sum SOL + token gains to `dest` across one parsed tx.
 */
function gainsFromParsedTx(tx, dest) {
  let solReceived = 0n;
  /** @type {Map<string, bigint>} */
  const tokenGains = new Map();

  const keys = accountKeys(tx);
  const destIndex = keys.findIndex((k) => k === dest);
  if (destIndex >= 0 && tx.meta) {
    const pre = BigInt(tx.meta.preBalances[destIndex] ?? 0);
    const post = BigInt(tx.meta.postBalances[destIndex] ?? 0);
    if (post > pre) solReceived = post - pre;
  }

  const preTokens = tx.meta?.preTokenBalances || [];
  const postTokens = tx.meta?.postTokenBalances || [];

  for (const postBal of postTokens) {
    if (postBal.owner !== dest) continue;
    const mint = postBal.mint;
    const postAmt = BigInt(postBal.uiTokenAmount?.amount || 0);
    const preBal = preTokens.find(
      (p) =>
        p.owner === dest &&
        p.mint === mint &&
        p.accountIndex === postBal.accountIndex
    );
    const preAmt = BigInt(preBal?.uiTokenAmount?.amount || 0);
    const gain = postAmt > preAmt ? postAmt - preAmt : 0n;
    if (gain > 0n) {
      tokenGains.set(mint, (tokenGains.get(mint) || 0n) + gain);
    }
  }

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

  return { solReceived, tokenGains, involved: destIndex >= 0 };
}

/**
 * Verify confirmed deposit tx(s) sent the required SOL (+ SPL/NFT) to the vault.
 * Amounts are for THIS event only — sums across all provided signatures.
 *
 * @param {{ signatures?: string[], signature?: string, prizeStructureJson: string, feeLamports: any, prizeWalletAddress: string }} args
 */
export async function verifyPrizeDepositTransaction({
  signatures,
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

  try {
    new PublicKey(dest);
  } catch {
    const err = new Error("Invalid prize wallet address");
    err.status = 400;
    throw err;
  }

  const sigs = normalizeSignatures(signatures ?? signature);
  if (!sigs.length) {
    const err = new Error("At least one deposit transaction signature is required");
    err.status = 400;
    throw err;
  }

  const requirements = buildPrizeDepositRequirements({
    prizeStructureJson,
    feeLamports,
    prizeWalletAddress: dest,
  });

  const connection = getSolanaConnection();
  let solReceived = 0n;
  /** @type {Map<string, bigint>} */
  const tokenGains = new Map();
  let anyInvolved = false;

  for (const sig of sigs) {
    const tx = await connection.getParsedTransaction(sig, {
      maxSupportedTransactionVersion: 0,
      commitment: "confirmed",
    });

    if (!tx || !tx.meta || tx.meta.err) {
      const err = new Error(
        `Deposit transaction not found or failed on-chain (${sig.slice(0, 8)}…)`
      );
      err.status = 400;
      throw err;
    }

    const gains = gainsFromParsedTx(tx, dest);
    if (gains.involved) anyInvolved = true;
    solReceived += gains.solReceived;
    for (const [mint, amt] of gains.tokenGains) {
      tokenGains.set(mint, (tokenGains.get(mint) || 0n) + amt);
    }
  }

  if (!anyInvolved) {
    const err = new Error("Deposit transaction(s) do not involve the prize wallet");
    err.status = 400;
    throw err;
  }

  const missing = [];
  const needSol = BigInt(requirements.solLamports);
  if (solReceived < needSol) {
    missing.push(
      `SOL: deposit sent ${lamportsToSolString(solReceived)}, need ${requirements.solAmount}`
    );
  }

  for (const { mint, amount } of requirements.spl) {
    const got = tokenGains.get(mint) || 0n;
    const need = BigInt(amount);
    if (got < need) {
      missing.push(`SPL ${mint.slice(0, 8)}…: got ${got}, need ${need}`);
    }
  }

  for (const { mint } of requirements.nfts) {
    const core = await fetchCoreAsset(connection, mint);
    if (core) {
      if (core.owner !== dest) {
        missing.push(
          `Core NFT ${mint.slice(0, 8)}… not in vault (owner ${core.owner.slice(0, 4)}…)`
        );
      }
      continue;
    }
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

  return {
    ok: true,
    signatures: sigs,
    requirements,
    tokenProgramId: TOKEN_PROGRAM_ID.toBase58(),
  };
}
