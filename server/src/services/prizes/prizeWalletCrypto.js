import crypto from "crypto";

const ALGO = "aes-256-gcm";
const IV_LEN = 12;

function getEncryptionKey() {
  const raw = process.env.PRIZE_WALLET_ENCRYPTION_KEY || "";
  if (!raw) return null;
  return crypto.createHash("sha256").update(raw).digest();
}

export function encryptPrizeWalletSecret(secretKeyBase64) {
  const key = getEncryptionKey();
  if (!key) {
    console.warn(
      "[PRIZES] PRIZE_WALLET_ENCRYPTION_KEY not set — storing wallet secret without encryption (dev only)"
    );
    return `plain:${secretKeyBase64}`;
  }
  const iv = crypto.randomBytes(IV_LEN);
  const cipher = crypto.createCipheriv(ALGO, key, iv);
  const enc = Buffer.concat([
    cipher.update(secretKeyBase64, "utf8"),
    cipher.final(),
  ]);
  const tag = cipher.getAuthTag();
  return `gcm:${iv.toString("base64")}:${tag.toString("base64")}:${enc.toString("base64")}`;
}

export function decryptPrizeWalletSecret(stored) {
  if (!stored) return null;
  if (stored.startsWith("plain:")) {
    return stored.slice("plain:".length);
  }
  if (!stored.startsWith("gcm:")) return null;
  const key = getEncryptionKey();
  if (!key) return null;
  const parts = stored.split(":");
  if (parts.length !== 4) return null;
  const iv = Buffer.from(parts[1], "base64");
  const tag = Buffer.from(parts[2], "base64");
  const data = Buffer.from(parts[3], "base64");
  const decipher = crypto.createDecipheriv(ALGO, key, iv);
  decipher.setAuthTag(tag);
  const dec = Buffer.concat([decipher.update(data), decipher.final()]);
  return dec.toString("utf8");
}
