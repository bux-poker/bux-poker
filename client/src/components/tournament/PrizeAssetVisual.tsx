import { useEffect, useState } from "react";
import api from "../../services/api";

type PrizeAsset = {
  kind: string;
  lamports?: string;
  mint?: string;
  amount?: string;
  decimals?: number;
};

type Meta = {
  name: string | null;
  symbol: string | null;
  image: string | null;
  number: string | null;
  decimals?: number | null;
  priceUsd?: number | null;
  floorUsd?: number | null;
};

function formatSol(lamports: string | undefined) {
  try {
    return `${Number(BigInt(lamports || "0")) / 1e9} SOL`;
  } catch {
    return "SOL";
  }
}

function formatSplAmount(amount: string | undefined, decimals: number | undefined | null) {
  try {
    const raw = BigInt(amount || "0");
    const d = typeof decimals === "number" ? decimals : 0;
    if (d <= 0) return raw.toString();
    const base = 10n ** BigInt(d);
    const whole = raw / base;
    const frac = raw % base;
    if (frac === 0n) return whole.toString();
    const fracStr = frac.toString().padStart(d, "0").replace(/0+$/, "");
    return `${whole}.${fracStr}`;
  } catch {
    return amount || "?";
  }
}

function formatUsd(n: number | null | undefined) {
  if (n == null || !Number.isFinite(n)) return null;
  if (n >= 1000) {
    return `$${n.toLocaleString(undefined, { maximumFractionDigits: 0 })}`;
  }
  if (n >= 1) {
    return `$${n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  }
  return `$${n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 6 })}`;
}

function estimateUsdValue(item: PrizeAsset, meta: Meta | null): number | null {
  const kind = String(item.kind || "").toUpperCase();
  if (kind === "SOL") {
    const price = meta?.priceUsd;
    if (price == null) return null;
    try {
      const sol = Number(BigInt(item.lamports || "0")) / 1e9;
      return sol * price;
    } catch {
      return null;
    }
  }
  if (kind === "NFT") {
    return meta?.floorUsd ?? meta?.priceUsd ?? null;
  }
  if (kind === "SPL") {
    const price = meta?.priceUsd;
    if (price == null) return null;
    const decimals =
      typeof item.decimals === "number" ? item.decimals : meta?.decimals ?? 0;
    try {
      const human = Number(formatSplAmount(item.amount, decimals));
      if (!Number.isFinite(human)) return null;
      return human * price;
    } catch {
      return null;
    }
  }
  return null;
}

function Placeholder({ label }: { label: string }) {
  return (
    <div className="flex h-14 w-14 shrink-0 items-center justify-center rounded-xl border border-emerald-500/30 bg-slate-900/80 text-[10px] font-bold uppercase tracking-wide text-emerald-300/80">
      {label}
    </div>
  );
}

export function PrizeAssetVisual({
  item,
  layout = "stack",
}: {
  item: PrizeAsset;
  layout?: "stack" | "row";
}) {
  const kind = String(item.kind || "").toUpperCase();
  const [meta, setMeta] = useState<Meta | null>(
    kind === "SOL"
      ? {
          name: "Solana",
          symbol: "SOL",
          image: "/images/solana-sol.svg",
          number: null,
          decimals: 9,
        }
      : null
  );
  const [imgFailed, setImgFailed] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setImgFailed(false);
    (async () => {
      try {
        const res = await api.get("/api/prizes/asset-meta", {
          params: kind === "SOL" ? { kind: "SOL" } : { kind, mint: item.mint },
        });
        if (cancelled) return;
        setMeta({
          name: res.data?.name ?? null,
          symbol: res.data?.symbol ?? null,
          image: res.data?.image ?? (kind === "SOL" ? "/images/solana-sol.svg" : null),
          number: res.data?.number ?? null,
          decimals: typeof res.data?.decimals === "number" ? res.data.decimals : null,
          priceUsd:
            typeof res.data?.priceUsd === "number" ? res.data.priceUsd : null,
          floorUsd:
            typeof res.data?.floorUsd === "number" ? res.data.floorUsd : null,
        });
      } catch {
        if (!cancelled) {
          setMeta({
            name: kind === "NFT" ? "NFT" : kind === "SOL" ? "Solana" : "Token",
            symbol: kind === "SOL" ? "SOL" : null,
            image: kind === "SOL" ? "/images/solana-sol.svg" : null,
            number: null,
          });
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [kind, item.mint]);

  // Use stored decimals when present (incl. 0). Meta decimals fill gaps for older rows.
  const decimals =
    typeof item.decimals === "number" ? item.decimals : meta?.decimals ?? 0;
  const humanAmount =
    kind === "SOL"
      ? formatSol(item.lamports)
      : kind === "NFT"
        ? null
        : formatSplAmount(item.amount, decimals);
  const displayName =
    kind === "SOL"
      ? "SOL"
      : kind === "NFT"
        ? meta?.name || "NFT"
        : meta?.name || meta?.symbol || "Token";
  const nftBaseName = meta?.name ? meta.name.replace(/\s*#\s*\d+\s*$/, "").trim() : null;
  const usdLabel = formatUsd(estimateUsdValue(item, meta));

  const media =
    meta?.image && !imgFailed ? (
      <img
        src={meta.image}
        alt={displayName}
        className="h-14 w-14 shrink-0 rounded-xl border border-emerald-500/30 object-cover bg-slate-950"
        onError={() => setImgFailed(true)}
      />
    ) : (
      <Placeholder label={kind === "SOL" ? "SOL" : kind === "NFT" ? "NFT" : "TKN"} />
    );

  const text = (
    <div className={layout === "row" ? "min-w-0 text-left" : "text-center"}>
      {kind === "NFT" ? (
        <p className="font-semibold text-emerald-100">
          {nftBaseName || "NFT"}
          {meta?.number ? <span className="text-emerald-300"> #{meta.number}</span> : null}
        </p>
      ) : (
        <p className="font-semibold text-emerald-100">
          {kind === "SPL" ? (
            <>
              <span className="tabular-nums">{humanAmount}</span>{" "}
              <span>{meta?.symbol || displayName}</span>
            </>
          ) : (
            humanAmount
          )}
        </p>
      )}
      {kind === "SPL" && meta?.name && meta?.symbol && meta.name !== meta.symbol && (
        <p className="truncate text-xs text-slate-400">{meta.name}</p>
      )}
      {usdLabel && (
        <p className="mt-0.5 text-sm font-medium text-amber-300/90">≈ {usdLabel}</p>
      )}
      {item.mint && (
        <a
          href={`https://solscan.io/token/${item.mint}`}
          target="_blank"
          rel="noopener noreferrer"
          className="mt-0.5 block font-mono text-[10px] text-emerald-400/80 hover:underline"
        >
          {item.mint.slice(0, 4)}…{item.mint.slice(-4)}
        </a>
      )}
    </div>
  );

  if (layout === "row") {
    return (
      <div className="flex items-center gap-3">
        {media}
        {text}
      </div>
    );
  }

  return (
    <div className="flex flex-col items-center gap-2">
      {media}
      {text}
    </div>
  );
}

/** Manual description prizes — show SOL icon when the text looks like a SOL amount. */
export function ManualPrizeVisual({ description }: { description: string }) {
  const looksLikeSol = /\bSOL\b/i.test(description);
  const looksLikeNft = /\bNFT\b/i.test(description);
  return (
    <div className="flex flex-col items-center gap-2">
      {looksLikeSol ? (
        <img
          src="/images/solana-sol.svg"
          alt="SOL"
          className="h-14 w-14 rounded-xl border border-emerald-500/30 object-cover bg-slate-950"
        />
      ) : (
        <Placeholder label={looksLikeNft ? "NFT" : "PRIZE"} />
      )}
      <p className="text-center font-semibold text-emerald-100">{description}</p>
    </div>
  );
}
