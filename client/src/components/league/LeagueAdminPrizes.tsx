import type { DepositRequirements } from '../admin/PrizeWalletFundPanel';
import { PrizeWalletFundPanel } from '../admin/PrizeWalletFundPanel';

interface Props {
  leagueId: string;
  league: {
    prizeMode?: 'MANUAL' | 'WALLET' | null;
    prizeFundingStatus?: string | null;
    prizeWalletAddress?: string | null;
    walletConfigured?: boolean;
    requiredFeeSol?: string | null;
    depositRequirements?: DepositRequirements | null;
  };
  onUpdated?: () => void;
}

export function LeagueAdminPrizes({ leagueId, league, onUpdated }: Props) {
  if (league.prizeMode !== 'WALLET') return null;

  const funded = league.prizeFundingStatus === 'FUNDED';
  const requirements = league.depositRequirements;

  return (
    <div className="space-y-3">
      {funded ? (
        <div className="rounded-lg border border-emerald-500/30 bg-emerald-500/5 p-4">
          <h3 className="text-sm font-semibold text-emerald-200">League prize wallet funded</h3>
          <p className="mt-1 break-all font-mono text-xs text-slate-300">
            Vault: {league.prizeWalletAddress}
          </p>
          <p className="mt-1 text-xs text-slate-500">Status: FUNDED</p>
        </div>
      ) : requirements ? (
        <PrizeWalletFundPanel
          kind="league"
          eventId={leagueId}
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
