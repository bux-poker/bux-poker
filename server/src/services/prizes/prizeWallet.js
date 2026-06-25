import { Keypair, PublicKey } from "@solana/web3.js";
import bs58 from "bs58";
import { encryptPrizeWalletSecret } from "./prizeWalletCrypto.js";

function invalid(message) {
  const err = new Error(message);
  err.status = 400;
  return err;
}

/** Parse creator-supplied Solana secret key (JSON byte array, base64, or base58). */
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

export function isPrizeWalletConfigured(record) {
  return !!(record?.prizeWalletAddress && record?.prizeWalletSecretEnc);
}
