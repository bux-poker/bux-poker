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
    setRaiseAmount((a) => {
      const clamped = Math.max(inputMin, Math.min(inputMax, a));
      return clamped === a ? a : clamped;
    });
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
  const [windowSize, setWindowSize] = useState({
    width: typeof window !== "undefined" ? window.innerWidth : 1400,
    height: typeof window !== "undefined" ? window.innerHeight : 900,
  });
  
  // Listen for window resize to update CSS variable calculations
  useEffect(() => {
    const handleResize = () => {
      setWindowSize({ width: window.innerWidth, height: window.innerHeight });
    };
    window.addEventListener("resize", handleResize);
    return () => window.removeEventListener("resize", handleResize);
  }, []);
  
  // Calculate button width - using CSS variables directly in styles, but need container width
  // Calculate container width using CSS variables (trigger recalculation on resize)
  const containerWidth = typeof window !== "undefined"
    ? `calc(${getComputedStyle(document.documentElement).getPropertyValue("--action-button-width") || "140px"} * 3 + 0.75rem * 2)`
    : "calc(140px * 3 + 0.75rem * 2)";
  // Use windowSize to force recalculation on rotate / resize
  void windowSize.width;
  void windowSize.height;

  // Determine which buttons to show
  // You can CHECK when your contribution equals the current bet (no bet to call)
  // Special case: Big blind can check in pre-flop when no one has raised (currentBet === bigBlind)
  // Otherwise, you must CALL the difference
  const showCheck = currentBet === myContribution || (isPreflop && isBigBlind && currentBet === bigBlind && !hasRaises);
  const actionLabel = isPreflop && currentBet === 0 ? 'RAISE' : (currentBet > 0 ? 'RAISE' : 'BET');
  // RAISE button shows total bet amount to raise TO (currentBet + minimumRaise)
  const actionAmount = raiseAmount;

  const btnStyle = {
    minWidth: `var(--action-button-width, 140px)`,
    height: `var(--action-button-height, 48px)`,
    paddingLeft: `var(--action-button-padding-x, 24px)`,
    paddingRight: `var(--action-button-padding-x, 24px)`,
    fontSize: `var(--action-button-text, 16px)`,
  } as const;

  const presetStyle = {
    paddingLeft: `var(--preset-button-padding-x, 12px)`,
    paddingRight: `var(--preset-button-padding-x, 12px)`,
    paddingTop: `var(--preset-button-padding-y, 6px)`,
    paddingBottom: `var(--preset-button-padding-y, 6px)`,
    fontSize: `var(--preset-button-text, 13px)`,
    height: `var(--preset-button-height, auto)`,
  } as const;

  return (
    <div className="flex max-h-full flex-col items-end justify-center gap-1 sm:gap-2">
      <div className="flex items-center gap-1.5 sm:gap-2" style={{ width: containerWidth }}>
        <button
          onClick={handleFold}
          disabled={!isMyTurn}
          className="bux-btn-fold flex-1 whitespace-nowrap rounded-xl transition disabled:cursor-not-allowed disabled:opacity-45"
          style={btnStyle}
        >
          FOLD
        </button>
        {showCheck ? (
          <button
            onClick={() => onAction("CHECK", 0)}
            disabled={!isMyTurn}
            className="bux-btn-call flex-1 whitespace-nowrap rounded-xl transition disabled:cursor-not-allowed disabled:opacity-45"
            style={btnStyle}
          >
            CHECK
          </button>
        ) : (
          <button
            onClick={() => onAction(isAllInOnly ? "ALL_IN" : "CALL", callAmount)}
            disabled={!isMyTurn}
            className="bux-btn-call flex-1 whitespace-nowrap rounded-xl transition disabled:cursor-not-allowed disabled:opacity-45"
            style={btnStyle}
          >
            {isAllInOnly ? `ALL IN ${myChips}` : `CALL ${callAmount}`}
          </button>
        )}
        <button
          onClick={() => {
            const isAllInBet = actionAmount === myContribution + myChips && myChips > 0;
            if (isAllInBet) {
              onAction("ALL_IN", myChips);
              return;
            }
            const amountToSend =
              actionLabel === "BET" || actionLabel === "RAISE"
                ? actionAmount - myContribution
                : actionAmount;
            onAction(actionLabel, amountToSend);
          }}
          disabled={!isMyTurn}
          className="bux-btn-raise flex-1 whitespace-nowrap rounded-xl transition disabled:cursor-not-allowed disabled:opacity-45"
          style={btnStyle}
        >
          {actionLabel} {actionAmount}
        </button>
      </div>

      <div className="flex items-center gap-1.5 sm:gap-2" style={{ width: containerWidth }}>
        <div className="flex flex-1 flex-col gap-1">
          <div className="flex items-center gap-1 sm:gap-1.5">
            <button
              onClick={() => handlePreset("half")}
              disabled={presetHalfDisabled}
              className="bux-preset flex-1 rounded-lg transition disabled:cursor-not-allowed disabled:opacity-40"
              style={presetStyle}
            >
              1/2
            </button>
            <button
              onClick={() => handlePreset("pot")}
              disabled={presetPotDisabled}
              className="bux-preset flex-1 rounded-lg transition disabled:cursor-not-allowed disabled:opacity-40"
              style={presetStyle}
            >
              POT
            </button>
          </div>
          <div className="flex items-center gap-1 sm:gap-1.5">
            <button
              onClick={() => handlePreset("twothirds")}
              disabled={presetTwoThirdsDisabled}
              className="bux-preset flex-1 rounded-lg transition disabled:cursor-not-allowed disabled:opacity-40"
              style={presetStyle}
            >
              2/3
            </button>
            <button
              onClick={() => handlePreset("allin")}
              disabled={!isMyTurn}
              className="bux-preset-danger flex-1 rounded-lg transition disabled:cursor-not-allowed disabled:opacity-40"
              style={{
                ...presetStyle,
                fontSize: `var(--allin-button-text, var(--preset-button-text, 13px))`,
              }}
            >
              ALL IN
            </button>
          </div>
        </div>

        <div className="flex items-center gap-1.5">
          <button
            onClick={() => setRaiseAmount((a) => Math.max(inputMin, a - stepSize))}
            disabled={!isMyTurn || raiseAmount <= inputMin}
            className="bux-preset flex items-center justify-center rounded-full transition disabled:cursor-not-allowed disabled:opacity-40"
            style={{
              width: `var(--input-button-size, 40px)`,
              height: `var(--amount-input-height, 56px)`,
              fontSize: `var(--input-button-text, 18px)`,
            }}
          >
            −
          </button>
          <input
            type="number"
            disabled={!isMyTurn}
            className="no-spinner rounded-xl border text-center font-bold text-white focus:outline-none disabled:cursor-not-allowed disabled:opacity-45"
            style={{
              width: `var(--amount-input-width, 112px)`,
              height: `var(--amount-input-height, 56px)`,
              paddingLeft: "var(--amount-input-padding, 12px)",
              paddingRight: "var(--amount-input-padding, 12px)",
              fontSize: `var(--amount-input-text, 17px)`,
              background: "color-mix(in srgb, var(--bux-panel) 92%, transparent)",
              borderColor: "var(--bux-panel-border)",
              WebkitAppearance: "none",
              MozAppearance: "textfield",
              appearance: "textfield",
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
            onClick={() => setRaiseAmount((a) => Math.min(inputMax, a + stepSize))}
            disabled={!isMyTurn || raiseAmount >= inputMax}
            className="bux-preset flex items-center justify-center rounded-full transition disabled:cursor-not-allowed disabled:opacity-40"
            style={{
              width: `var(--input-button-size, 40px)`,
              height: `var(--amount-input-height, 56px)`,
              fontSize: `var(--input-button-text, 18px)`,
            }}
          >
            +
          </button>
        </div>
      </div>
    </div>
  );
}
