import {
  PublicKey,
  SystemProgram,
  TransactionInstruction,
} from "@solana/web3.js";

/** Metaplex Core (MPL Core) program — digital assets, not SPL token accounts. */
export const MPL_CORE_PROGRAM_ID = new PublicKey(
  "CoREENxT6tW1HoK8ypY1SxRMZTcVPm7R94rH4PZNhX7d"
);

/** SPL Noop — required log wrapper for Core transfer_v1. */
const SPL_NOOP_PROGRAM_ID = new PublicKey(
  "noopb9bkMVfRPU8AsbpTUg8AQkHtKwMYZiFUjNRtMmV"
);

/** TransferV1 discriminator + Option::None compression_proof */
const TRANSFER_V1_DATA = Buffer.from([14, 0]);

/**
 * Decode BaseAssetV1 header: key (u8) + owner (Pubkey) + UpdateAuthority enum.
 * UpdateAuthority::Collection = 2 + pubkey.
 * @returns {{ owner: string, collection: string | null } | null}
 */
export function decodeCoreAssetHeader(data) {
  if (!data || data.length < 34) return null;
  // Key::AssetV1 === 1
  if (data[0] !== 1) return null;
  const owner = new PublicKey(data.subarray(1, 33)).toBase58();
  const ua = data[33];
  let collection = null;
  if (ua === 2 && data.length >= 66) {
    collection = new PublicKey(data.subarray(34, 66)).toBase58();
  }
  return { owner, collection };
}

export async function fetchCoreAsset(connection, assetAddress) {
  const pubkey = new PublicKey(assetAddress);
  const info = await connection.getAccountInfo(pubkey, "confirmed");
  if (!info) return null;
  if (!info.owner.equals(MPL_CORE_PROGRAM_ID)) return null;
  const header = decodeCoreAssetHeader(info.data);
  if (!header) return null;
  return {
    address: pubkey.toBase58(),
    owner: header.owner,
    collection: header.collection,
  };
}

export async function isCoreAsset(connection, assetAddress) {
  const asset = await fetchCoreAsset(connection, assetAddress);
  return !!asset;
}

/**
 * Build a Core TransferV1 instruction (no Umi dependency).
 * @param {{ asset: PublicKey|string, collection?: PublicKey|string|null, payer: PublicKey|string, authority?: PublicKey|string, newOwner: PublicKey|string }} args
 */
export function buildCoreTransferInstruction({
  asset,
  collection = null,
  payer,
  authority = null,
  newOwner,
}) {
  const assetPk = asset instanceof PublicKey ? asset : new PublicKey(asset);
  const payerPk = payer instanceof PublicKey ? payer : new PublicKey(payer);
  const authorityPk = authority
    ? authority instanceof PublicKey
      ? authority
      : new PublicKey(authority)
    : payerPk;
  const newOwnerPk =
    newOwner instanceof PublicKey ? newOwner : new PublicKey(newOwner);
  const collectionPk = collection
    ? collection instanceof PublicKey
      ? collection
      : new PublicKey(collection)
    : MPL_CORE_PROGRAM_ID;

  return new TransactionInstruction({
    programId: MPL_CORE_PROGRAM_ID,
    keys: [
      { pubkey: assetPk, isSigner: false, isWritable: true },
      { pubkey: collectionPk, isSigner: false, isWritable: false },
      { pubkey: payerPk, isSigner: true, isWritable: true },
      { pubkey: authorityPk, isSigner: true, isWritable: false },
      { pubkey: newOwnerPk, isSigner: false, isWritable: false },
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
      { pubkey: SPL_NOOP_PROGRAM_ID, isSigner: false, isWritable: false },
    ],
    data: TRANSFER_V1_DATA,
  });
}

/** Serialize a TransactionInstruction for the browser wallet builder. */
export function serializeInstruction(ix) {
  return {
    programId: ix.programId.toBase58(),
    keys: ix.keys.map((k) => ({
      pubkey: k.pubkey.toBase58(),
      isSigner: k.isSigner,
      isWritable: k.isWritable,
    })),
    data: Buffer.from(ix.data).toString("base64"),
  };
}
