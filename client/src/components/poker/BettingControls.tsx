import { useState, useEffect, useRef } from "react";

interface PlayerForBetting {
  chips: number;
  status: string;
  userId?: string;
}

interface BettingControlsProps {
  onAction: (action: string, amount: number) => void;
  currentBet?: number;
  bigBlind?: number;
  myChips?: number;
  street?: string;
  minimumRaise?: number;
  isBigBlind?: boolean;
  isMyTurn?: boolean; // Whether it's currently the player's turn
  myContribution?: number; // How much I've already contributed this round
  players?: PlayerForBetting[];
  myUserId?: string;
  /** Total pot (main + current street) for bet presets */
  potSize?: number;
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
  players: _players = [],
  myUserId: _myUserId,
  potSize: potSizeProp,
}: BettingControlsProps) {
  const [raiseAmount, setRaiseAmount] = useState(bigBlind * 2);

  const potSize = Math.max(0, Math.floor(Number(potSizeProp) || 0));
  const isPreflop = street === 'PREFLOP';
  // Determine if there have been raises (any bet > big blind in preflop, or any bet > 0 post-flop)
  const hasRaises = isPreflop ? currentBet > bigBlind : currentBet > 0;
  const canCheck = !isPreflop || (isPreflop && isBigBlind && !hasRaises && currentBet === bigBlind);
  
  // CALL amount: how much MORE I need to add, capped at my stack (can't call more than I have)
  const toCall = Math.max(0, currentBet - myContribution);
  const callAmount = Math.min(toCall, myChips);
  // When my stack is less than the full call, I can only go all-in (show ALL IN, not CALL 167)
  const isAllInOnly = myChips > 0 && toCall > myChips;
  
  // RAISE amount: total bet amount I'd raise to (currentBet + minimumRaise)
  const minRaiseAmount = currentBet + minimumRaise;
  // Max total bet = what we've put in + entire stack (true all-in)
  const maxTotalBet = myContribution + myChips;
  // Smallest legal total bet: full min raise, or our entire stack if we cannot afford the min raise (short all-in)
  const minTotalBet = Math.min(minRaiseAmount, maxTotalBet);

  /** Minimum legal total shown in the raise field (open / bet / min-raise-to). */
  const inputMin =
    isPreflop && currentBet === 0
      ? bigBlind * 2
      : currentBet > 0
        ? minTotalBet
        : bigBlind;
  const inputMax = maxTotalBet;
  /** Step for +/- buttons = minimum raise increment (table min raise). */
  const stepSize = Math.max(1, minimumRaise);

  // Presets: total raise-to amount equals fractions of current total pot (see server `pot`).
  const targetHalfPot = Math.floor(potSize / 2);
  const targetTwoThirdsPot = Math.floor((potSize * 2) / 3);
  const targetFullPot = potSize;
  const presetHalfDisabled =
    !isMyTurn || potSize <= 0 || targetHalfPot < inputMin;
  const presetTwoThirdsDisabled =
    !isMyTurn || potSize <= 0 || targetTwoThirdsPot < inputMin;
  const presetPotDisabled =
    !isMyTurn || potSize <= 0 || targetFullPot < inputMin;

  // Only reset default raise when the betting line changes — not when pot/stack ticks (fixes 1/2, POT, etc. being overwritten).
  const lineKey = `${street}|${currentBet}`;
  const prevLineKeyRef = useRef<string | null>(null);
  useEffect(() => {
    const defaultAmount =
      isPreflop && currentBet === 0
        ? bigBlind * 2
        : currentBet > 0
          ? minTotalBet
          : bigBlind;
    const defaultClamped = Math.min(
      Math.max(defaultAmount, inputMin),
      inputMax
    );

    if (prevLineKeyRef.current !== lineKey) {
      prevLineKeyRef.current = lineKey;
      setRaiseAmount(defaultClamped);
      return;
    }
    setRaiseAmount((a) => Math.max(inputMin, Math.min(inputMax, a)));
  }, [
    lineKey,
    street,
    currentBet,
    bigBlind,
    minimumRaise,
    isPreflop,
    minTotalBet,
    inputMin,
    inputMax,
  ]);

  const handlePreset = (preset: string) => {
    switch (preset) {
      case "half":
        if (presetHalfDisabled) return;
        setRaiseAmount(Math.min(inputMax, targetHalfPot));
        break;
      case "twothirds":
        if (presetTwoThirdsDisabled) return;
        setRaiseAmount(Math.min(inputMax, targetTwoThirdsPot));
        break;
      case "pot":
        if (presetPotDisabled) return;
        setRaiseAmount(Math.min(inputMax, targetFullPot));
        break;
      case "allin":
        setRaiseAmount(myContribution + myChips);
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

  // Window size state to trigger re-renders when CSS variables change
  const [windowSize, setWindowSize] = useState({ width: typeof window !== 'undefined' ? window.innerWidth : 1400 });
  
  // Listen for window resize to update CSS variable calculations
  useEffect(() => {
    const handleResize = () => {
      setWindowSize({ width: window.innerWidth });
    };
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);
  
  // Calculate button width - using CSS variables directly in styles, but need container width
  // Calculate container width using CSS variables (trigger recalculation on resize)
  const containerWidth = typeof window !== 'undefined'
    ? `calc(${getComputedStyle(document.documentElement).getPropertyValue('--action-button-width') || '140px'} * 3 + 0.75rem * 2)`
    : 'calc(140px * 3 + 0.75rem * 2)';
  // Use windowSize to force recalculation
  void windowSize.width;

  // Determine which buttons to show
  // You can CHECK when your contribution equals the current bet (no bet to call)
  // Special case: Big blind can check in pre-flop when no one has raised (currentBet === bigBlind)
  // Otherwise, you must CALL the difference
  const showCheck = currentBet === myContribution || (isPreflop && isBigBlind && currentBet === bigBlind && !hasRaises);
  const actionLabel = isPreflop && currentBet === 0 ? 'RAISE' : (currentBet > 0 ? 'RAISE' : 'BET');
  // RAISE button shows total bet amount to raise TO (currentBet + minimumRaise)
  const actionAmount = raiseAmount;

  return (
    <div className="flex flex-col items-end gap-3">
      {/* Main Action Buttons - Right justified, same size, wider to prevent wrapping */}
      <div className="flex items-center gap-3" style={{ width: containerWidth }}>
        <button
          onClick={handleFold}
          disabled={!isMyTurn}
          className="rounded-lg bg-red-600 font-bold text-white shadow-lg hover:bg-red-700 transition-colors flex-1 whitespace-nowrap disabled:opacity-50 disabled:cursor-not-allowed"
          style={{ 
            minWidth: `var(--action-button-width, 140px)`, 
            height: `var(--action-button-height, 48px)`,
            paddingLeft: `var(--action-button-padding-x, 24px)`,
            paddingRight: `var(--action-button-padding-x, 24px)`,
            paddingTop: `var(--action-button-padding-y, 12px)`,
            paddingBottom: `var(--action-button-padding-y, 12px)`,
            fontSize: `var(--action-button-text, 16px)`
          }}
        >
          FOLD
        </button>
        {showCheck ? (
          <button
            onClick={() => onAction("CHECK", 0)}
            disabled={!isMyTurn}
            className="rounded-lg bg-blue-600 font-bold text-white shadow-lg hover:bg-blue-700 transition-colors flex-1 whitespace-nowrap disabled:opacity-50 disabled:cursor-not-allowed"
            style={{ 
              minWidth: `var(--action-button-width, 140px)`, 
              height: `var(--action-button-height, 48px)`,
              paddingLeft: `var(--action-button-padding-x, 24px)`,
              paddingRight: `var(--action-button-padding-x, 24px)`,
              paddingTop: `var(--action-button-padding-y, 12px)`,
              paddingBottom: `var(--action-button-padding-y, 12px)`,
              fontSize: `var(--action-button-text, 16px)`
            }}
          >
            CHECK
          </button>
        ) : (
          <button
            onClick={() => onAction(isAllInOnly ? "ALL_IN" : "CALL", callAmount)}
            disabled={!isMyTurn}
            className="rounded-lg bg-blue-600 font-bold text-white shadow-lg hover:bg-blue-700 transition-colors flex-1 whitespace-nowrap disabled:opacity-50 disabled:cursor-not-allowed"
            style={{ 
              minWidth: `var(--action-button-width, 140px)`, 
              height: `var(--action-button-height, 48px)`,
              paddingLeft: `var(--action-button-padding-x, 24px)`,
              paddingRight: `var(--action-button-padding-x, 24px)`,
              paddingTop: `var(--action-button-padding-y, 12px)`,
              paddingBottom: `var(--action-button-padding-y, 12px)`,
              fontSize: `var(--action-button-text, 16px)`
            }}
          >
            {isAllInOnly ? `ALL IN ${myChips}` : `CALL ${callAmount}`}
          </button>
        )}
        <button
          onClick={() => {
            // When user chose ALL IN preset, send explicit ALL_IN so server uses full stack
            const isAllInBet = actionAmount === myContribution + myChips && myChips > 0;
            if (isAllInBet) {
              onAction("ALL_IN", myChips);
              return;
            }
            // Server expects additional chips to put in, not total; BET/RAISE displays total
            const amountToSend = (actionLabel === "BET" || actionLabel === "RAISE") ? actionAmount - myContribution : actionAmount;
            onAction(actionLabel, amountToSend);
          }}
          disabled={!isMyTurn}
          className="rounded-lg bg-emerald-600 font-bold text-white shadow-lg hover:bg-emerald-700 transition-colors flex-1 whitespace-nowrap disabled:opacity-50 disabled:cursor-not-allowed"
          style={{ 
            minWidth: `var(--action-button-width, 140px)`, 
            height: `var(--action-button-height, 48px)`,
            paddingLeft: `var(--action-button-padding-x, 24px)`,
            paddingRight: `var(--action-button-padding-x, 24px)`,
            paddingTop: `var(--action-button-padding-y, 12px)`,
            paddingBottom: `var(--action-button-padding-y, 12px)`,
            fontSize: `var(--action-button-text, 16px)`
          }}
        >
          {actionLabel} {actionAmount}
        </button>
      </div>

      {/* Preset Buttons and Input - Right justified, input to the right */}
      <div className="flex items-center gap-3" style={{ width: containerWidth }}>
        {/* Left side: Preset buttons in 2 columns */}
        <div className="flex flex-col gap-2 flex-1">
          {/* Top row: 1/2 and POT */}
          <div className="flex items-center gap-2">
            <button
              onClick={() => handlePreset('half')}
              disabled={presetHalfDisabled}
              className="rounded bg-slate-700 font-medium text-slate-200 hover:bg-slate-600 transition-colors flex-1 disabled:opacity-50 disabled:cursor-not-allowed"
              style={{
                paddingLeft: `var(--preset-button-padding-x, 12px)`,
                paddingRight: `var(--preset-button-padding-x, 12px)`,
                paddingTop: `var(--preset-button-padding-y, 8px)`,
                paddingBottom: `var(--preset-button-padding-y, 8px)`,
                fontSize: `var(--preset-button-text, 14px)`,
                height: `var(--preset-button-height, auto)`
              }}
            >
              1/2
            </button>
            <button
              onClick={() => handlePreset('pot')}
              disabled={presetPotDisabled}
              className="rounded bg-slate-700 font-medium text-slate-200 hover:bg-slate-600 transition-colors flex-1 disabled:opacity-50 disabled:cursor-not-allowed"
              style={{
                paddingLeft: `var(--preset-button-padding-x, 12px)`,
                paddingRight: `var(--preset-button-padding-x, 12px)`,
                paddingTop: `var(--preset-button-padding-y, 8px)`,
                paddingBottom: `var(--preset-button-padding-y, 8px)`,
                fontSize: `var(--preset-button-text, 14px)`,
                height: `var(--preset-button-height, auto)`
              }}
            >
              POT
            </button>
          </div>
          {/* Bottom row: 2/3 and ALL IN */}
          <div className="flex items-center gap-2">
            <button
              onClick={() => handlePreset('twothirds')}
              disabled={presetTwoThirdsDisabled}
              className="rounded bg-slate-700 font-medium text-slate-200 hover:bg-slate-600 transition-colors flex-1 disabled:opacity-50 disabled:cursor-not-allowed"
              style={{
                paddingLeft: `var(--preset-button-padding-x, 12px)`,
                paddingRight: `var(--preset-button-padding-x, 12px)`,
                paddingTop: `var(--preset-button-padding-y, 8px)`,
                paddingBottom: `var(--preset-button-padding-y, 8px)`,
                fontSize: `var(--preset-button-text, 14px)`,
                height: `var(--preset-button-height, auto)`
              }}
            >
              2/3
            </button>
            <button
              onClick={() => handlePreset('allin')}
              disabled={!isMyTurn}
              className="rounded bg-red-700 font-medium text-white hover:bg-red-600 transition-colors flex-1 disabled:opacity-50 disabled:cursor-not-allowed"
              style={{
                paddingLeft: `var(--preset-button-padding-x, 12px)`,
                paddingRight: `var(--preset-button-padding-x, 12px)`,
                paddingTop: `var(--preset-button-padding-y, 8px)`,
                paddingBottom: `var(--preset-button-padding-y, 8px)`,
                fontSize: `var(--allin-button-text, var(--preset-button-text, 14px))`,
                height: `var(--preset-button-height, auto)`
              }}
            >
              ALL IN
            </button>
          </div>
        </div>

        {/* Right side: Amount Input with +/- Controls - same height as both preset rows combined */}
        <div className="flex items-center gap-2">
            <button
              onClick={() =>
                setRaiseAmount((a) => Math.max(inputMin, a - stepSize))
              }
              disabled={!isMyTurn || raiseAmount <= inputMin}
              className="flex items-center justify-center rounded-full bg-slate-700 font-bold text-white hover:bg-slate-600 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
              style={{
                width: `var(--input-button-size, 48px)`,
                height: `var(--amount-input-height, 68px)`,
                fontSize: `var(--input-button-text, 20px)`
              }}
            >
              −
            </button>
          <input
            type="number"
            disabled={!isMyTurn}
            className="rounded-lg border-2 border-slate-600 bg-slate-800 text-center font-bold text-white focus:border-emerald-500 focus:outline-none no-spinner disabled:opacity-50 disabled:cursor-not-allowed"
            style={{ 
              width: `var(--amount-input-width, 128px)`,
              height: `var(--amount-input-height, 68px)`,
              paddingLeft: 'var(--amount-input-padding, 16px)',
              paddingRight: 'var(--amount-input-padding, 16px)',
              fontSize: `var(--amount-input-text, 18px)`,
              WebkitAppearance: 'none',
              MozAppearance: 'textfield',
              appearance: 'textfield'
            }}
            value={raiseAmount}
            onChange={(e) => {
              const val = Math.max(
                inputMin,
                Math.min(inputMax, Number(e.target.value) || inputMin)
              );
              setRaiseAmount(val);
            }}
            onWheel={(e) => e.currentTarget.blur()}
            min={inputMin}
            max={inputMax}
          />
          <button
            onClick={() =>
              setRaiseAmount((a) => Math.min(inputMax, a + stepSize))
            }
            disabled={!isMyTurn || raiseAmount >= inputMax}
            className="flex items-center justify-center rounded-full bg-slate-700 font-bold text-white hover:bg-slate-600 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            style={{
              width: `var(--input-button-size, 48px)`,
              height: `var(--amount-input-height, 68px)`,
              fontSize: `var(--input-button-text, 20px)`
            }}
          >
            +
          </button>
        </div>
      </div>
    </div>
  );
}
