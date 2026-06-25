import { WalletClaimPanel } from './WalletClaimPanel';

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

interface Props {
  tournamentId?: string;
  tournament: {
    prizePlaces?: number;
    prizeMode?: 'MANUAL' | 'WALLET' | null;
    prizeStructure?: ManualPrizePlace[] | WalletPrizePlace[];
    prizeFundingStatus?: string | null;
    prizeWalletAddress?: string | null;
    walletConfigured?: boolean;
    requiredFeeSol?: string | null;
    prizeClaimServer?: { serverName: string; inviteLink: string | null } | null;
    myPrizeClaim?: MyPrizeClaim | null;
    hasPrizes?: boolean;
  };
  onUpdated?: () => void;
}

function placeLabel(place: number) {
  if (place === 1) return '1st';
  if (place === 2) return '2nd';
  if (place === 3) return '3rd';
  return `${place}th`;
}

function formatWalletItem(item: PrizeAsset) {
  if (item.kind === 'SOL') {
    const lamports = BigInt(item.lamports || '0');
    const sol = Number(lamports) / 1e9;
    return `${sol} SOL`;
  }
  if (item.kind === 'NFT') return `NFT (${item.mint.slice(0, 6)}…${item.mint.slice(-4)})`;
  return `Token ${item.mint.slice(0, 6)}… × ${item.amount}`;
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
      return 'Claim period ended';
    default:
      return status;
  }
}

export function PrizesTab({ tournamentId, tournament, onUpdated }: Props) {
  if (tournament.hasPrizes === false || !tournament.prizePlaces) {
    return (
      <p className="py-8 text-center text-slate-400">
        This event has no per-table prizes (league standings prizes apply at league end).
      </p>
    );
  }

  const structure = tournament.prizeStructure || [];
  const myClaim = tournament.myPrizeClaim;

  return (
    <div className="space-y-6">
      <div className="rounded-lg border border-slate-800 bg-slate-900/40 p-4">
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
        {structure.map((row) => (
          <div
            key={row.place}
            className="rounded-lg border border-slate-800 bg-slate-800/30 px-4 py-3"
          >
            <p className="text-sm font-medium text-emerald-400">{placeLabel(row.place)} place</p>
            {'description' in row && row.description ? (
              <p className="mt-1 text-slate-200">{row.description}</p>
            ) : (
              <ul className="mt-2 space-y-1 text-sm text-slate-300">
                {(row as WalletPrizePlace).items?.map((item, i) => (
                  <li key={i}>{formatWalletItem(item)}</li>
                ))}
              </ul>
            )}
          </div>
        ))}
      </div>

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
            tournamentId &&
            (myClaim.status === 'ELIGIBLE' || myClaim.status === 'CLAIMED') && (
              <WalletClaimPanel
                tournamentId={tournamentId}
                myClaim={myClaim}
                onUpdated={onUpdated}
              />
            )}
        </div>
      )}
    </div>
  );
}
