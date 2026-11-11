import { useState } from "react";
import api from "../../services/api";
import type { MyPrizeClaim } from "./PrizesTab";

interface Props {
  claimEndpoint: string;
  myClaim: MyPrizeClaim;
  onUpdated?: () => void;
}

export function WalletClaimPanel({ claimEndpoint, myClaim, onUpdated }: Props) {
  const [address, setAddress] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [claimResult, setClaimResult] = useState<MyPrizeClaim | null>(null);
  const [pasteHint, setPasteHint] = useState<string | null>(null);

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

  const pasteFromClipboard = async () => {
    setPasteHint(null);
    setError(null);
    try {
      const text = await navigator.clipboard.readText();
      const trimmed = (text || "").trim();
      if (!trimmed) {
        setPasteHint("Clipboard is empty");
        return;
      }
      setAddress(trimmed);
      setPasteHint("Pasted");
      window.setTimeout(() => setPasteHint(null), 1500);
    } catch {
      setPasteHint("Clipboard access blocked — paste manually");
    }
  };

  const submitClaim = async () => {
    setLoading(true);
    setError(null);
    try {
      const token = localStorage.getItem("sessionToken");
      const res = await api.post(
        claimEndpoint,
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
      setError(err.response?.data?.error || "Claim failed");
    } finally {
      setLoading(false);
    }
  };

  if (displayClaim.status === "CLAIMED") {
    return (
      <div className="mt-3 space-y-2">
        {displayClaim.recipientAddress && (
          <p className="text-xs text-slate-400">
            Sent to{" "}
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
                  View transaction {solscanUrls.length > 1 ? i + 1 : ""} on Solscan →
                </a>
              </li>
            ))}
          </ul>
        )}
      </div>
    );
  }

  if (displayClaim.status !== "ELIGIBLE") return null;

  return (
    <div className="mt-3 space-y-3">
      <p className="text-center text-sm text-slate-300">
        Paste your Solana wallet address to receive your prize on mainnet.
      </p>
      <div className="flex items-stretch gap-2">
        <input
          type="text"
          placeholder="Your Solana wallet address"
          value={address}
          onChange={(e) => setAddress(e.target.value)}
          className="min-w-0 flex-1 bux-field px-3 py-2 font-mono text-xs text-slate-100"
        />
        <button
          type="button"
          onClick={() => void pasteFromClipboard()}
          className="inline-flex items-center justify-center rounded border border-slate-600 bg-slate-800 px-3 text-slate-200 transition hover:bg-slate-700 hover:text-white"
          title="Paste from clipboard"
          aria-label="Paste wallet address from clipboard"
        >
          <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path strokeLinecap="round" strokeLinejoin="round" d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2" />
            <rect x="9" y="3" width="6" height="4" rx="1" />
          </svg>
        </button>
      </div>
      {pasteHint && <p className="text-center text-xs text-slate-400">{pasteHint}</p>}
      <button
        type="button"
        onClick={() => void submitClaim()}
        disabled={loading || !address.trim()}
        className="w-full rounded bg-emerald-600 px-4 py-2 text-sm font-medium text-white hover:bg-emerald-700 disabled:opacity-50"
      >
        {loading ? "Sending prize…" : "Claim prize"}
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
