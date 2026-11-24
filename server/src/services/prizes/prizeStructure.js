/** @typedef {'SOL' | 'SPL' | 'NFT'} PrizeAssetKind */

const BASE58_RE = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;

export const WALLET_CLAIM_EXPIRY_DAYS = 7;
export const FEE_SOL_BASE_LAMPORTS = 10_000_000n; // 0.01 SOL
export const FEE_SOL_PER_PLACE_LAMPORTS = 5_000_000n; // 0.005 SOL per paid place (claim + sweep buffer)

export function estimatePrizeFeeSolLamports(prizePlaces) {
  const n = BigInt(Math.max(1, Number(prizePlaces) || 1));
  return FEE_SOL_BASE_LAMPORTS + n * FEE_SOL_PER_PLACE_LAMPORTS;
}

export function lamportsToSolString(lamports) {
  const n = BigInt(lamports);
  const whole = n / 1_000_000_000n;
  const frac = n % 1_000_000_000n;
  if (frac === 0n) return whole.toString();
  return `${whole}.${frac.toString().padStart(9, "0").replace(/0+$/, "")}`;
}

function assertValidMint(mint, label) {
  if (!mint || !BASE58_RE.test(String(mint).trim())) {
    throw invalid(`${label} must be a valid Solana mint address`);
  }
}

function invalid(message) {
  const err = new Error(message);
  err.status = 400;
  return err;
}

function normalizeManualPlace(raw, expectedPlace) {
  const place = Number(raw?.place ?? expectedPlace);
  if (place !== expectedPlace) {
    throw invalid(`Prize place ${expectedPlace} has mismatched place field (${place})`);
  }
  const description = String(raw?.description ?? "").trim();
  if (!description) {
    throw invalid(`Prize place ${place} requires a description`);
  }
  return { place, description };
}

function normalizeWalletItem(raw, ctx) {
  const kind = String(raw?.kind ?? "").toUpperCase();
  if (kind === "SOL") {
    let lamports;
    try {
      lamports = BigInt(String(raw?.lamports ?? raw?.amount ?? "0"));
    } catch {
      throw invalid(`${ctx}: invalid SOL lamports`);
    }
    if (lamports <= 0n) throw invalid(`${ctx}: SOL amount must be positive`);
    return { kind: "SOL", lamports: lamports.toString() };
  }
  if (kind === "SPL") {
    const mint = String(raw?.mint ?? "").trim();
    assertValidMint(mint, `${ctx} SPL mint`);
    let amount;
    try {
      amount = BigInt(String(raw?.amount ?? "0"));
    } catch {
      throw invalid(`${ctx}: invalid SPL amount`);
    }
    if (amount <= 0n) throw invalid(`${ctx}: SPL amount must be positive`);
    const decimals = Number(raw?.decimals ?? 0);
    if (!Number.isInteger(decimals) || decimals < 0 || decimals > 18) {
      throw invalid(`${ctx}: SPL decimals must be 0–18`);
    }
    return { kind: "SPL", mint, amount: amount.toString(), decimals };
  }
  if (kind === "NFT") {
    const mint = String(raw?.mint ?? "").trim();
    assertValidMint(mint, `${ctx} NFT mint`);
    return { kind: "NFT", mint };
  }
  throw invalid(`${ctx}: asset kind must be SOL, SPL, or NFT`);
}

function normalizeWalletPlace(raw, expectedPlace) {
  const place = Number(raw?.place ?? expectedPlace);
  if (place !== expectedPlace) {
    throw invalid(`Prize place ${expectedPlace} has mismatched place field (${place})`);
  }
  const items = raw?.items;
  if (!Array.isArray(items) || items.length === 0) {
    throw invalid(`Prize place ${place} requires at least one asset`);
  }
  return {
    place,
    items: items.map((item, i) =>
      normalizeWalletItem(item, `Place ${place} item ${i + 1}`)
    ),
  };
}

/**
 * @param {{ prizePlaces: number, prizeMode: 'MANUAL' | 'WALLET', prizeStructure: unknown, maxPlayers: number, refundWalletAddress?: string, prizeClaimServerId?: string }}
 */
