import {
  Keypair,
  PublicKey,
  SystemProgram,
  Transaction,
  sendAndConfirmTransaction,
} from "@solana/web3.js";
import {
  TOKEN_PROGRAM_ID,
  TOKEN_2022_PROGRAM_ID,
  ASSOCIATED_TOKEN_PROGRAM_ID,
  getAssociatedTokenAddress,
  createAssociatedTokenAccountInstruction,
  createTransferInstruction,
  getAccount,
} from "@solana/spl-token";
import { getSolanaConnection } from "./prizeFunding.js";
import {
  fetchCoreAsset,
  buildCoreTransferInstruction,
} from "./mplCore.js";

const BASE58_RE = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;

export function validateRecipientAddress(address) {
  const trimmed = String(address ?? "").trim();
  if (!BASE58_RE.test(trimmed)) {
    const err = new Error("Invalid Solana wallet address");
    err.status = 400;
    throw err;
  }
  try {
    return new PublicKey(trimmed);
  } catch {
    const err = new Error("Invalid Solana wallet address");
    err.status = 400;
    throw err;
  }
}

export function solscanTxUrl(signature) {
  return `https://solscan.io/tx/${signature}`;
}

async function getTokenAccountsForOwner(connection, owner) {
  const [legacy, token2022] = await Promise.all([
    connection.getParsedTokenAccountsByOwner(owner, {
      programId: TOKEN_PROGRAM_ID,
    }),
    connection.getParsedTokenAccountsByOwner(owner, {
      programId: TOKEN_2022_PROGRAM_ID,
    }),
  ]);
  return [
    ...legacy.value.map((a) => ({ ...a, tokenProgramId: TOKEN_PROGRAM_ID })),
    ...token2022.value.map((a) => ({
      ...a,
      tokenProgramId: TOKEN_2022_PROGRAM_ID,
    })),
  ];
}

function findSourceTokenAccount(tokenAccounts, mint, needAmount) {
  for (const acct of tokenAccounts) {
    const info = acct.account.data.parsed?.info;
    if (!info || info.mint !== mint) continue;
    const amount = BigInt(info.tokenAmount?.amount || 0);
    if (amount >= needAmount) {
      return {
        pubkey: acct.pubkey,
        amount,
        tokenProgramId: acct.tokenProgramId || TOKEN_PROGRAM_ID,
      };
    }
  }
  return null;
}

async function ensureRecipientAta(connection, payer, mint, owner, tokenProgramId) {
  const programId = tokenProgramId || TOKEN_PROGRAM_ID;
  const ata = await getAssociatedTokenAddress(
    mint,
    owner,
    false,
    programId,
    ASSOCIATED_TOKEN_PROGRAM_ID
  );
  try {
    await getAccount(connection, ata, undefined, programId);
    return { ata, createIx: null };
  } catch {
    const createIx = createAssociatedTokenAccountInstruction(
      payer.publicKey,
      ata,
      owner,
      mint,
      programId,
      ASSOCIATED_TOKEN_PROGRAM_ID
    );
    return { ata, createIx };
  }
}

async function sendTransaction(connection, payer, instructions) {
  const tx = new Transaction().add(...instructions);
  return sendAndConfirmTransaction(connection, tx, [payer], {
    commitment: "confirmed",
    maxRetries: 5,
  });
}

/**
 * Transfer prize assets for one finishing place to recipient.
 * @returns {Promise<string[]>} transaction signatures
 */
export async function executePlacePayout({
  keypair,
  recipientPubkey,
  placeItems,
  connection = getSolanaConnection(),
}) {
  if (!Array.isArray(placeItems) || placeItems.length === 0) {
    const err = new Error("No prize assets configured for this place");
    err.status = 400;
    throw err;
  }

  const signatures = [];
  const tokenAccounts = await getTokenAccountsForOwner(
    connection,
    keypair.publicKey
  );

  for (const item of placeItems) {
    const kind = String(item.kind || "").toUpperCase();

    if (kind === "SOL") {
      const lamports = BigInt(item.lamports || 0);
      if (lamports <= 0n) continue;
      const ix = SystemProgram.transfer({
        fromPubkey: keypair.publicKey,
        toPubkey: recipientPubkey,
        lamports: Number(lamports),
      });
      signatures.push(await sendTransaction(connection, keypair, [ix]));
      continue;
    }

    if (kind === "NFT") {
      const core = await fetchCoreAsset(connection, item.mint);
      if (core) {
        if (core.owner !== keypair.publicKey.toBase58()) {
          const err = new Error(
            `Prize wallet is missing Core NFT ${String(item.mint).slice(0, 8)}…`
          );
          err.status = 409;
          throw err;
        }
        const ix = buildCoreTransferInstruction({
          asset: item.mint,
          collection: core.collection,
          payer: keypair.publicKey,
          authority: keypair.publicKey,
          newOwner: recipientPubkey,
        });
        signatures.push(await sendTransaction(connection, keypair, [ix]));
        continue;
      }
    }

    if (kind === "SPL" || kind === "NFT") {
      const mint = new PublicKey(item.mint);
      const amount = kind === "NFT" ? 1n : BigInt(item.amount || 0);
      if (amount <= 0n) continue;

      const source = findSourceTokenAccount(
        tokenAccounts,
        mint.toBase58(),
        amount
      );
      if (!source) {
        const err = new Error(
          `Prize wallet is missing ${kind === "NFT" ? "NFT" : "token"} ${mint.toBase58().slice(0, 8)}…`
        );
        err.status = 409;
        throw err;
      }

      const { ata: destAta, createIx } = await ensureRecipientAta(
        connection,
        keypair,
        mint,
        recipientPubkey,
        source.tokenProgramId
      );

      const instructions = [];
      if (createIx) instructions.push(createIx);
      instructions.push(
        createTransferInstruction(
          source.pubkey,
          destAta,
          keypair.publicKey,
          amount,
          [],
          source.tokenProgramId
        )
      );

      signatures.push(await sendTransaction(connection, keypair, instructions));
    }
  }

  if (signatures.length === 0) {
    const err = new Error("No transferable prize assets for this place");
    err.status = 400;
    throw err;
  }

  return signatures;
}
