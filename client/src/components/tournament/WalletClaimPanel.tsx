import { useState } from 'react';
import api from '../../services/api';
import type { MyPrizeClaim } from './PrizesTab';

interface Props {
  tournamentId: string;
  myClaim: MyPrizeClaim;
  onUpdated?: () => void;
}

export function WalletClaimPanel({ tournamentId, myClaim, onUpdated }: Props) {
  const [address, setAddress] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [claimResult, setClaimResult] = useState<MyPrizeClaim | null>(null);

  const displayClaim = claimResult || myClaim;
  let txSignatures = displayClaim.txSignatures || [];
  if (!txSignatures.length && displayClaim.txSignaturesJson) {
    try {
      txSignatures = JSON.parse(displayClaim.txSignaturesJson) as string[];
    } catch {
      txSignatures = [];
    }
  }
  const solscanUrls =
    displayClaim.solscanUrls && displayClaim.solscanUrls.length > 0
      ? displayClaim.solscanUrls
      : txSignatures.map((sig) => `https://solscan.io/tx/${sig}`);

  const submitClaim = async () => {
    setLoading(true);
    setError(null);
    try {
      const token = localStorage.getItem('sessionToken');
      const res = await api.post(
        `/api/tournaments/${tournamentId}/claim-prize`,
        { recipientAddress: address.trim() },
        { headers: { Authorization: `Bearer ${token}` } }
      );
      const claim = res.data?.claim;
      if (claim) {
        setClaimResult({
          id: claim.id,
          finishingPlace: claim.finishingPlace,
          status: claim.status,
          eligibleFrom: claim.eligibleFrom,
          eligibleUntil: claim.eligibleUntil,
          claimedAt: claim.claimedAt,
          recipientAddress: claim.recipientAddress,
          txSignatures: claim.txSignatures,
        });
      }
      onUpdated?.();
    } catch (err: any) {
      setError(err.response?.data?.error || 'Claim failed');
    } finally {
      setLoading(false);
    }
  };

  if (displayClaim.status === 'CLAIMED') {
    return (
      <div className="mt-3 space-y-2">
        {displayClaim.recipientAddress && (
          <p className="text-xs text-slate-400">
            Sent to{' '}
            <span className="break-all font-mono text-slate-300">
              {displayClaim.recipientAddress}
            </span>
          </p>
        )}
        {displayClaim.claimedAt && (
          <p className="text-xs text-slate-500">
            Claimed {new Date(displayClaim.claimedAt).toLocaleString()}
          </p>
        )}
        {solscanUrls.length > 0 && (
          <ul className="space-y-1">
            {solscanUrls.map((url, i) => (
              <li key={url}>
                <a
                  href={url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-sm text-emerald-400 hover:underline"
                >
                  View transaction {solscanUrls.length > 1 ? i + 1 : ''} on Solscan →
                </a>
              </li>
            ))}
          </ul>
        )}
      </div>
    );
  }

  if (displayClaim.status !== 'ELIGIBLE') return null;

  return (
    <div className="mt-3 space-y-3">
      <p className="text-sm text-slate-300">
        Paste your Solana wallet address to receive your prize on mainnet.
      </p>
      <input
        type="text"
        placeholder="Your Solana wallet address"
        value={address}
        onChange={(e) => setAddress(e.target.value)}
        className="w-full rounded border border-slate-700 bg-slate-900 px-3 py-2 font-mono text-xs text-slate-100"
      />
      <button
        type="button"
        onClick={() => void submitClaim()}
        disabled={loading || !address.trim()}
        className="rounded bg-emerald-600 px-4 py-2 text-sm font-medium text-white hover:bg-emerald-700 disabled:opacity-50"
      >
        {loading ? 'Sending prize…' : 'Claim prize'}
      </button>
      {error && <p className="text-xs text-red-400">{error}</p>}
      {loading && (
        <p className="text-xs text-slate-500">
          On-chain transfer in progress — do not close this page.
        </p>
      )}
    </div>
  );
}
