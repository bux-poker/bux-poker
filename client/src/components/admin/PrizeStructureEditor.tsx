import { useEffect, useMemo, useState } from 'react';

export type PrizeMode = 'MANUAL' | 'WALLET';

export type PrizeAssetKind = 'SOL' | 'SPL' | 'NFT';

export interface ManualPrizePlace {
  place: number;
  description: string;
}

export interface WalletPrizeItem {
  kind: PrizeAssetKind;
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
            return {
              kind: 'SPL',
              mint: (item.mint || '').trim(),
              amount: (item.amount || '').trim(),
              decimals: item.decimals ?? 0,
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

export function PrizeStructureEditor({ servers, maxPlayers, value, onChange }: Props) {
  const setupServers = useMemo(
    () => servers.filter((s) => s.setupCompleted !== false),
    [servers]
  );

  const syncPlaces = (count: number) => {
    const clamped = Math.max(1, Math.min(maxPlayers, count));
    onChange({
      ...value,
      prizePlaces: clamped,
      manualPlaces: buildManualPlaces(clamped, value.manualPlaces),
      walletPlaces: buildWalletPlaces(clamped, value.walletPlaces),
    });
  };

  useEffect(() => {
    if (value.prizePlaces > maxPlayers) syncPlaces(maxPlayers);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [maxPlayers]);

  return (
    <div className="rounded-lg border border-slate-800 bg-slate-900/50 p-6">
      <h2 className="mb-1 text-lg font-semibold">Prizes</h2>
      <p className="mb-4 text-sm text-slate-400">
        Paid places and prizes are locked in at create time. Wallet mode requires full funding before
        start.
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
            className="mt-1 w-full max-w-xs rounded border border-slate-700 bg-slate-800 px-3 py-2 text-slate-100 focus:border-emerald-500 focus:outline-none"
          />
        </div>
        <div>
          <label className="block text-sm font-medium text-slate-300">Fulfillment *</label>
          <select
            value={value.prizeMode}
            onChange={(e) =>
              onChange({ ...value, prizeMode: e.target.value as PrizeMode })
            }
            className="mt-1 w-full max-w-md rounded border border-slate-700 bg-slate-800 px-3 py-2 text-slate-100 focus:border-emerald-500 focus:outline-none"
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
            className="mt-1 w-full max-w-md rounded border border-slate-700 bg-slate-800 px-3 py-2 text-slate-100 focus:border-emerald-500 focus:outline-none"
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
            className="mt-1 w-full rounded border border-slate-700 bg-slate-800 px-3 py-2 font-mono text-sm text-slate-100 focus:border-emerald-500 focus:outline-none"
          />
          <p className="mt-1 text-xs text-slate-500">
            After create, configure your prize wallet address and private key before funding
            and start. Include all prize assets plus fee SOL in that wallet.
          </p>
        </div>
      )}

      <div className="space-y-4">
        {value.prizeMode === 'MANUAL'
          ? value.manualPlaces.map((place, idx) => (
              <div
                key={place.place}
                className="rounded border border-slate-700 bg-slate-800/40 p-3"
              >
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
                  className="mt-1 w-full rounded border border-slate-700 bg-slate-800 px-3 py-2 text-slate-100 focus:border-emerald-500 focus:outline-none"
                />
              </div>
            ))
          : value.walletPlaces.map((place, pIdx) => (
              <div
                key={place.place}
                className="rounded border border-slate-700 bg-slate-800/40 p-3"
              >
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
                <div className="space-y-2">
                  {place.items.map((item, iIdx) => (
                    <div key={iIdx} className="flex flex-wrap items-end gap-2">
                      <select
                        value={item.kind}
                        onChange={(e) => {
                          const walletPlaces = [...value.walletPlaces];
                          const items = [...place.items];
                          const kind = e.target.value as PrizeAssetKind;
                          items[iIdx] =
                            kind === 'SOL'
                              ? { kind, lamports: '' }
                              : kind === 'NFT'
                                ? { kind, mint: '' }
                                : { kind, mint: '', amount: '', decimals: 0 };
                          walletPlaces[pIdx] = { ...place, items };
                          onChange({ ...value, walletPlaces });
                        }}
                        className="rounded border border-slate-700 bg-slate-800 px-2 py-1.5 text-sm text-slate-100"
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
                          onChange={(e) => {
                            const walletPlaces = [...value.walletPlaces];
                            const items = [...place.items];
                            items[iIdx] = { ...item, lamports: e.target.value };
                            walletPlaces[pIdx] = { ...place, items };
                            onChange({ ...value, walletPlaces });
                          }}
                          className="min-w-[120px] flex-1 rounded border border-slate-700 bg-slate-800 px-2 py-1.5 text-sm text-slate-100"
                        />
                      )}
                      {item.kind === 'SPL' && (
                        <>
                          <input
                            type="text"
                            placeholder="Mint address"
                            value={item.mint ?? ''}
                            onChange={(e) => {
                              const walletPlaces = [...value.walletPlaces];
                              const items = [...place.items];
                              items[iIdx] = { ...item, mint: e.target.value };
                              walletPlaces[pIdx] = { ...place, items };
                              onChange({ ...value, walletPlaces });
                            }}
                            className="min-w-[180px] flex-1 rounded border border-slate-700 bg-slate-800 px-2 py-1.5 font-mono text-xs text-slate-100"
                          />
                          <input
                            type="text"
                            placeholder="Amount (raw units)"
                            value={item.amount ?? ''}
                            onChange={(e) => {
                              const walletPlaces = [...value.walletPlaces];
                              const items = [...place.items];
                              items[iIdx] = { ...item, amount: e.target.value };
                              walletPlaces[pIdx] = { ...place, items };
                              onChange({ ...value, walletPlaces });
                            }}
                            className="w-28 rounded border border-slate-700 bg-slate-800 px-2 py-1.5 text-sm text-slate-100"
                          />
                          <input
                            type="number"
                            min={0}
                            max={18}
                            placeholder="Decimals"
                            value={item.decimals ?? 0}
                            onChange={(e) => {
                              const walletPlaces = [...value.walletPlaces];
                              const items = [...place.items];
                              items[iIdx] = {
                                ...item,
                                decimals: parseInt(e.target.value, 10) || 0,
                              };
                              walletPlaces[pIdx] = { ...place, items };
                              onChange({ ...value, walletPlaces });
                            }}
                            className="w-20 rounded border border-slate-700 bg-slate-800 px-2 py-1.5 text-sm text-slate-100"
                          />
                        </>
                      )}
                      {item.kind === 'NFT' && (
                        <input
                          type="text"
                          placeholder="NFT mint address"
                          value={item.mint ?? ''}
                          onChange={(e) => {
                            const walletPlaces = [...value.walletPlaces];
                            const items = [...place.items];
                            items[iIdx] = { ...item, mint: e.target.value };
                            walletPlaces[pIdx] = { ...place, items };
                            onChange({ ...value, walletPlaces });
                          }}
                          className="min-w-[200px] flex-1 rounded border border-slate-700 bg-slate-800 px-2 py-1.5 font-mono text-xs text-slate-100"
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
                  ))}
                </div>
              </div>
            ))}
      </div>
    </div>
  );
}
