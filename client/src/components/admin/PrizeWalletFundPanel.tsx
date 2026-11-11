import { useMemo, useState } from 'react';
import {
  Connection,
  PublicKey,
  SystemProgram,
  Transaction,
} from '@solana/web3.js';
import {
  TOKEN_PROGRAM_ID,
  ASSOCIATED_TOKEN_PROGRAM_ID,
  createAssociatedTokenAccountInstruction,
  createTransferInstruction,
  getAssociatedTokenAddress,
  getAccount,
} from '@solana/spl-token';
import api from '../../services/api';

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
  signAndSendTransaction: (
    tx: Transaction
  ) => Promise<{ signature: string } | string>;
};

function getProvider(): SolanaProvider | null {
  const w = window as unknown as {
    solana?: SolanaProvider;
    phantom?: { solana?: SolanaProvider };
    solflare?: SolanaProvider;
  };
  return w.solana ?? w.phantom?.solana ?? w.solflare ?? null;
}

async function ensureAtaIx(
  connection: Connection,
  payer: PublicKey,
  mint: PublicKey,
  owner: PublicKey
) {
  const ata = await getAssociatedTokenAddress(
    mint,
    owner,
    false,
    TOKEN_PROGRAM_ID,
    ASSOCIATED_TOKEN_PROGRAM_ID
  );
  try {
    await getAccount(connection, ata, undefined, TOKEN_PROGRAM_ID);
    return { ata, createIx: null as ReturnType<typeof createAssociatedTokenAccountInstruction> | null };
  } catch {
    return {
      ata,
      createIx: createAssociatedTokenAccountInstruction(
        payer,
        ata,
        owner,
        mint,
        TOKEN_PROGRAM_ID,
        ASSOCIATED_TOKEN_PROGRAM_ID
      ),
    };
  }
}

async function findSourceTokenAccount(
  connection: Connection,
  owner: PublicKey,
  mint: PublicKey,
  need: bigint
) {
  const resp = await connection.getParsedTokenAccountsByOwner(owner, {
    programId: TOKEN_PROGRAM_ID,
  });
  for (const acct of resp.value) {
    const info = acct.account.data.parsed?.info;
    if (!info || info.mint !== mint.toBase58()) continue;
    const amount = BigInt(info.tokenAmount?.amount || 0);
    if (amount >= need) return new PublicKey(acct.pubkey);
  }
  return null;
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

      const payer = new PublicKey(provider.publicKey.toString());
      const dest = new PublicKey(requirements.prizeWalletAddress);
      const connection = new Connection(requirements.rpcUrl, 'confirmed');
      const tx = new Transaction();

      const solLamports = BigInt(requirements.solLamports || '0');
      if (solLamports > 0n) {
        tx.add(
          SystemProgram.transfer({
            fromPubkey: payer,
            toPubkey: dest,
            lamports: Number(solLamports),
          })
        );
      }

      const tokenTransfers = [
        ...requirements.spl.map((s) => ({ mint: s.mint, amount: BigInt(s.amount) })),
        ...requirements.nfts.map((n) => ({ mint: n.mint, amount: 1n })),
      ];

      for (const t of tokenTransfers) {
        const mint = new PublicKey(t.mint);
        const source = await findSourceTokenAccount(connection, payer, mint, t.amount);
        if (!source) {
          throw new Error(`Your wallet is missing token ${t.mint.slice(0, 8)}…`);
        }
        const { ata, createIx } = await ensureAtaIx(connection, payer, mint, dest);
        if (createIx) tx.add(createIx);
        tx.add(
          createTransferInstruction(
            source,
            ata,
            payer,
            t.amount,
            [],
            TOKEN_PROGRAM_ID
          )
        );
      }

      if (tx.instructions.length === 0) {
        throw new Error('Nothing to deposit');
      }

      const { blockhash, lastValidBlockHeight } = await connection.getLatestBlockhash();
      tx.feePayer = payer;
      tx.recentBlockhash = blockhash;

      const sent = await provider.signAndSendTransaction(tx);
      const signature = typeof sent === 'string' ? sent : sent.signature;
      setMessage(`Submitted ${signature.slice(0, 8)}… confirming…`);

      await connection.confirmTransaction({ signature, blockhash, lastValidBlockHeight }, 'confirmed');

      const token = localStorage.getItem('sessionToken');
      const path =
        kind === 'league'
          ? `/api/admin/leagues/${eventId}/prize-funding/confirm`
          : `/api/admin/tournaments/${eventId}/prize-funding/confirm`;
      await api.post(
        path,
        { signatures: [signature] },
        { headers: { Authorization: `Bearer ${token}` } }
      );

      setMessage('Prizes deposited — event is funded.');
      onFunded();
    } catch (err: any) {
      setError(err.response?.data?.error || err.message || 'Deposit failed');
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
