import { WalletClaimPanel } from './WalletClaimPanel';
import { ManualPrizeVisual, PrizeAssetVisual } from './PrizeAssetVisual';

type PrizeAsset =
  | { kind: 'SOL'; lamports: string }
  | { kind: 'SPL'; mint: string; amount: string; decimals?: number }
  | { kind: 'NFT'; mint: string };

export interface ManualPrizePlace {
  place: number;
  description: string;
}

export interface WalletPrizePlace {
  place: number;
  items: PrizeAsset[];
}

export interface MyPrizeClaim {
  id: string;
  finishingPlace: number;
  status: string;
  eligibleFrom?: string | null;
  eligibleUntil?: string | null;
  claimedAt?: string | null;
  recipientAddress?: string | null;
  txSignaturesJson?: string;
  txSignatures?: string[];
  solscanUrls?: string[];
}

export interface PrizeClaimSummaryRow {
  finishingPlace: number;
  status: string;
  recipientAddress?: string | null;
  claimedAt?: string | null;
  username?: string | null;
  userId?: string;
  txSignatures?: string[];
  solscanUrls?: string[];
}

interface Props {
  tournamentId?: string;
  tournament: {
    status?: string;
    prizePlaces?: number;
    prizeMode?: 'MANUAL' | 'WALLET' | null;
    prizeStructure?: ManualPrizePlace[] | WalletPrizePlace[];
    prizeFundingStatus?: string | null;
    prizeWalletAddress?: string | null;
    walletConfigured?: boolean;
    requiredFeeSol?: string | null;
    prizeClaimServer?: { serverName: string; inviteLink: string | null } | null;
    myPrizeClaim?: MyPrizeClaim | null;
    prizeClaims?: PrizeClaimSummaryRow[];
    hasPrizes?: boolean;
  };
  onUpdated?: () => void;
  /** When false, show structure only (e.g. league still in progress). */
  prizesAvailable?: boolean;
  claimEndpoint?: string;
}

function placeLabel(place: number) {
  if (place === 1) return '1st';
  if (place === 2) return '2nd';
  if (place === 3) return '3rd';
  return `${place}th`;
}

function claimStatusLabel(status: string) {
  switch (status) {
    case 'ELIGIBLE':
      return 'Ready to claim';
    case 'MANUAL_PENDING':
      return 'Open a Discord ticket to claim';
    case 'CLAIMED':
      return 'Claimed';
    case 'EXPIRED':
      return 'Claim period ended — prize will be refunded to the creator';
    case 'SWEPT':
      return 'Unclaimed prize refunded to tournament creator';
    default:
      return status;
  }
}

function shortAddress(addr: string) {
  if (addr.length <= 12) return addr;
  return `${addr.slice(0, 4)}…${addr.slice(-4)}`;
}

function ClaimedTickIcon() {
  return (
    <span
      className="inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-white shadow-sm"
      aria-hidden
    >
      <svg width="12" height="12" viewBox="0 0 12 12" fill="none" xmlns="http://www.w3.org/2000/svg">
        <path
          d="M2.5 6.2L4.8 8.5L9.5 3.5"
          stroke="#16a34a"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
    </span>
  );
}

function placeClaimBadge(claim: PrizeClaimSummaryRow | undefined, tournamentEnded: boolean) {
  if (!tournamentEnded) return null;
  if (!claim) {
    return (
      <span className="rounded border border-amber-500/40 bg-amber-500/10 px-2 py-0.5 text-[11px] font-medium uppercase tracking-wide text-amber-200">
        Pending
      </span>
    );
  }
  if (claim.status === 'CLAIMED') {
    return (
      <span className="inline-flex items-center gap-1.5 rounded border border-emerald-500/40 bg-emerald-500/10 px-2 py-0.5 text-[11px] font-medium uppercase tracking-wide text-emerald-300">
        <ClaimedTickIcon />
        Claimed
      </span>
    );
  }
  if (claim.status === 'SWEPT' || claim.status === 'EXPIRED') {
    return (
      <span className="rounded border border-slate-500/40 bg-slate-500/10 px-2 py-0.5 text-[11px] font-medium uppercase tracking-wide text-slate-300">
        {claim.status === 'SWEPT' ? 'Refunded' : 'Expired'}
      </span>
    );
  }
  return (
    <span className="rounded border border-amber-500/40 bg-amber-500/10 px-2 py-0.5 text-[11px] font-medium uppercase tracking-wide text-amber-200">
      Pending
    </span>
  );
}

