import { useState } from "react";

interface BettingControlsProps {
  onAction: (action: string, amount: number) => void;
}

export function BettingControls({ onAction }: BettingControlsProps) {
  const [amount, setAmount] = useState(0);

  return (
    <div className="mt-4 rounded-lg border border-slate-800 bg-slate-900/70 p-4">
      <div className="flex flex-wrap items-center gap-3">
        <button
          onClick={() => onAction("FOLD", 0)}
          className="rounded bg-slate-700 px-4 py-2 text-sm font-medium text-slate-100 hover:bg-slate-600"
        >
          Fold
        </button>
        <button
          onClick={() => onAction("CHECK", 0)}
          className="rounded bg-slate-700 px-4 py-2 text-sm font-medium text-slate-100 hover:bg-slate-600"
        >
          Check
        </button>
        <button
          onClick={() => onAction("CALL", amount)}
          className="rounded bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-500"
        >
          Call
        </button>
        <button
          onClick={() => onAction("BET", amount)}
          className="rounded bg-emerald-600 px-4 py-2 text-sm font-medium text-white hover:bg-emerald-500"
        >
          Bet
        </button>
        <button
          onClick={() => onAction("RAISE", amount)}
          className="rounded bg-amber-600 px-4 py-2 text-sm font-medium text-white hover:bg-amber-500"
        >
          Raise
        </button>
        <button
          onClick={() => onAction("ALL_IN", amount)}
          className="rounded bg-red-600 px-4 py-2 text-sm font-medium text-white hover:bg-red-500"
        >
          All-in
        </button>
        <div className="ml-auto flex items-center gap-2">
          <span className="text-xs text-slate-400">Amount</span>
          <input
            type="number"
            className="w-24 rounded border border-slate-700 bg-slate-900 px-2 py-1 text-sm text-slate-100"
            value={amount}
            onChange={(e) => setAmount(Number(e.target.value) || 0)}
            min={0}
          />
        </div>
      </div>
    </div>
  );
}

