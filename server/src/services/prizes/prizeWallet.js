import { Keypair } from "@solana/web3.js";
import { encryptPrizeWalletSecret } from "./prizeWalletCrypto.js";

export function createPrizeWalletRecord() {
  const keypair = Keypair.generate();
  return {
    prizeWalletAddress: keypair.publicKey.toBase58(),
    prizeWalletSecretEnc: encryptPrizeWalletSecret(
      Buffer.from(keypair.secretKey).toString("base64")
    ),
  };
}
