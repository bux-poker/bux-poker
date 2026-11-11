import { Keypair, PublicKey } from "@solana/web3.js";
import bs58 from "bs58";
import { encryptPrizeWalletSecret, decryptPrizeWalletSecret } from "./prizeWalletCrypto.js";

function invalid(message) {
  const err = new Error(message);
  err.status = 400;
  return err;
}

/** Parse Solana secret key (JSON byte array, base64, or base58). */
export function parseSuppliedSecretKey(raw) {
  const trimmed = String(raw ?? "").trim();
  if (!trimmed) throw invalid("Prize wallet private key is required");

  if (trimmed.startsWith("[")) {
    let arr;
    try {
      arr = JSON.parse(trimmed);
    } catch {
      throw invalid("Invalid JSON byte array for private key");
    }
    if (!Array.isArray(arr) || arr.length !== 64) {
      throw invalid("Private key JSON array must be 64 bytes");
    }
    return Uint8Array.from(arr.map((n) => Number(n)));
  }

  if (/^[A-Za-z0-9+/=]+$/.test(trimmed) && trimmed.length > 80) {
    try {
      const buf = Buffer.from(trimmed, "base64");
      if (buf.length === 64) return new Uint8Array(buf);
    } catch {
      /* try base58 */
    }
  }

  try {
    const decoded = bs58.decode(trimmed);
    if (decoded.length === 64) return decoded;
  } catch {
    /* fall through */
  }

  throw invalid(
    "Private key must be a 64-byte JSON array, base64, or base58 Solana secret key"
  );
}

/** Shared vault from Fly env — used for all WALLET tournaments/leagues. */
export function getSharedPrizeWalletKeypair() {
  const raw = process.env.PRIZE_WALLET_PRIVATE_KEY;
  if (!raw || !String(raw).trim()) return null;
  try {
    return Keypair.fromSecretKey(parseSuppliedSecretKey(raw));
  } catch (err) {
    console.error("[prizes] Invalid PRIZE_WALLET_PRIVATE_KEY:", err.message);
    return null;
  }
}

export function getSharedPrizeWalletAddress() {
  const kp = getSharedPrizeWalletKeypair();
  if (!kp) return null;
  const derived = kp.publicKey.toBase58();
  const configured = String(process.env.PRIZE_WALLET_ADDRESS || "").trim();
  if (configured && configured !== derived) {
    console.error(
      "[prizes] PRIZE_WALLET_ADDRESS does not match PRIZE_WALLET_PRIVATE_KEY pubkey"
    );
    return null;
  }
  return derived;
}

export function isSharedPrizeWalletConfigured() {
  return !!getSharedPrizeWalletAddress();
}

/** @deprecated Prefer shared env wallet; kept for one-off legacy saves. */
export function buildPrizeWalletRecordFromSupplied({ prizeWalletAddress, privateKey }) {
  const address = String(prizeWalletAddress ?? "").trim();
  if (!address) throw invalid("Prize wallet address is required");

  let expectedPubkey;
  try {
    expectedPubkey = new PublicKey(address);
  } catch {
    throw invalid("Invalid prize wallet address");
  }

  const secretKey = parseSuppliedSecretKey(privateKey);
  let keypair;
  try {
    keypair = Keypair.fromSecretKey(secretKey);
  } catch {
    throw invalid("Invalid private key for Solana keypair");
  }

  if (!keypair.publicKey.equals(expectedPubkey)) {
    throw invalid("Private key does not match the prize wallet address");
  }

  return {
    prizeWalletAddress: keypair.publicKey.toBase58(),
    prizeWalletSecretEnc: encryptPrizeWalletSecret(
      Buffer.from(keypair.secretKey).toString("base64")
    ),
  };
}

/**
 * Ready to pay claims when shared Fly vault is set (and row points at it),
 * or legacy per-event encrypted secret is present.
 */
export function isPrizeWalletConfigured(record) {
  const shared = getSharedPrizeWalletAddress();
  if (shared) {
    if (!record?.prizeWalletAddress) return false;
    return record.prizeWalletAddress === shared || !!record.prizeWalletSecretEnc;
  }
  return !!(record?.prizeWalletAddress && record?.prizeWalletSecretEnc);
}

export function loadPrizeWalletKeypair(record) {
  const sharedKp = getSharedPrizeWalletKeypair();
  const sharedAddr = sharedKp?.publicKey.toBase58() ?? null;

  if (sharedKp && record?.prizeWalletAddress) {
    if (
      record.prizeWalletAddress === sharedAddr ||
      !record.prizeWalletSecretEnc
    ) {
      return sharedKp;
    }
  }

  if (!record?.prizeWalletAddress || !record?.prizeWalletSecretEnc) {
    const err = new Error(
      sharedAddr
        ? "Prize wallet is not configured on this event"
        : "Shared prize wallet is not configured (set PRIZE_WALLET_PRIVATE_KEY on the API host)"
    );
    err.status = 400;
    throw err;
  }

  const secretB64 = decryptPrizeWalletSecret(record.prizeWalletSecretEnc);
  if (!secretB64) {
    const err = new Error("Could not decrypt prize wallet key");
    err.status = 500;
    throw err;
  }
  const secretKey = Uint8Array.from(Buffer.from(secretB64, "base64"));
  return Keypair.fromSecretKey(secretKey);
}
