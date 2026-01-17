import { useState, useEffect } from "react";

interface BettingControlsProps {
  onAction: (action: string, amount: number) => void;
  currentBet?: number;
  bigBlind?: number;
  myChips?: number;
  street?: string;
  minimumRaise?: number;
  isBigBlind?: boolean;
  myContribution?: number; // How much I've already contributed this round
}

export function BettingControls({ 
  onAction, 
  currentBet = 0, 
  bigBlind = 20,
  myChips = 0,
  street = 'PREFLOP',
  minimumRaise = 20,
  isBigBlind = false,
  isMyTurn = false,
  myContribution = 0, // How much I've already contributed this round
}: BettingControlsProps) {
  const [raiseAmount, setRaiseAmount] = useState(bigBlind * 2);

  const potSize = 100; // TODO: Get actual pot size from props
  const isPreflop = street === 'PREFLOP';
  // Determine if there have been raises (any bet > big blind in preflop, or any bet > 0 post-flop)
  const hasRaises = isPreflop ? currentBet > bigBlind : currentBet > 0;
  const canCheck = !isPreflop || (isPreflop && isBigBlind && !hasRaises && currentBet === bigBlind);
  
  // CALL amount: how much MORE I need to add (currentBet - what I've already contributed)
  const callAmount = Math.max(0, currentBet - myContribution);
  
  // RAISE amount: total bet amount I'd raise to (currentBet + minimumRaise)
  const minRaiseAmount = currentBet + minimumRaise;

  // Update raise amount when current bet changes
  useEffect(() => {
    if (isPreflop && currentBet === 0) {
      // Preflop, no bets yet - min raise is 2x big blind
      setRaiseAmount(bigBlind * 2);
    } else if (currentBet > 0) {
      // There's a current bet - min raise is current bet + minimum raise
      setRaiseAmount(minRaiseAmount);
    } else {
      // Post-flop, no bets yet - min bet is big blind
      setRaiseAmount(bigBlind);
    }
  }, [currentBet, bigBlind, minimumRaise, isPreflop, minRaiseAmount]);

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

  const handleFold = () => {
    if (!isPreflop && currentBet === 0) {
      // Post-flop, no bets - warn it's free to check
      if (window.confirm('It\'s free to check. Are you sure you want to fold?')) {
        onAction("FOLD", 0);
      }
    } else {
      onAction("FOLD", 0);
    }
  };

  // Calculate button width to match main action buttons - wider to prevent text wrapping
  const buttonWidth = '140px'; // Wider to prevent text wrapping
  const buttonHeight = '48px'; // Same height for all main buttons

  // Determine which buttons to show
  const showCheck = !isPreflop || (isPreflop && isBigBlind && !hasRaises && currentBet === bigBlind);
  const actionLabel = isPreflop && currentBet === 0 ? 'RAISE' : (currentBet > 0 ? 'RAISE' : 'BET');
  // RAISE button shows total bet amount to raise TO (currentBet + minimumRaise)
  const actionAmount = raiseAmount;

  return (
    <div className="flex flex-col items-end gap-3">
      {/* Main Action Buttons - Right justified, same size, wider to prevent wrapping */}
      <div className="flex items-center gap-3" style={{ width: `calc(${buttonWidth} * 3 + 0.75rem * 2)` }}>
        <button
          onClick={handleFold}
          disabled={!isMyTurn}
          className="rounded-lg bg-red-600 px-6 py-3 text-base font-bold text-white shadow-lg hover:bg-red-700 transition-colors flex-1 whitespace-nowrap disabled:opacity-50 disabled:cursor-not-allowed"
          style={{ minWidth: buttonWidth, height: buttonHeight }}
        >
          FOLD
        </button>
        {showCheck ? (
          <button
            onClick={() => onAction("CHECK", 0)}
            disabled={!isMyTurn}
            className="rounded-lg bg-blue-600 px-6 py-3 text-base font-bold text-white shadow-lg hover:bg-blue-700 transition-colors flex-1 whitespace-nowrap disabled:opacity-50 disabled:cursor-not-allowed"
            style={{ minWidth: buttonWidth, height: buttonHeight }}
          >
            CHECK
          </button>
        ) : (
          <button
            onClick={() => onAction("CALL", callAmount)}
            disabled={!isMyTurn}
            className="rounded-lg bg-blue-600 px-6 py-3 text-base font-bold text-white shadow-lg hover:bg-blue-700 transition-colors flex-1 whitespace-nowrap disabled:opacity-50 disabled:cursor-not-allowed"
            style={{ minWidth: buttonWidth, height: buttonHeight }}
          >
            CALL {callAmount}
          </button>
        )}
        <button
          onClick={() => onAction(actionLabel, actionAmount)}
          disabled={!isMyTurn}
          className="rounded-lg bg-emerald-600 px-6 py-3 text-base font-bold text-white shadow-lg hover:bg-emerald-700 transition-colors flex-1 whitespace-nowrap disabled:opacity-50 disabled:cursor-not-allowed"
          style={{ minWidth: buttonWidth, height: buttonHeight }}
        >
          {actionLabel} {actionAmount}
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
              disabled={!isMyTurn}
              className="rounded bg-slate-700 px-3 py-2 text-sm font-medium text-slate-200 hover:bg-slate-600 transition-colors flex-1 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              1/2
            </button>
            <button
              onClick={() => handlePreset('pot')}
              disabled={!isMyTurn}
              className="rounded bg-slate-700 px-3 py-2 text-sm font-medium text-slate-200 hover:bg-slate-600 transition-colors flex-1 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              POT
            </button>
          </div>
          {/* Bottom row: 2/3 and ALL IN */}
          <div className="flex items-center gap-2">
            <button
              onClick={() => handlePreset('twothirds')}
              disabled={!isMyTurn}
              className="rounded bg-slate-700 px-3 py-2 text-sm font-medium text-slate-200 hover:bg-slate-600 transition-colors flex-1 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              2/3
            </button>
            <button
              onClick={() => handlePreset('allin')}
              disabled={!isMyTurn}
              className="rounded bg-red-700 px-3 py-2 text-sm font-medium text-white hover:bg-red-600 transition-colors flex-1 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              ALL IN
            </button>
          </div>
        </div>

        {/* Right side: Amount Input with +/- Controls - same height as both preset rows combined */}
        <div className="flex items-center gap-2">
            <button
              onClick={() => {
                const minAmount = isPreflop && currentBet === 0 ? bigBlind * 2 : (currentBet > 0 ? minRaiseAmount : bigBlind);
                setRaiseAmount(Math.max(minAmount, raiseAmount - minimumRaise));
              }}
              disabled={!isMyTurn}
              className="flex h-[68px] w-12 items-center justify-center rounded-full bg-slate-700 text-xl font-bold text-white hover:bg-slate-600 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            >
              −
            </button>
          <input
            type="number"
            disabled={!isMyTurn}
            className="h-[68px] w-32 rounded-lg border-2 border-slate-600 bg-slate-800 px-4 text-center text-lg font-bold text-white focus:border-emerald-500 focus:outline-none no-spinner disabled:opacity-50 disabled:cursor-not-allowed"
            style={{ 
              WebkitAppearance: 'none',
              MozAppearance: 'textfield',
              appearance: 'textfield'
            }}
            value={raiseAmount}
            onChange={(e) => {
              const minAmount = isPreflop && currentBet === 0 ? bigBlind * 2 : (currentBet > 0 ? minRaiseAmount : bigBlind);
              const val = Math.max(minAmount, Math.min(myChips, Number(e.target.value) || minAmount));
              setRaiseAmount(val);
            }}
            onWheel={(e) => e.currentTarget.blur()}
            min={isPreflop && currentBet === 0 ? bigBlind * 2 : (currentBet > 0 ? minRaiseAmount : bigBlind)}
            max={myChips}
          />
          <button
            onClick={() => setRaiseAmount(Math.min(myChips, raiseAmount + minimumRaise))}
            disabled={!isMyTurn}
            className="flex h-[68px] w-12 items-center justify-center rounded-full bg-slate-700 text-xl font-bold text-white hover:bg-slate-600 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          >
            +
          </button>
        </div>
      </div>
    </div>
  );
}
