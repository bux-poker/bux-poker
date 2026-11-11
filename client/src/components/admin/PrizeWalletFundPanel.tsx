import { useMemo, useState } from 'react';
import {
  PublicKey,
  SystemProgram,
  Transaction,
} from '@solana/web3.js';
import {
  TOKEN_PROGRAM_ID,
  ASSOCIATED_TOKEN_PROGRAM_ID,
  createAssociatedTokenAccountInstruction,
  createTransferInstruction,
} from '@solana/spl-token';
import api from '../../services/api';

function bytesToBase64(bytes: Uint8Array): string {
  let binary = '';
  for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]!);
  return btoa(binary);
}

export interface DepositRequirements {
  prizeWalletAddress: string;
  solLamports: string;
  solAmount: string;
  feeSol?: string;
  spl: { mint: string; amount: string }[];
  nfts: { mint: string }[];
  rpcUrl: string;
}

type SolanaProvider = {
  isPhantom?: boolean;
  publicKey?: { toBytes(): Uint8Array; toString(): string };
  connect: () => Promise<{ publicKey: { toString(): string } }>;
  signTransaction: (tx: Transaction) => Promise<Transaction>;
};

function getProvider(): SolanaProvider | null {
  const w = window as unknown as {
    solana?: SolanaProvider;
    phantom?: { solana?: SolanaProvider };
    solflare?: SolanaProvider;
  };
  return w.solana ?? w.phantom?.solana ?? w.solflare ?? null;
}

function authHeaders() {
  const token = localStorage.getItem('sessionToken');
  return token ? { Authorization: `Bearer ${token}` } : undefined;
}

interface Props {
  kind: 'tournament' | 'league';
  eventId: string;
  requirements: DepositRequirements;
  onFunded: () => void;
}

export function PrizeWalletFundPanel({ kind, eventId, requirements, onFunded }: Props) {
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [walletLabel, setWalletLabel] = useState<string | null>(null);

  const summaryLines = useMemo(() => {
    const lines = [`${requirements.solAmount} SOL (prizes + fee buffer)`];
    for (const t of requirements.spl) {
      lines.push(`SPL ${t.mint.slice(0, 4)}…${t.mint.slice(-4)} × ${t.amount}`);
    }
    for (const n of requirements.nfts) {
      lines.push(`NFT ${n.mint.slice(0, 4)}…${n.mint.slice(-4)}`);
    }
    return lines;
  }, [requirements]);

  const connect = async () => {
    setError(null);
    const provider = getProvider();
    if (!provider) {
      setError('Install Phantom (or another Solana wallet) to fund prizes.');
      return null;
    }
    const res = await provider.connect();
    const pk = res.publicKey.toString();
    setWalletLabel(`${pk.slice(0, 4)}…${pk.slice(-4)}`);
    return provider;
  };

  const depositAndConfirm = async () => {
    setBusy(true);
    setError(null);
    setMessage(null);
    try {
      const provider = await connect();
      if (!provider?.publicKey) throw new Error('Wallet not connected');
      if (typeof provider.signTransaction !== 'function') {
        throw new Error('Wallet does not support signTransaction');
      }

      const payer = new PublicKey(provider.publicKey.toString());
      const preparePath =
        kind === 'league'
          ? `/api/admin/leagues/${eventId}/prize-funding/prepare`
          : `/api/admin/tournaments/${eventId}/prize-funding/prepare`;

      setMessage('Preparing deposit via API…');
      const { data: plan } = await api.post(
        preparePath,
        { payerAddress: payer.toBase58() },
        { headers: authHeaders() }
      );

      const dest = new PublicKey(plan.prizeWalletAddress);
      const tx = new Transaction();

      const solLamports = BigInt(plan.solLamports || '0');
      if (solLamports > 0n) {
        tx.add(
          SystemProgram.transfer({
            fromPubkey: payer,
            toPubkey: dest,
            lamports: Number(solLamports),
          })
        );
      }

      for (const t of plan.tokenTransfers || []) {
        const mint = new PublicKey(t.mint);
        const source = new PublicKey(t.source);
        const ata = new PublicKey(t.destinationAta);
        if (t.createDestAta) {
          tx.add(
            createAssociatedTokenAccountInstruction(
              payer,
              ata,
              dest,
              mint,
              TOKEN_PROGRAM_ID,
              ASSOCIATED_TOKEN_PROGRAM_ID
            )
          );
        }
        tx.add(
          createTransferInstruction(
            source,
            ata,
            payer,
            BigInt(t.amount),
            [],
            TOKEN_PROGRAM_ID
          )
        );
      }

      if (tx.instructions.length === 0) {
        throw new Error('Nothing to deposit');
      }

      tx.feePayer = payer;
      tx.recentBlockhash = plan.blockhash;

      setMessage('Approve the deposit in your wallet…');
      const signed = await provider.signTransaction(tx);
      const signedTransaction = bytesToBase64(signed.serialize());

      setMessage('Submitting via API…');
      const { data: sent } = await api.post(
        '/api/admin/solana/send-raw',
        { signedTransaction },
        { headers: authHeaders() }
      );
      const signature = sent.signature as string;
      setMessage(`Submitted ${signature.slice(0, 8)}… confirming…`);

      const confirmPath =
        kind === 'league'
          ? `/api/admin/leagues/${eventId}/prize-funding/confirm`
          : `/api/admin/tournaments/${eventId}/prize-funding/confirm`;
      await api.post(
        confirmPath,
        { signatures: [signature] },
        { headers: authHeaders() }
      );

      setMessage('Prizes deposited — event is funded.');
      onFunded();
    } catch (err: any) {
      const msg =
        err.response?.data?.error ||
        err.message ||
        'Deposit failed';
      setError(msg);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="rounded-lg border border-purple-500/40 bg-purple-500/10 p-4">
      <h3 className="text-sm font-semibold text-purple-100">Fund prize wallet</h3>
      <p className="mt-1 text-xs text-slate-400">
        Sign a transaction from your wallet to deposit this event&apos;s prizes plus a small SOL
        fee buffer into the shared prize vault. Required before start.
      </p>
      <p className="mt-2 break-all font-mono text-[11px] text-slate-300">
        Vault: {requirements.prizeWalletAddress}
      </p>
      <ul className="mt-2 list-inside list-disc text-xs text-slate-300">
        {summaryLines.map((line) => (
          <li key={line}>{line}</li>
        ))}
      </ul>
      {walletLabel && (
        <p className="mt-2 text-xs text-slate-400">Connected: {walletLabel}</p>
      )}
      <div className="mt-3 flex flex-wrap gap-2">
        <button
          type="button"
          onClick={() => void connect()}
          disabled={busy}
          className="rounded bg-slate-700 px-3 py-1.5 text-xs font-medium text-white hover:bg-slate-600 disabled:opacity-50"
        >
          Connect wallet
        </button>
        <button
          type="button"
          onClick={() => void depositAndConfirm()}
          disabled={busy}
          className="rounded bg-purple-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-purple-700 disabled:opacity-50"
        >
          {busy ? 'Depositing…' : 'Deposit prizes & confirm'}
        </button>
      </div>
      {message && <p className="mt-2 text-xs text-emerald-300">{message}</p>}
      {error && <p className="mt-2 text-xs text-rose-300">{error}</p>}
    </div>
  );
}
