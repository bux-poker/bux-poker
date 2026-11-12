import { useEffect, useMemo, useRef, useState } from 'react';
import api from '../../services/api';

export type PrizeMode = 'MANUAL' | 'WALLET';

export type PrizeAssetKind = 'SOL' | 'SPL' | 'NFT';

export interface ManualPrizePlace {
  place: number;
  description: string;
}

export interface WalletPrizeItem {
  kind: PrizeAssetKind;
  /** SOL: human SOL amount string. SPL: human token amount. */
  lamports?: string;
  mint?: string;
  amount?: string;
  decimals?: number;
}

export interface WalletPrizePlace {
  place: number;
  items: WalletPrizeItem[];
}

interface DiscordServerOption {
  id: string;
  serverId: string;
  serverName: string;
  setupCompleted?: boolean;
}

export interface PrizeFormState {
  prizePlaces: number;
  prizeMode: PrizeMode;
  manualPlaces: ManualPrizePlace[];
  walletPlaces: WalletPrizePlace[];
  refundWalletAddress: string;
  prizeClaimServerId: string;
}

interface Props {
  servers: DiscordServerOption[];
  maxPlayers: number;
  value: PrizeFormState;
  onChange: (next: PrizeFormState) => void;
}

type AssetMeta = {
  name: string | null;
  symbol: string | null;
  image: string | null;
  number: string | null;
  decimals: number | null;
  priceUsd: number | null;
  floorUsd: number | null;
};

const MINT_RE = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;

function emptyWalletItem(): WalletPrizeItem {
  return { kind: 'SOL', lamports: '' };
}

function buildManualPlaces(count: number, prev: ManualPrizePlace[]): ManualPrizePlace[] {
  return Array.from({ length: count }, (_, i) => {
    const place = i + 1;
    const existing = prev.find((p) => p.place === place);
    return existing ?? { place, description: '' };
  });
}

function buildWalletPlaces(count: number, prev: WalletPrizePlace[]): WalletPrizePlace[] {
  return Array.from({ length: count }, (_, i) => {
    const place = i + 1;
    const existing = prev.find((p) => p.place === place);
    return existing ?? { place, items: [emptyWalletItem()] };
  });
}

export function defaultPrizeFormState(): PrizeFormState {
  return {
    prizePlaces: 3,
    prizeMode: 'MANUAL',
    manualPlaces: buildManualPlaces(3, []),
    walletPlaces: buildWalletPlaces(3, []),
    refundWalletAddress: '',
    prizeClaimServerId: '',
  };
}

