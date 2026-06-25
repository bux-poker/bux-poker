import { Connection, PublicKey } from "@solana/web3.js";
import { TOKEN_PROGRAM_ID } from "@solana/spl-token";
import { parsePrizeStructureJson } from "./prizeStructure.js";

const DEFAULT_RPC = "https://api.mainnet-beta.solana.com";

export function getSolanaConnection() {
  const url = process.env.SOLANA_RPC_URL || DEFAULT_RPC;
  return new Connection(url, "confirmed");
}

/** Sum all assets required in the prize wallet at once (all places + fee buffer). */
export function aggregateWalletRequirements(prizeStructureJson, feeLamports) {
  const structure = parsePrizeStructureJson(prizeStructureJson);
  let totalSolLamports = BigInt(feeLamports ?? 0);
  /** @type {Map<string, bigint>} */
  const splByMint = new Map();
  /** @type {Set<string>} */
  const nftMints = new Set();

  for (const place of structure) {
    for (const item of place.items || []) {
      if (item.kind === "SOL") {
        totalSolLamports += BigInt(item.lamports || 0);
      } else if (item.kind === "SPL") {
        const mint = String(item.mint || "").trim();
        if (!mint) continue;
        const prev = splByMint.get(mint) || 0n;
        splByMint.set(mint, prev + BigInt(item.amount || 0));
      } else if (item.kind === "NFT") {
        const mint = String(item.mint || "").trim();
        if (mint) nftMints.add(mint);
      }
    }
  }

  return {
    totalSolLamports,
    splByMint,
    nftMints: [...nftMints],
  };
}

function mintUiAmount(accounts, mint) {
  let total = 0n;
  for (const acct of accounts) {
    const info = acct.account.data.parsed?.info;
    if (!info || info.mint !== mint) continue;
    const amt = info.tokenAmount?.amount;
    if (amt != null) total += BigInt(amt);
  }
  return total;
}

function hasNft(accounts, mint) {
  return accounts.some((acct) => {
    const info = acct.account.data.parsed?.info;
    return (
      info?.mint === mint &&
      BigInt(info.tokenAmount?.amount || 0) >= 1n
    );
  });
}

/**
 * @returns {Promise<{ funded: boolean, status: 'FUNDED'|'PARTIAL'|'PENDING', balanceSol: string, missing: string[] }>}
 */
export async function checkPrizeWalletFunding({
  walletAddress,
  prizeStructureJson,
  feeLamports,
}) {
  if (!walletAddress) {
    return {
      funded: false,
      status: "PENDING",
      balanceSol: "0",
      missing: ["Prize wallet address not configured"],
    };
  }

  const req = aggregateWalletRequirements(prizeStructureJson, feeLamports);
  const connection = getSolanaConnection();
  const owner = new PublicKey(walletAddress);
  const missing = [];

  const lamportBalance = BigInt(await connection.getBalance(owner));
  if (lamportBalance < req.totalSolLamports) {
    const need = req.totalSolLamports - lamportBalance;
    missing.push(
      `SOL: need ${formatLamports(req.totalSolLamports)} total (${formatLamports(need)} more)`
    );
  }

  let tokenAccounts = [];
  try {
    const resp = await connection.getParsedTokenAccountsByOwner(owner, {
      programId: TOKEN_PROGRAM_ID,
    });
    tokenAccounts = resp.value;
  } catch (err) {
    missing.push(`Could not read token accounts: ${err?.message || err}`);
  }

  for (const [mint, needAmt] of req.splByMint.entries()) {
    const have = mintUiAmount(tokenAccounts, mint);
    if (have < needAmt) {
      missing.push(
        `SPL ${mint.slice(0, 8)}…: need ${needAmt.toString()}, have ${have.toString()}`
      );
    }
  }

  for (const mint of req.nftMints) {
    if (!hasNft(tokenAccounts, mint)) {
      missing.push(`NFT mint ${mint.slice(0, 8)}… not found in wallet`);
    }
  }

  const funded = missing.length === 0;
  return {
    funded,
    status: funded ? "FUNDED" : missing.length && lamportBalance > 0n ? "PARTIAL" : "PENDING",
    balanceSol: formatLamports(lamportBalance),
    missing,
    requiredFeeAndSol: formatLamports(req.totalSolLamports),
  };
}

function formatLamports(lamports) {
  const n = BigInt(lamports);
  const whole = n / 1_000_000_000n;
  const frac = n % 1_000_000_000n;
  if (frac === 0n) return `${whole} SOL`;
  return `${whole}.${frac.toString().padStart(9, "0").replace(/0+$/, "")} SOL`;
}
