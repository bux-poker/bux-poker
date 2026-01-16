import { useState } from "react";

interface BettingControlsProps {
  onAction: (action: string, amount: number) => void;
  currentBet?: number;
  bigBlind?: number;
  myChips?: number;
}

export function BettingControls({ 
  onAction, 
  currentBet = 0, 
  bigBlind = 20,
  myChips = 0,
}: BettingControlsProps) {
  const [raiseAmount, setRaiseAmount] = useState(bigBlind * 2);

  const callAmount = currentBet || bigBlind;
  const potSize = 100; // TODO: Get actual pot size from props
  const maxBet = myChips;

  const handlePreset = (preset: string) => {
    switch (preset) {
      case 'half':
        setRaiseAmount(Math.floor(potSize / 2));
        break;
      case 'twothirds':
        setRaiseAmount(Math.floor(potSize * 0.67));
        break;
      case 'pot':
        setRaiseAmount(potSize);
        break;
      case 'allin':
        setRaiseAmount(myChips);
        break;
    }
  };

  // Calculate button width to match main action buttons - wider to prevent text wrapping
  const buttonWidth = '140px'; // Wider to prevent text wrapping
  const buttonHeight = '48px'; // Same height for all main buttons

  return (
    <div className="flex flex-col items-end gap-3">
      {/* Main Action Buttons - Right justified, same size, wider to prevent wrapping */}
      <div className="flex items-center gap-3" style={{ width: `calc(${buttonWidth} * 3 + 0.75rem * 2)` }}>
        <button
          onClick={() => onAction("FOLD", 0)}
          className="rounded-lg bg-red-600 px-6 py-3 text-base font-bold text-white shadow-lg hover:bg-red-700 transition-colors flex-1 whitespace-nowrap"
          style={{ minWidth: buttonWidth, height: buttonHeight }}
        >
          FOLD
        </button>
        <button
          onClick={() => onAction("CALL", callAmount)}
          className="rounded-lg bg-blue-600 px-6 py-3 text-base font-bold text-white shadow-lg hover:bg-blue-700 transition-colors flex-1 whitespace-nowrap"
          style={{ minWidth: buttonWidth, height: buttonHeight }}
        >
          {currentBet > 0 ? `CALL $${callAmount}` : 'CHECK'}
        </button>
        <button
          onClick={() => onAction("RAISE", raiseAmount)}
          className="rounded-lg bg-emerald-600 px-6 py-3 text-base font-bold text-white shadow-lg hover:bg-emerald-700 transition-colors flex-1 whitespace-nowrap"
          style={{ minWidth: buttonWidth, height: buttonHeight }}
        >
          RAISE {raiseAmount}
        </button>
      </div>

      {/* Preset Buttons and Input - Right justified, input to the right */}
      <div className="flex items-center gap-3" style={{ width: `calc(${buttonWidth} * 3 + 0.75rem * 2)` }}>
        {/* Left side: Preset buttons in 2 columns */}
        <div className="flex flex-col gap-2 flex-1">
          {/* Top row: 1/2 and POT */}
          <div className="flex items-center gap-2">
            <button
              onClick={() => handlePreset('half')}
              className="rounded bg-slate-700 px-3 py-2 text-sm font-medium text-slate-200 hover:bg-slate-600 transition-colors flex-1"
            >
              1/2
            </button>
            <button
              onClick={() => handlePreset('pot')}
              className="rounded bg-slate-700 px-3 py-2 text-sm font-medium text-slate-200 hover:bg-slate-600 transition-colors flex-1"
            >
              POT
            </button>
          </div>
          {/* Bottom row: 2/3 and ALL IN */}
          <div className="flex items-center gap-2">
            <button
              onClick={() => handlePreset('twothirds')}
              className="rounded bg-slate-700 px-3 py-2 text-sm font-medium text-slate-200 hover:bg-slate-600 transition-colors flex-1"
            >
              2/3
            </button>
            <button
              onClick={() => handlePreset('allin')}
              className="rounded bg-red-700 px-3 py-2 text-sm font-medium text-white hover:bg-red-600 transition-colors flex-1"
            >
              ALL IN
            </button>
          </div>
        </div>

        {/* Right side: Amount Input with +/- Controls - same height as both preset rows combined */}
        <div className="flex items-center gap-2">
          <button
            onClick={() => setRaiseAmount(Math.max(bigBlind, raiseAmount - bigBlind))}
            className="flex h-[68px] w-12 items-center justify-center rounded-lg bg-slate-700 text-xl font-bold text-white hover:bg-slate-600 transition-colors"
          >
            −
          </button>
          <input
            type="number"
            className="h-[68px] w-32 rounded-lg border-2 border-slate-600 bg-slate-800 px-4 text-center text-lg font-bold text-white focus:border-emerald-500 focus:outline-none [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
            style={{ 
              WebkitAppearance: 'none',
              MozAppearance: 'textfield'
            }}
            value={raiseAmount}
            onChange={(e) => {
              const val = Math.max(bigBlind, Math.min(myChips, Number(e.target.value) || bigBlind));
              setRaiseAmount(val);
            }}
            min={bigBlind}
            max={myChips}
          />
          <button
            onClick={() => setRaiseAmount(Math.min(myChips, raiseAmount + bigBlind))}
            className="flex h-[68px] w-12 items-center justify-center rounded-lg bg-slate-700 text-xl font-bold text-white hover:bg-slate-600 transition-colors"
          >
            +
          </button>
        </div>
      </div>
    </div>
  );
}
