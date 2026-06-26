import { useState } from 'react';
import api from '../../services/api';

interface Props {
  leagueId: string;
  league: {
    prizeMode?: 'MANUAL' | 'WALLET' | null;
    prizeFundingStatus?: string | null;
    prizeWalletAddress?: string | null;
    walletConfigured?: boolean;
    requiredFeeSol?: string | null;
  };
  onUpdated?: () => void;
}

export function LeagueAdminPrizes({ leagueId, league, onUpdated }: Props) {
  const [walletAddress, setWalletAddress] = useState('');
  const [privateKey, setPrivateKey] = useState('');
  const [loading, setLoading] = useState(false);
  const [fundingLoading, setFundingLoading] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [fundingMissing, setFundingMissing] = useState<string[]>([]);

  if (league.prizeMode !== 'WALLET') return null;

  const saveWallet = async () => {
    setLoading(true);
    setMessage(null);
    try {
      const token = localStorage.getItem('sessionToken');
      await api.post(
        `/api/admin/leagues/${leagueId}/prize-wallet`,
        {
          prizeWalletAddress: walletAddress.trim(),
          prizeWalletPrivateKey: privateKey.trim(),
        },
        { headers: { Authorization: `Bearer ${token}` } }
      );
      setMessage('Prize wallet saved.');
      setPrivateKey('');
      onUpdated?.();
    } catch (err: any) {
      setMessage(err.response?.data?.error || 'Failed to save wallet');
    } finally {
      setLoading(false);
    }
  };

  const refreshFunding = async () => {
    setFundingLoading(true);
    setMessage(null);
    setFundingMissing([]);
    try {
      const token = localStorage.getItem('sessionToken');
      const res = await api.post(
        `/api/admin/leagues/${leagueId}/prize-funding/refresh`,
        {},
        { headers: { Authorization: `Bearer ${token}` } }
      );
      const check = res.data?.fundingCheck;
      if (check?.funded) {
        setMessage('Prize wallet is fully funded.');
      } else {
        setMessage('Wallet not fully funded yet.');
        setFundingMissing(check?.missing || []);
      }
      onUpdated?.();
    } catch (err: any) {
      setMessage(err.response?.data?.error || 'Funding check failed');
    } finally {
      setFundingLoading(false);
    }
  };

  return (
    <div className="rounded-lg border border-purple-500/30 bg-purple-500/5 p-4">
      <h3 className="text-sm font-semibold text-purple-200">League prize wallet (admin)</h3>
      <p className="mt-1 text-xs text-slate-400">
        Configure and fund the league end-of-season prize wallet before the final leg starts.
      </p>

      {league.walletConfigured && league.prizeWalletAddress && (
        <p className="mt-2 break-all font-mono text-xs text-slate-300">
          Wallet: {league.prizeWalletAddress}
        </p>
      )}
      <p className="mt-1 text-xs text-slate-500">
        Status: {league.prizeFundingStatus || 'PENDING'}
      </p>

      {!league.walletConfigured && (
        <div className="mt-3 space-y-2">
          <input
            type="text"
            placeholder="Prize wallet public address"
            value={walletAddress}
            onChange={(e) => setWalletAddress(e.target.value)}
            className="w-full rounded border border-slate-700 bg-slate-800 px-3 py-2 font-mono text-xs text-slate-100"
          />
          <textarea
            placeholder="Private key (base58, base64, or JSON byte array)"
            value={privateKey}
            onChange={(e) => setPrivateKey(e.target.value)}
            rows={2}
            className="w-full rounded border border-slate-700 bg-slate-800 px-3 py-2 font-mono text-xs text-slate-100"
          />
          <button
            type="button"
            onClick={() => void saveWallet()}
            disabled={loading || !walletAddress.trim() || !privateKey.trim()}
            className="rounded bg-purple-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-purple-700 disabled:opacity-50"
          >
            {loading ? 'Saving…' : 'Save prize wallet'}
          </button>
        </div>
      )}

      {league.walletConfigured && (
        <button
          type="button"
          onClick={() => void refreshFunding()}
          disabled={fundingLoading}
          className="mt-3 rounded bg-purple-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-purple-700 disabled:opacity-50"
        >
          {fundingLoading ? 'Checking…' : 'Check funding on-chain'}
        </button>
      )}

      {message && <p className="mt-2 text-xs text-slate-300">{message}</p>}
      {fundingMissing.length > 0 && (
        <ul className="mt-2 list-inside list-disc text-xs text-amber-300">
          {fundingMissing.map((m) => (
            <li key={m}>{m}</li>
          ))}
        </ul>
      )}
    </div>
  );
}