export function PrizesTab({
  tournamentId,
  tournament,
  onUpdated,
  prizesAvailable = true,
  claimEndpoint,
}: Props) {
  if (tournament.hasPrizes === false || !tournament.prizePlaces) {
    return (
      <p className="py-8 text-center text-slate-400">
        This event has no per-table prizes (league standings prizes apply at league end).
      </p>
    );
  }

  const structure = tournament.prizeStructure || [];
  const myClaim = tournament.myPrizeClaim;
  const tournamentEnded =
    tournament.status === 'COMPLETED' || tournament.status === 'CANCELLED';
  const claimsByPlace = new Map(
    (tournament.prizeClaims || []).map((c) => [c.finishingPlace, c])
  );

  return (
    <div className="space-y-6">
      <div className="bux-surface p-4">
        <p className="text-sm text-slate-400">
          Paid places: <span className="text-slate-200">{tournament.prizePlaces}</span>
          {' · '}
          Mode:{' '}
          <span className="text-slate-200">
            {tournament.prizeMode === 'WALLET' ? 'On-site wallet claim' : 'Discord ticket'}
          </span>
        </p>
        {tournament.prizeMode === 'WALLET' && (
          <p className="mt-2 text-xs text-slate-500">
            Wallet claims expire 7 days after your finish is locked in.
            {tournament.requiredFeeSol && (
              <> Fee buffer: {tournament.requiredFeeSol} SOL (included in funding requirement).</>
            )}
          </p>
        )}
      </div>

      <div className="space-y-3">
        {structure.map((row) => {
          const claim = claimsByPlace.get(row.place);
          return (
            <div
              key={row.place}
              className="bux-surface px-4 py-3"
            >
              <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="text-sm font-medium text-emerald-400">
                  {placeLabel(row.place)} place
                  {claim?.username ? (
                    <span className="ml-2 font-normal text-slate-400">
                      · {claim.username}
                    </span>
                  ) : null}
                </p>
                {placeClaimBadge(claim, tournamentEnded)}
              </div>
              {'description' in row && row.description ? (
                <div className="mt-3">
                  <ManualPrizeVisual description={row.description} />
                </div>
              ) : (
                <div className="mt-3 flex flex-col gap-3">
                  {(row as WalletPrizePlace).items?.map((item, i) => (
                    <PrizeAssetVisual key={i} item={item} layout="row" />
                  ))}
                </div>
              )}
              {tournamentEnded && claim?.status === 'CLAIMED' && (
                <div className="mt-2 space-y-1 text-xs text-slate-400">
                  {claim.recipientAddress && (
                    <p className="break-all font-mono">
                      Wallet:{' '}
                      <span className="text-slate-200">
                        {shortAddress(claim.recipientAddress)}
                      </span>
                      <span className="ml-2 hidden sm:inline text-slate-500">
                        ({claim.recipientAddress})
                      </span>
                    </p>
                  )}
                  {(claim.solscanUrls && claim.solscanUrls.length > 0
                    ? claim.solscanUrls
                    : (claim.txSignatures || []).map(
                        (sig) => `https://solscan.io/tx/${sig}`
                      )
                  ).map((url, i, arr) => (
                    <p key={url}>
                      <a
                        href={url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-emerald-400 hover:underline"
                      >
                        {arr.length > 1
                          ? `Claim transaction ${i + 1} on Solscan →`
                          : 'Claim transaction on Solscan →'}
                      </a>
                    </p>
                  ))}
                </div>
              )}
              {tournamentEnded &&
                claim &&
                (claim.status === 'ELIGIBLE' || claim.status === 'MANUAL_PENDING') && (
                  <p className="mt-2 text-xs text-amber-200/90">
                    Prize not claimed yet
                  </p>
                )}
            </div>
          );
        })}
      </div>

      {!prizesAvailable && (
        <p className="bux-surface px-4 py-3 text-sm text-slate-400">
          Prize claims open when the league completes and final standings are locked in.
        </p>
      )}

      {myClaim && (
        <div className="rounded-lg border border-emerald-500/40 bg-emerald-500/10 p-4">
          <p className="font-medium text-emerald-300">
            Your result: {placeLabel(myClaim.finishingPlace)} place
          </p>
          <p className="mt-1 text-sm text-slate-300">{claimStatusLabel(myClaim.status)}</p>
          {myClaim.eligibleUntil && myClaim.status === 'ELIGIBLE' && (
            <p className="mt-1 text-xs text-slate-400">
              Claim by {new Date(myClaim.eligibleUntil).toLocaleString()}
            </p>
          )}
          {myClaim.status === 'MANUAL_PENDING' && tournament.prizeClaimServer && (
            <div className="mt-3">
              <p className="text-sm text-slate-300">
                Join{' '}
                <span className="font-medium">{tournament.prizeClaimServer.serverName}</span>{' '}
                and open a ticket to claim your prize.
              </p>
              {tournament.prizeClaimServer.inviteLink && (
                <a
                  href={tournament.prizeClaimServer.inviteLink}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="mt-2 inline-block text-sm text-emerald-400 hover:underline"
                >
                  Open Discord server →
                </a>
              )}
            </div>
          )}
          {tournament.prizeMode === 'WALLET' &&
            claimEndpoint &&
            (myClaim.status === 'ELIGIBLE' || myClaim.status === 'CLAIMED') && (
              <WalletClaimPanel
                claimEndpoint={claimEndpoint}
                myClaim={myClaim}
                onUpdated={onUpdated}
              />
            )}
          {myClaim.status === 'SWEPT' &&
            myClaim.solscanUrls &&
            myClaim.solscanUrls.length > 0 && (
              <ul className="mt-3 space-y-1">
                {myClaim.solscanUrls.map((url, i) => (
                  <li key={url}>
                    <a
                      href={url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-sm text-slate-400 hover:underline"
                    >
                      Refund transaction {myClaim.solscanUrls!.length > 1 ? i + 1 : ''} on Solscan →
                    </a>
                  </li>
                ))}
              </ul>
            )}
        </div>
      )}
    </div>
  );
}
