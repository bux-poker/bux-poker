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

function Placeholder({ label }: { label: string }) {
  return (
    <div className="flex h-14 w-14 items-center justify-center rounded-xl border border-emerald-500/30 bg-slate-900/80 text-[10px] font-bold uppercase tracking-wide text-emerald-300/80">
      {label}
    </div>
  );
}

export function PrizeAssetVisual({ item }: { item: PrizeAsset }) {
  const kind = String(item.kind || "").toUpperCase();
  const [meta, setMeta] = useState<Meta | null>(
    kind === "SOL"
      ? { name: "Solana", symbol: "SOL", image: "/images/solana-sol.svg", number: null }
      : null
  );
  const [imgFailed, setImgFailed] = useState(false);

  useEffect(() => {
    if (kind === "SOL") return;
    if (!item.mint) return;
    let cancelled = false;
    setImgFailed(false);
    (async () => {
      try {
        const res = await api.get("/api/prizes/asset-meta", {
          params: { kind, mint: item.mint },
        });
        if (cancelled) return;
        setMeta({
          name: res.data?.name ?? null,
          symbol: res.data?.symbol ?? null,
          image: res.data?.image ?? null,
          number: res.data?.number ?? null,
          decimals: typeof res.data?.decimals === "number" ? res.data.decimals : null,
        });
      } catch {
        if (!cancelled) {
          setMeta({ name: kind === "NFT" ? "NFT" : "Token", symbol: null, image: null, number: null });
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [kind, item.mint]);

  const decimals = item.decimals ?? meta?.decimals ?? 0;
  const title =
    kind === "SOL"
      ? formatSol(item.lamports)
      : kind === "NFT"
        ? meta?.name || "NFT"
        : `${formatSplAmount(item.amount, decimals)} ${meta?.symbol || "TOKEN"}`;

  const nftBaseName = meta?.name ? meta.name.replace(/\s*#\s*\d+\s*$/, "").trim() : null;

  return (
    <div className="flex flex-col items-center gap-2">
      {meta?.image && !imgFailed ? (
        <img
          src={meta.image}
          alt={title}
          className="h-14 w-14 rounded-xl border border-emerald-500/30 object-cover bg-slate-950"
          onError={() => setImgFailed(true)}
        />
      ) : (
        <Placeholder label={kind === "SOL" ? "SOL" : kind === "NFT" ? "NFT" : "TKN"} />
      )}
      <div className="text-center">
        {kind === "NFT" ? (
          <>
            <p className="font-semibold text-emerald-100">
              {nftBaseName || "NFT"}
              {meta?.number ? (
                <span className="text-emerald-300"> #{meta.number}</span>
              ) : null}
            </p>
          </>
        ) : (
          <p className="font-semibold text-emerald-100">{title}</p>
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