export function validateAndNormalizePrizeConfig({
  prizePlaces,
  prizeMode,
  prizeStructure,
  maxPlayers,
  refundWalletAddress,
  prizeClaimServerId,
}) {
  const places = Number(prizePlaces);
  if (!Number.isInteger(places) || places < 1) {
    throw invalid("prizePlaces must be a positive integer");
  }
  if (places > Number(maxPlayers)) {
    throw invalid("prizePlaces cannot exceed maxPlayers");
  }

  const mode = String(prizeMode ?? "").toUpperCase();
  if (mode !== "MANUAL" && mode !== "WALLET") {
    throw invalid("prizeMode must be MANUAL or WALLET");
  }

  let structure = prizeStructure;
  if (typeof structure === "string") {
    try {
      structure = JSON.parse(structure);
    } catch {
      throw invalid("prizeStructure must be valid JSON");
    }
  }
  if (!Array.isArray(structure) || structure.length !== places) {
    throw invalid(`prizeStructure must have exactly ${places} place(s)`);
  }

  if (mode === "MANUAL") {
    if (!prizeClaimServerId) {
      throw invalid("Manual prize mode requires prizeClaimServerId (Discord server)");
    }
    const normalized = structure.map((row, i) =>
      normalizeManualPlace(row, i + 1)
    );
    return {
      prizePlaces: places,
      prizeMode: "MANUAL",
      prizeStructureJson: JSON.stringify(normalized),
      prizeFundingStatus: null,
      prizeFeeSolLamports: null,
      refundWalletAddress: null,
      prizeClaimServerId,
    };
  }

  const refund = String(refundWalletAddress ?? "").trim();
  if (!BASE58_RE.test(refund)) {
    throw invalid("Wallet prize mode requires a valid refundWalletAddress");
  }

  const normalized = structure.map((row, i) => normalizeWalletPlace(row, i + 1));
  const feeLamports = estimatePrizeFeeSolLamports(places);

  return {
    prizePlaces: places,
    prizeMode: "WALLET",
    prizeStructureJson: JSON.stringify(normalized),
    prizeFundingStatus: "PENDING",
    prizeFeeSolLamports: feeLamports,
    refundWalletAddress: refund,
    prizeClaimServerId: null,
  };
}

export function parsePrizeStructureJson(json) {
  try {
    const parsed = JSON.parse(json || "[]");
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function shortAddr(addr, head = 4, tail = 4) {
  const s = String(addr || "");
  if (s.length <= head + tail + 1) return s;
  return `${s.slice(0, head)}…${s.slice(-tail)}`;
}

function formatSplAmount(amountStr, decimals) {
  try {
    const raw = BigInt(String(amountStr ?? "0"));
    const d = Number(decimals) || 0;
    if (d <= 0) return raw.toString();
    const base = 10n ** BigInt(d);
    const whole = raw / base;
    const frac = raw % base;
    if (frac === 0n) return whole.toString();
    return `${whole}.${frac.toString().padStart(d, "0").replace(/0+$/, "")}`;
  } catch {
    return String(amountStr ?? "0");
  }
}

function formatWalletItem(item) {
  const kind = String(item?.kind ?? "").toUpperCase();
  if (kind === "SOL") {
    return `${lamportsToSolString(item.lamports ?? "0")} SOL`;
  }
  if (kind === "SPL") {
    return `${formatSplAmount(item.amount, item.decimals)} tokens (${shortAddr(item.mint)})`;
  }
  if (kind === "NFT") {
    return `NFT (${shortAddr(item.mint)})`;
  }
  return "Prize";
}

/**
 * Human-readable prize lines for Discord embeds / admin copy.
 * Always uses predetermined structure — never field size / registrations.
 * @returns {{ places: number, lines: string[] }}
 */
export function formatPrizeStructureForDisplay({
  prizePlaces,
  prizeMode,
  prizeStructureJson,
}) {
  const places = Number(prizePlaces) || 0;
  const structure = parsePrizeStructureJson(prizeStructureJson);
  const mode = String(prizeMode || "").toUpperCase();
  const lines = [];

  for (let i = 1; i <= places; i++) {
    const row = structure.find((p) => Number(p?.place) === i) || structure[i - 1];
    let detail = "";
    if (mode === "MANUAL") {
      detail = String(row?.description || "").trim() || "TBD";
    } else if (mode === "WALLET") {
      const items = Array.isArray(row?.items) ? row.items : [];
      detail = items.length
        ? items.map(formatWalletItem).join(" + ")
        : "TBD";
    } else if (row?.description) {
      detail = String(row.description).trim();
    } else {
      detail = "TBD";
    }
    lines.push(`**${i}${placeSuffix(i)}:** ${detail}`);
  }

  return { places, lines };
}

function placeSuffix(n) {
  const v = n % 100;
  if (v >= 11 && v <= 13) return "th";
  switch (n % 10) {
    case 1:
      return "st";
    case 2:
      return "nd";
    case 3:
      return "rd";
    default:
      return "th";
  }
}

export function getWalletPlaceItems(prizeStructureJson, finishingPlace) {
  const structure = parsePrizeStructureJson(prizeStructureJson);
  const row = structure.find((p) => Number(p.place) === Number(finishingPlace));
  return row?.items || [];
}