/** Convert a human decimal string to raw integer units for the given decimals. */
export function humanToRawAmount(human: string, decimals: number): string {
  const cleaned = String(human || '').trim().replace(/,/g, '');
  if (!cleaned || !/^\d+(\.\d+)?$/.test(cleaned)) {
    throw new Error('Invalid amount');
  }
  const [wholePart, fracPart = ''] = cleaned.split('.');
  if (fracPart.length > decimals) {
    throw new Error(`Amount has more than ${decimals} decimal places`);
  }
  const frac = fracPart.padEnd(decimals, '0');
  const whole = wholePart.replace(/^0+(?=\d)/, '') || '0';
  const raw = BigInt(whole) * 10n ** BigInt(decimals) + BigInt(frac || '0');
  return raw.toString();
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

export function prizeFormToPayload(state: PrizeFormState) {
  const prizeStructure =
    state.prizeMode === 'MANUAL'
      ? state.manualPlaces
      : state.walletPlaces.map((p) => ({
          place: p.place,
          items: p.items.map((item) => {
            if (item.kind === 'SOL') {
              const sol = parseFloat(item.lamports || '0');
              const lamports = Number.isFinite(sol)
                ? Math.round(sol * 1_000_000_000).toString()
                : '0';
              return { kind: 'SOL', lamports };
            }
            if (item.kind === 'NFT') {
              return { kind: 'NFT', mint: (item.mint || '').trim() };
            }
            const decimals =
              typeof item.decimals === 'number' && Number.isInteger(item.decimals)
                ? item.decimals
                : null;
            if (decimals == null) {
              throw new Error(
                `Place ${p.place}: token decimals unknown — wait for mint lookup or paste a valid mint`
              );
            }
            return {
              kind: 'SPL',
              mint: (item.mint || '').trim(),
              amount: humanToRawAmount(item.amount || '0', decimals),
              decimals,
            };
          }),
        }));

  return {
    prizePlaces: state.prizePlaces,
    prizeMode: state.prizeMode,
    prizeStructure,
    refundWalletAddress:
      state.prizeMode === 'WALLET' ? state.refundWalletAddress.trim() : undefined,
    prizeClaimServerId:
      state.prizeMode === 'MANUAL' ? state.prizeClaimServerId : undefined,
  };
}

function WalletAssetPreview({
  item,
  onDecimalsResolved,
}: {
  item: WalletPrizeItem;
  onDecimalsResolved?: (decimals: number) => void;
}) {
  const [meta, setMeta] = useState<AssetMeta | null>(null);
  const [loading, setLoading] = useState(false);
  const [imgFailed, setImgFailed] = useState(false);
  const mint = (item.mint || '').trim();
  const kind = item.kind;

  useEffect(() => {
    if (kind === 'SOL') {
      let cancelled = false;
      setLoading(true);
      (async () => {
        try {
          const res = await api.get('/api/prizes/asset-meta', { params: { kind: 'SOL' } });
          if (cancelled) return;
          setMeta({
            name: res.data?.name ?? 'Solana',
            symbol: res.data?.symbol ?? 'SOL',
            image: res.data?.image ?? '/images/solana-sol.svg',
            number: null,
            decimals: 9,
            priceUsd: typeof res.data?.priceUsd === 'number' ? res.data.priceUsd : null,
            floorUsd: null,
          });
        } catch {
          if (!cancelled) {
            setMeta({
              name: 'Solana',
              symbol: 'SOL',
              image: '/images/solana-sol.svg',
              number: null,
              decimals: 9,
              priceUsd: null,
              floorUsd: null,
            });
          }
        } finally {
          if (!cancelled) setLoading(false);
        }
      })();
      return () => {
        cancelled = true;
      };
    }

    if ((kind !== 'SPL' && kind !== 'NFT') || !MINT_RE.test(mint)) {
      setMeta(null);
      setLoading(false);
      return;
    }

    let cancelled = false;
    setLoading(true);
    setImgFailed(false);
    const t = window.setTimeout(async () => {
      try {
        const res = await api.get('/api/prizes/asset-meta', {
          params: { kind, mint },
        });
        if (cancelled) return;
        const next: AssetMeta = {
          name: res.data?.name ?? null,
          symbol: res.data?.symbol ?? null,
          image: res.data?.image ?? null,
          number: res.data?.number ?? null,
          decimals: typeof res.data?.decimals === 'number' ? res.data.decimals : null,
          priceUsd: typeof res.data?.priceUsd === 'number' ? res.data.priceUsd : null,
          floorUsd: typeof res.data?.floorUsd === 'number' ? res.data.floorUsd : null,
        };
        setMeta(next);
        if (kind === 'SPL' && typeof next.decimals === 'number' && onDecimalsResolved) {
          onDecimalsResolved(next.decimals);
        }
      } catch {
        if (!cancelled) setMeta(null);
      } finally {
        if (!cancelled) setLoading(false);
      }
    }, 350);

    return () => {
      cancelled = true;
      window.clearTimeout(t);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [kind, mint]);

  const usdEstimate = useMemo(() => {
    if (!meta) return null;
    if (kind === 'SOL') {
      const sol = parseFloat(item.lamports || '0');
      if (!Number.isFinite(sol) || sol <= 0 || meta.priceUsd == null) return null;
      return sol * meta.priceUsd;
    }
    if (kind === 'NFT') {
      return meta.floorUsd ?? meta.priceUsd ?? null;
    }
    const human = parseFloat(String(item.amount || '').replace(/,/g, ''));
    if (!Number.isFinite(human) || human <= 0 || meta.priceUsd == null) return null;
    return human * meta.priceUsd;
  }, [meta, kind, item.lamports, item.amount]);

  if (kind !== 'SOL' && !MINT_RE.test(mint)) {
    return (
      <p className="mt-1 text-xs text-slate-500">
        Paste a mint address to load image, name, and current $ value.
      </p>
    );
  }

  if (loading && !meta) {
    return <p className="mt-1 text-xs text-slate-500">Looking up asset…</p>;
  }

  if (!meta) {
    return (
      <p className="mt-1 text-xs text-amber-400/90">
        Could not resolve asset metadata — check the mint address.
      </p>
    );
  }

  const label =
    kind === 'SOL'
      ? `${item.lamports || '0'} SOL`
      : kind === 'NFT'
        ? meta.name || 'NFT'
        : `${item.amount || '0'} ${meta.symbol || meta.name || 'TOKEN'}`;

  return (
    <div className="mt-2 flex items-center gap-3 rounded-lg border border-emerald-500/25 bg-slate-950/50 px-3 py-2">
      {meta.image && !imgFailed ? (
        <img
          src={meta.image}
          alt={meta.name || 'asset'}
          className="h-10 w-10 shrink-0 rounded-lg border border-emerald-500/30 object-cover bg-slate-900"
          onError={() => setImgFailed(true)}
        />
      ) : (
        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg border border-emerald-500/30 bg-slate-900 text-[9px] font-bold uppercase text-emerald-300/80">
          {kind === 'SOL' ? 'SOL' : kind === 'NFT' ? 'NFT' : 'TKN'}
        </div>
      )}
      <div className="min-w-0">
        <p className="truncate text-sm font-medium text-emerald-100">{label}</p>
        {kind === 'SPL' && meta.name && (
          <p className="truncate text-xs text-slate-400">
            {meta.name}
            {typeof meta.decimals === 'number' ? ` · ${meta.decimals} decimals` : ''}
          </p>
        )}
        {kind === 'NFT' && meta.number && (
          <p className="text-xs text-slate-400">#{meta.number}</p>
        )}
        {formatUsd(usdEstimate) ? (
          <p className="text-xs font-medium text-amber-300/90">
            ≈ {formatUsd(usdEstimate)}
            {kind === 'NFT' ? ' floor' : ' current'}
          </p>
        ) : (
          <p className="text-xs text-slate-500">$ price unavailable</p>
        )}
      </div>
    </div>
  );
}

export function PrizeStructureEditor({ servers, maxPlayers, value, onChange }: Props) {
  const setupServers = useMemo(
    () => servers.filter((s) => s.setupCompleted !== false),
    [servers]
  );
  const valueRef = useRef(value);
  valueRef.current = value;

  const syncPlaces = (count: number) => {
    const clamped = Math.max(1, Math.min(maxPlayers, count));
    const current = valueRef.current;
    onChange({
      ...current,
      prizePlaces: clamped,
      manualPlaces: buildManualPlaces(clamped, current.manualPlaces),
      walletPlaces: buildWalletPlaces(clamped, current.walletPlaces),
    });
  };

  useEffect(() => {
    if (value.prizePlaces > maxPlayers) syncPlaces(maxPlayers);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [maxPlayers]);

  const updateItem = (pIdx: number, iIdx: number, next: WalletPrizeItem) => {
    const current = valueRef.current;
    const walletPlaces = [...current.walletPlaces];
    const place = walletPlaces[pIdx];
    const items = [...place.items];
    items[iIdx] = next;
    walletPlaces[pIdx] = { ...place, items };
    onChange({ ...current, walletPlaces });
  };

  const patchItem = (pIdx: number, iIdx: number, patch: Partial<WalletPrizeItem>) => {
    const current = valueRef.current;
    const existing = current.walletPlaces[pIdx]?.items[iIdx];
    if (!existing) return;
    updateItem(pIdx, iIdx, { ...existing, ...patch });
  };

  return (
    <div className="bux-surface p-6">
      <h2 className="mb-1 text-lg font-semibold">Prizes</h2>
      <p className="mb-4 text-sm text-slate-400">
        Paid places and prizes are locked in at create time. Wallet mode requires full funding before
        start. Enter token amounts as human quantities (e.g. 75000) — decimals are fetched from the
        mint automatically.
      </p>

      <div className="mb-4 grid gap-4 md:grid-cols-2">
        <div>
          <label className="block text-sm font-medium text-slate-300">Paid places *</label>
          <input
            type="number"
            min={1}
            max={maxPlayers}
            value={value.prizePlaces}
            onChange={(e) => syncPlaces(parseInt(e.target.value, 10) || 1)}
            className="mt-1 w-full max-w-xs bux-field px-3 py-2 text-slate-100 focus:border-emerald-500 focus:outline-none"
          />
        </div>
        <div>
          <label className="block text-sm font-medium text-slate-300">Fulfillment *</label>
          <select
            value={value.prizeMode}
            onChange={(e) =>
              onChange({ ...value, prizeMode: e.target.value as PrizeMode })
            }
            className="mt-1 w-full max-w-md bux-field px-3 py-2 text-slate-100 focus:border-emerald-500 focus:outline-none"
          >
            <option value="MANUAL">Manual — Discord ticket claim</option>
            <option value="WALLET">Wallet — on-site Solana claim</option>
          </select>
        </div>
      </div>

      {value.prizeMode === 'MANUAL' && (
        <div className="mb-4">
          <label className="block text-sm font-medium text-slate-300">
            Claim server (winners open a ticket here) *
          </label>
          <select
            required
            value={value.prizeClaimServerId}
            onChange={(e) =>
              onChange({ ...value, prizeClaimServerId: e.target.value })
            }
            className="mt-1 w-full max-w-md bux-field px-3 py-2 text-slate-100 focus:border-emerald-500 focus:outline-none"
          >
            <option value="">Select a server…</option>
            {setupServers.map((s) => (
              <option key={s.id} value={s.id}>
                {s.serverName}
              </option>
            ))}
          </select>
        </div>
      )}

      {value.prizeMode === 'WALLET' && (
        <div className="mb-4">
          <label className="block text-sm font-medium text-slate-300">
            Refund wallet address (unclaimed prizes after 7 days) *
          </label>
          <input
            type="text"
            value={value.refundWalletAddress}
            onChange={(e) =>
              onChange({ ...value, refundWalletAddress: e.target.value })
            }
            placeholder="Your Solana address"
            className="mt-1 w-full bux-field px-3 py-2 font-mono text-sm text-slate-100 focus:border-emerald-500 focus:outline-none"
          />
          <p className="mt-1 text-xs text-slate-500">
            After create you will sign a deposit that moves these prizes plus a small SOL fee
            buffer into the shared prize vault. Unclaimed prizes return here after 7 days.
          </p>
        </div>
      )}

      <div className="space-y-4">
        {value.prizeMode === 'MANUAL'
          ? value.manualPlaces.map((place, idx) => (
              <div key={place.place} className="bux-field/40 p-3">
                <label className="block text-sm font-medium text-slate-300">
                  {place.place === 1
                    ? '1st place'
                    : place.place === 2
                      ? '2nd place'
                      : place.place === 3
                        ? '3rd place'
                        : `${place.place}th place`}
                </label>
                <input
                  type="text"
                  required
                  value={place.description}
                  onChange={(e) => {
                    const manualPlaces = [...value.manualPlaces];
                    manualPlaces[idx] = { ...place, description: e.target.value };
                    onChange({ ...value, manualPlaces });
                  }}
                  placeholder="e.g. 500 USDC, Discord role, NFT xyz…"
                  className="mt-1 w-full bux-field px-3 py-2 text-slate-100 focus:border-emerald-500 focus:outline-none"
                />
              </div>
            ))
          : value.walletPlaces.map((place, pIdx) => (
              <div key={place.place} className="bux-field/40 p-3">
                <div className="mb-2 flex items-center justify-between">
                  <span className="text-sm font-medium text-slate-300">
                    Place {place.place}
                  </span>
                  <button
                    type="button"
                    onClick={() => {
                      const walletPlaces = [...value.walletPlaces];
                      walletPlaces[pIdx] = {
                        ...place,
                        items: [...place.items, emptyWalletItem()],
                      };
                      onChange({ ...value, walletPlaces });
                    }}
                    className="text-xs text-emerald-400 hover:text-emerald-300"
                  >
                    + Add asset
                  </button>
                </div>
                <div className="space-y-3">
                  {place.items.map((item, iIdx) => (
                    <div key={iIdx} className="rounded-lg border border-slate-700/60 p-2">
                      <div className="flex flex-wrap items-end gap-2">
                        <select
                          value={item.kind}
                          onChange={(e) => {
                            const kind = e.target.value as PrizeAssetKind;
                            updateItem(
                              pIdx,
                              iIdx,
                              kind === 'SOL'
                                ? { kind, lamports: '' }
                                : kind === 'NFT'
                                  ? { kind, mint: '' }
                                  : { kind, mint: '', amount: '', decimals: undefined }
                            );
                          }}
                          className="bux-field px-2 py-1.5 text-sm text-slate-100"
                        >
                          <option value="SOL">SOL</option>
                          <option value="SPL">Token (SPL)</option>
                          <option value="NFT">NFT (mint)</option>
                        </select>
                        {item.kind === 'SOL' && (
                          <input
                            type="number"
                            min={0}
                            step="any"
                            placeholder="SOL amount"
                            value={item.lamports ?? ''}
                            onChange={(e) =>
                              updateItem(pIdx, iIdx, { ...item, lamports: e.target.value })
                            }
                            className="min-w-[120px] flex-1 bux-field px-2 py-1.5 text-sm text-slate-100"
                          />
                        )}
                        {item.kind === 'SPL' && (
                          <>
                            <input
                              type="text"
                              placeholder="Mint address"
                              value={item.mint ?? ''}
                              onChange={(e) =>
                                updateItem(pIdx, iIdx, {
                                  ...item,
                                  mint: e.target.value,
                                  decimals: undefined,
                                })
                              }
                              className="min-w-[180px] flex-1 bux-field px-2 py-1.5 font-mono text-xs text-slate-100"
                            />
                            <input
                              type="text"
                              inputMode="decimal"
                              placeholder="Token amount"
                              value={item.amount ?? ''}
                              onChange={(e) =>
                                updateItem(pIdx, iIdx, { ...item, amount: e.target.value })
                              }
                              className="w-32 bux-field px-2 py-1.5 text-sm text-slate-100"
                            />
                          </>
                        )}
                        {item.kind === 'NFT' && (
                          <input
                            type="text"
                            placeholder="NFT mint address"
                            value={item.mint ?? ''}
                            onChange={(e) =>
                              updateItem(pIdx, iIdx, { ...item, mint: e.target.value })
                            }
                            className="min-w-[200px] flex-1 bux-field px-2 py-1.5 font-mono text-xs text-slate-100"
                          />
                        )}
                        {place.items.length > 1 && (
                          <button
                            type="button"
                            onClick={() => {
                              const walletPlaces = [...value.walletPlaces];
                              walletPlaces[pIdx] = {
                                ...place,
                                items: place.items.filter((_, j) => j !== iIdx),
                              };
                              onChange({ ...value, walletPlaces });
                            }}
                            className="text-xs text-red-400 hover:text-red-300"
                          >
                            Remove
                          </button>
                        )}
                      </div>
                      <WalletAssetPreview
                        item={item}
                        onDecimalsResolved={(decimals) => {
                          const existing = valueRef.current.walletPlaces[pIdx]?.items[iIdx];
                          if (existing && existing.decimals !== decimals) {
                            patchItem(pIdx, iIdx, { decimals });
                          }
                        }}
                      />
                    </div>
                  ))}
                </div>
              </div>
            ))}
      </div>
    </div>
  );
}
