import type { DepositRequirements } from '../admin/PrizeWalletFundPanel';
import { PrizeWalletFundPanel } from '../admin/PrizeWalletFundPanel';

interface Props {
  tournamentId: string;
  tournament: {
    prizeMode?: 'MANUAL' | 'WALLET' | null;
    prizeFundingStatus?: string | null;
    prizeWalletAddress?: string | null;
    walletConfigured?: boolean;
    requiredFeeSol?: string | null;
    depositRequirements?: DepositRequirements | null;
  };
  onUpdated?: () => void;
}

export function TournamentAdminPrizes({ tournamentId, tournament, onUpdated }: Props) {
  if (tournament.prizeMode !== 'WALLET') return null;

  const funded = tournament.prizeFundingStatus === 'FUNDED';
  const requirements = tournament.depositRequirements;

  return (
    <div className="mt-4 space-y-3">
      {funded ? (
        <div className="rounded-lg border border-emerald-500/30 bg-emerald-500/5 p-4">
          <h3 className="text-sm font-semibold text-emerald-200">Prize wallet funded</h3>
          <p className="mt-1 break-all font-mono text-xs text-slate-300">
            Vault: {tournament.prizeWalletAddress}
          </p>
          <p className="mt-1 text-xs text-slate-500">Status: FUNDED — tournament can start.</p>
        </div>
      ) : requirements ? (
        <PrizeWalletFundPanel
          kind="tournament"
          eventId={tournamentId}
          requirements={requirements}
          onFunded={() => onUpdated?.()}
        />
      ) : (
        <div className="rounded-lg border border-amber-500/30 bg-amber-500/5 p-4 text-xs text-amber-200">
          Prize deposit details unavailable. Ensure PRIZE_WALLET_PRIVATE_KEY is set on the API host.
        </div>
      )}
    </div>
  );
}
