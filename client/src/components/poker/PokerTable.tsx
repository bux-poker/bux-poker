import React, { useState, useEffect, useRef } from 'react';
import { motion } from 'framer-motion';
import { Card } from '@shared/types/poker';
import { useIsMobile } from '../../hooks/useIsMobile';

// Chip component with color based on value
function BetChip({ value }: { value: number }) {
  // Determine chip color based on exact value
  const getChipColor = (val: number): string => {
    switch (val) {
      case 10: return '#FFC0CB'; // Pink for 10
      case 20: return '#808080'; // Gray for 20
      case 50: return '#FFA500'; // Orange for 50
      case 100: return '#FFFF00'; // Yellow for 100
      case 200: return '#00FF00'; // Green for 200
      case 500: return '#0000FF'; // Blue for 500
      case 1000: return '#FF0000'; // Red for 1000
      case 5000: return '#8B00FF'; // Purple for 5000
      case 10000: return '#FFD700'; // Gold for 10000
      default:
        // For values not in the list, use the highest matching tier
        if (val >= 10000) return '#FFD700';
        if (val >= 5000) return '#8B00FF';
        if (val >= 1000) return '#FF0000';
        if (val >= 500) return '#0000FF';
        if (val >= 200) return '#00FF00';
        if (val >= 100) return '#FFFF00';
        if (val >= 50) return '#FFA500';
        if (val >= 20) return '#808080';
        return '#FFC0CB';
    }
  };

  const chipColor = getChipColor(value);

  return (
    <div className="flex items-center" style={{ gap: 'var(--hole-card-gap, 4px)' }}>
      <div
        className="rounded-full shadow-lg flex items-center justify-center relative overflow-hidden"
        style={{ 
          backgroundColor: chipColor,
          width: 'var(--bet-chip-size, 24px)',
          height: 'var(--bet-chip-size, 24px)'
        }}
      >
        <img
          src="/poker-chip.svg"
          alt="chip"
          className="w-full h-full object-contain"
          style={{ filter: 'brightness(0) invert(1)' }}
        />
      </div>
      <span 
        className="font-semibold text-white drop-shadow-lg"
        style={{ fontSize: 'var(--bet-chip-text-size, 13px)' }}
      >
        {value.toLocaleString()}
      </span>
    </div>
  );
}

// Suit symbols and red suits for text cards
const SUIT_SYMBOLS: Record<string, string> = {
  SPADES: "♠",
  HEARTS: "♥",
  DIAMONDS: "♦",
  CLUBS: "♣",
};
const RED_SUITS = new Set(["HEARTS", "DIAMONDS"]);

// Format hand category for display (e.g. FULL_HOUSE -> "Full House")
function formatHandCategory(category: string): string {
  if (!category) return "";
  const formatted = category
    .split("_")
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase())
    .join(" ");
  return formatted;
}

// Simple poker card: on mobile uses CSS (rank above suit); on desktop uses PNG
function PokerCardImage({
  card,
  width,
  height,
  className = "",
  faceDown = false,
  useTextCard = false,
}: {
  card: Card;
  width: number;
  height: number;
  className?: string;
  faceDown?: boolean;
  useTextCard?: boolean;
}) {
  if (faceDown) {
    return (
      <div
        className={`${className} bg-blue-800 border-2 border-white rounded-lg relative overflow-hidden`}
        style={{ width, height }}
      >
        <div className="absolute inset-0 opacity-20">
          <div
            className="absolute inset-0"
            style={{
              backgroundImage:
                "repeating-linear-gradient(45deg, transparent, transparent 6px, white 6px, white 7px), repeating-linear-gradient(-45deg, transparent, transparent 6px, white 6px, white 7px)",
            }}
          />
        </div>
      </div>
    );
  }

  // Mobile: rank and suit as large text (no PNG)
  if (useTextCard) {
    const suitSymbol = SUIT_SYMBOLS[card.suit] ?? card.suit.charAt(0);
    const isRed = RED_SUITS.has(card.suit);
    const rankSize = Math.max(10, Math.floor(height * 0.42));
    const suitSize = Math.max(10, Math.floor(height * 0.38));
    return (
      <div
        className={`${className} flex flex-col items-center justify-center rounded-lg border-2 border-slate-300 bg-white shadow-md`}
        style={{ width, height, minWidth: width, minHeight: height }}
      >
        <span
          className="font-bold leading-none"
          style={{ fontSize: rankSize, color: "#1a1a1a" }}
        >
          {card.rank}
        </span>
        <span
          className="leading-none"
          style={{
            fontSize: suitSize,
            color: isRed ? "#b91c1c" : "#1a1a1a",
          }}
        >
          {suitSymbol}
        </span>
      </div>
    );
  }

  // Desktop: PNG image
  const getCardImage = (card: Card): string => {
    const suitMap: Record<string, string> = {
      SPADES: "S",
      HEARTS: "H",
      DIAMONDS: "D",
      CLUBS: "C",
    };
    const suit = suitMap[card.suit] || card.suit.charAt(0);
    const rank = card.rank === "10" ? "10" : card.rank;
    return `${rank}${suit}.png`;
  };
  return (
    <motion.img
      src={`/cards/${getCardImage(card)}`}
      alt={`${card.rank}${card.suit}`}
      className={className}
      style={{
        width: width - 2,
        height,
        objectFit: "contain",
        padding: 0,
        margin: 0,
        borderRadius: "1px",
      }}
      initial={{ opacity: 0, scale: 0.9 }}
      animate={{ opacity: 1, scale: 1 }}
      transition={{ duration: 0.15, ease: "easeOut" }}
      onError={(e: React.SyntheticEvent<HTMLImageElement, Event>) => {
        console.error("Card image failed to load:", getCardImage(card));
        const target = e.target as HTMLImageElement;
        target.style.display = "none";
      }}
    />
  );
}

interface PokerTableProps {
  gameId: string;
  turnTimer?: { userId: string; expiresAt: number; duration: number } | null;
  players: Array<{
    id: string;
    name: string;
    chips: number;
    seatNumber: number;
    holeCards?: Card[];
    isActive?: boolean;
    isDealer?: boolean;
    isSmallBlind?: boolean;
    isBigBlind?: boolean;
    avatarUrl?: string;
    userId?: string;
    contribution?: number;
    status?: string;
    lastAction?: string;
    lastActionSeq?: number;
  }>;
  communityCards: Card[];
  pot: number;
  tournamentCountdown?: { startTime: string; seconds: number } | null;
  currentBet: number;
  currentPlayer?: string;
  smallBlind?: number;
  bigBlind?: number;
  myUserId?: string;
  /** When true, all seat hole cards render face down (e.g. for table-test layout). */
  forceSeatCardsFaceDown?: boolean;
  /** Top-left corner: blinds (e.g. "50/100") and next blind timer (e.g. "2:15 mins"). Shown inside play area when provided. */
  topLeftBlinds?: string;
  topLeftTimer?: string;
  /** Top-right corner: position (e.g. "13th") and players count (e.g. "28/45"). Shown inside play area when provided. */
  topRightPosition?: string;
  topRightPlayers?: string;
  showdownActive?: boolean;
  showdownResults?: any;
  /** When provided, show a tournament lobby icon button in the top-left with blind stats. */
  onTournamentLobbyClick?: () => void;
}

// Player positions around the table (10-seat layout, evenly spaced)
const PLAYER_POSITIONS = [
  { angle: 162, label: 'bottom-left' }, // Seat 1
  { angle: 126, label: 'bottom-left' }, // Seat 2
  { angle: 90, label: 'left' }, // Seat 3
  { angle: 54, label: 'top-left' }, // Seat 4
  { angle: 18, label: 'top-left' }, // Seat 5
  { angle: -18, label: 'top-right' }, // Seat 6
  { angle: -54, label: 'top-right' }, // Seat 7
  { angle: -90, label: 'right' }, // Seat 8
  { angle: -126, label: 'bottom-right' }, // Seat 9
  { angle: -162, label: 'bottom-right' }, // Seat 10
];

export function PokerTable({
  gameId,
  turnTimer,
  players,
  communityCards,
  pot,
  currentBet,
  currentPlayer,
  smallBlind = 10,
  bigBlind = 20,
  myUserId,
  forceSeatCardsFaceDown = false,
  topLeftBlinds,
  topLeftTimer,
  topRightPosition,
  topRightPlayers,
  showdownActive = false,
  showdownResults,
  tournamentCountdown,
  onTournamentLobbyClick,
}: PokerTableProps) {
  // Create array with 10 seats (empty seats if needed)
  const allSeats = Array.from({ length: 10 }, (_, idx) => {
    const seatNumber = idx + 1;
    return players.find(p => p.seatNumber === seatNumber) || null;
  });
  
  // Get player's own hole cards (face up) - shown separately at bottom
  const myPlayer = myUserId ? players.find(p => p.id === myUserId || p.userId === myUserId) : null;
  const myHoleCards = myPlayer?.holeCards || [];
  
  // Timer state for countdown
  const [currentTime, setCurrentTime] = useState(Date.now());
  
  // Window size state to trigger re-renders when CSS variables change
  const [windowSize, setWindowSize] = useState({ width: typeof window !== 'undefined' ? window.innerWidth : 1400 });
  const isMobile = useIsMobile();
  
  // Track visible action overlays: { playerId: { action: string, timestamp: number } }
  const [actionOverlays, setActionOverlays] = useState<Record<string, { action: string; timestamp: number }>>({});
  const lastSeenActionKeyRef = useRef<Record<string, string>>({});
  const ACTION_FADE_MS = 2000;
  const isPermanentAction = (action: string) => {
    const normalized = action.toUpperCase();
    return normalized === 'FOLD' || normalized === 'ALL_IN' || normalized === 'ALLIN';
  };
  
  // Helper function to get action text and color
  const getActionInfo = (action: string): { text: string; color: string } => {
    switch (action.toUpperCase()) {
      case 'FOLD':
        return { text: 'FOLD', color: '#dc2626' }; // red-600
      case 'CHECK':
        return { text: 'CHECK', color: '#2563eb' }; // blue-600
      case 'CALL':
        return { text: 'CALL', color: '#2563eb' }; // blue-600
      case 'BET':
        return { text: 'BET', color: '#059669' }; // emerald-600
      case 'RAISE':
        return { text: 'RAISE', color: '#059669' }; // emerald-600
      case 'ALL_IN':
      case 'ALLIN':
        return { text: 'ALL IN', color: '#059669' }; // emerald-600 (per spec)
      default:
        return { text: action, color: '#64748b' }; // slate-500
    }
  };
  
  // Track player actions and show overlays
  useEffect(() => {
    setActionOverlays((prev) => {
      const now = Date.now();
      const newOverlays: Record<string, { action: string; timestamp: number }> = { ...prev };
      const nextSeenKeys: Record<string, string> = {};

      players.forEach((player) => {
        const playerId = player.id || player.userId || '';
        const lastAction = player.lastAction || '';
        // Dedupe key must represent one real action event, not state re-renders.
        const actionKey = lastAction ? `${player.lastActionSeq || 0}` : '';
        nextSeenKeys[playerId] = actionKey;
        if (lastAction && actionKey && actionKey !== lastSeenActionKeyRef.current[playerId]) {
          newOverlays[playerId] = {
            action: lastAction,
            timestamp: now,
          };
        }
      });

      lastSeenActionKeyRef.current = nextSeenKeys;
      return newOverlays;
    });
  }, [players]);
  
  // Clean up old overlays after fade duration
  useEffect(() => {
    const interval = setInterval(() => {
      const now = Date.now();
      setActionOverlays(prev => {
        const updated = { ...prev };
        Object.keys(updated).forEach(playerId => {
          const overlay = updated[playerId];
          if (!isPermanentAction(overlay.action) && now - overlay.timestamp >= ACTION_FADE_MS) {
            delete updated[playerId];
          }
        });
        return updated;
      });
    }, 100);
    
    return () => clearInterval(interval);
  }, []);

  // Reset overlays at clear new-hand boundary so stale permanent actions do not carry over.
  useEffect(() => {
    const isLikelyNewHand =
      !showdownActive &&
      currentBet === 0 &&
      (communityCards?.length || 0) === 0 &&
      players.every((p) => (p.contribution || 0) === 0);
    if (isLikelyNewHand) {
      setActionOverlays({});
    }
  }, [showdownActive, currentBet, communityCards, players]);
  
  // Update timer every second
  useEffect(() => {
    if (turnTimer) {
      const interval = setInterval(() => {
        setCurrentTime(Date.now());
      }, 100); // Update every 100ms for smooth countdown
      return () => clearInterval(interval);
    }
  }, [turnTimer]);
  
  // Listen for window resize to trigger re-render for CSS variable recalculation
  useEffect(() => {
    const handleResize = () => {
      setWindowSize({ width: window.innerWidth });
    };
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);

  return (
    <div 
      className="relative flex h-full w-full items-center justify-center bg-gradient-to-br from-slate-950 to-slate-900 overflow-hidden"
      style={{
        paddingTop: 'var(--table-padding-top, 56px)',
        paddingRight: 'var(--table-padding, 32px)',
        paddingBottom: 'var(--table-padding, 32px)',
        paddingLeft: 'var(--table-padding, 32px)',
      }}
    >
      {/* Top-left corner: tournament lobby button + blinds + timer (inside play area) - bigger on desktop */}
      {(onTournamentLobbyClick != null || topLeftBlinds != null || topLeftTimer != null) && (() => {
        const isDesktop = windowSize.width >= 1000;
        const cornerLabelSize = isDesktop ? '12px' : '9px';
        const cornerValueSize = isDesktop ? '16px' : '11px';
        const cornerPadding = isDesktop ? '8px 10px' : '4px 6px';
        return (
        <div
          className="absolute left-0 top-0 z-10 flex items-start gap-1"
          style={{ marginLeft: '6px', marginTop: '6px' }}
        >
          {(topLeftBlinds != null || topLeftTimer != null) && (
            <div
              className="rounded border border-slate-600/60 bg-slate-900/90"
              style={{ padding: cornerPadding }}
            >
              <div className="flex flex-col gap-1 leading-snug">
                {topLeftBlinds != null && (
                  <div className="flex flex-col">
                    <span className="font-semibold uppercase tracking-wide text-slate-400" style={{ fontSize: cornerLabelSize }}>
                      BLINDS
                    </span>
                    <span className="font-bold text-white" style={{ fontSize: cornerValueSize }}>
                      {topLeftBlinds}
                    </span>
                  </div>
                )}
                {topLeftTimer != null && (
                  <div className="flex flex-col">
                    <span className="font-semibold uppercase tracking-wide text-slate-400" style={{ fontSize: cornerLabelSize }}>
                      NEXT BLIND
                    </span>
                    <span className="font-bold text-white" style={{ fontSize: cornerValueSize }}>
                      {topLeftTimer}
                    </span>
                  </div>
                )}
              </div>
            </div>
          )}
          {onTournamentLobbyClick != null && (
            <button
              type="button"
              onClick={onTournamentLobbyClick}
              className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded border border-slate-600/60 bg-slate-900/90 text-slate-300 transition-colors hover:bg-slate-800 hover:text-white sm:h-10 sm:w-10"
              aria-label="Tournament info"
              title="Tournament info"
            >
              <svg className="h-5 w-5 sm:h-5 sm:w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <circle cx="12" cy="12" r="10" strokeWidth={2} />
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 16v-4M12 8h.01" />
              </svg>
            </button>
          )}
        </div>
        );
      })()}

      {/* Top-right corner: position + players (inside play area) - bigger on desktop */}
      {(topRightPosition != null || topRightPlayers != null) && (() => {
        const isDesktop = windowSize.width >= 1000;
        const cornerLabelSize = isDesktop ? '12px' : '9px';
        const cornerValueSize = isDesktop ? '16px' : '11px';
        const cornerPadding = isDesktop ? '8px 10px' : '4px 6px';
        return (
        <div
          className="absolute right-0 top-0 z-10 rounded border border-slate-600/60 bg-slate-900/90"
          style={{ marginRight: '6px', marginTop: '6px', padding: cornerPadding }}
        >
          <div className="flex flex-col items-end gap-1 leading-snug">
            {topRightPlayers != null && (
              <div className="flex flex-col text-right">
                <span className="font-semibold uppercase tracking-wide text-slate-400" style={{ fontSize: cornerLabelSize }}>
                  PLAYERS
                </span>
                <span className="font-bold text-white" style={{ fontSize: cornerValueSize }}>
                  {topRightPlayers}
                </span>
              </div>
            )}
            {topRightPosition != null && (
              <div className="flex flex-col text-right">
                <span className="font-semibold uppercase tracking-wide text-slate-400" style={{ fontSize: cornerLabelSize }}>
                  POSITION
                </span>
                <span className="font-bold text-white" style={{ fontSize: cornerValueSize }}>
                  {topRightPosition}
                </span>
              </div>
            )}
          </div>
        </div>
        );
      })()}

      {/* Oval/Circular Table */}
      <div 
        className="relative h-full w-full max-h-[calc(85vh-4rem)] max-w-[calc(90vw-4rem)] rounded-[50%] border-8 border-amber-600/40 bg-gradient-to-br from-emerald-900/60 to-slate-900/80 shadow-2xl" 
        style={{ 
          aspectRatio: '3/2'
        }}
      >
        


        {/* Tournament Starting Countdown - Center of table */}
        {tournamentCountdown && tournamentCountdown.seconds > 0 && (
          <div 
            className="absolute left-1/2 top-1/2 z-20 flex flex-col items-center justify-center -translate-x-1/2 -translate-y-1/2"
          >
            <div 
              className="bg-slate-900/95 rounded-lg border-yellow-500 shadow-2xl text-center backdrop-blur-sm"
              style={{
                paddingLeft: 'var(--countdown-padding-x, 16px)',
                paddingRight: 'var(--countdown-padding-x, 16px)',
                paddingTop: 'var(--countdown-padding-y, 12px)',
                paddingBottom: 'var(--countdown-padding-y, 12px)',
                borderWidth: 'var(--countdown-border-width, 2px)'
              }}
            >
              <p 
                className="font-semibold text-yellow-400 mb-1"
                style={{ fontSize: 'var(--countdown-title-size, 15px)' }}
              >
                Game Starting Soon
              </p>
              <div 
                className="font-bold text-emerald-400"
                style={{ fontSize: 'var(--countdown-time-size, 30px)' }}
              >
                {Math.floor(tournamentCountdown.seconds / 60)}:{(tournamentCountdown.seconds % 60).toString().padStart(2, '0')}
              </div>
            </div>
          </div>
        )}

        {/* Center: when showdown with winners show who won + hand; else total pot + community cards */}
        <div 
          className="absolute left-1/2 top-1/2 z-10 flex -translate-x-1/2 -translate-y-1/2 flex-col items-center"
          style={{ gap: 'var(--community-card-gap, 8px)' }}
        >
          {/* Winner message: show for both real showdown and fold wins (fold wins have no handCategory, no card reveal) */}
          {showdownResults?.winners?.length > 0 ? (
            <div className="flex flex-col items-center gap-1 rounded-lg border border-amber-500/60 bg-slate-900/95 px-3 py-2 text-center shadow-xl">
              {showdownResults.winners.length === 1 ? (
                <span className="font-bold text-amber-300" style={{ fontSize: 'var(--bet-chip-text-size, 13px)' }}>
                  {showdownResults.winners[0].handCategory
                    ? `${showdownResults.winners[0].name} wins with ${formatHandCategory(showdownResults.winners[0].handCategory)}`
                    : `${showdownResults.winners[0].name} wins ${(showdownResults.winners[0].potWon ?? 0).toLocaleString()} chips`}
                </span>
              ) : (
                <span className="font-bold text-amber-300" style={{ fontSize: 'var(--bet-chip-text-size, 13px)' }}>
                  {showdownResults.winners[0]?.handCategory
                    ? `${showdownResults.winners.map((w: any) => w.name).join(" & ")} split with ${formatHandCategory(showdownResults.winners[0]?.handCategory)}`
                    : `${showdownResults.winners.map((w: any) => w.name).join(" & ")} split ${(showdownResults.winners[0]?.potWon ?? 0).toLocaleString()} chips`}
                </span>
              )}
            </div>
          ) : (
            /* Total pot above community cards when not showing winner */
            <div className="flex items-center gap-2">
              <span 
                className="font-semibold uppercase tracking-wide text-slate-300"
                style={{ fontSize: 'var(--bet-chip-text-size, 13px)' }}
              >
                TOTAL POT :
              </span>
              <BetChip value={pot} />
            </div>
          )}
          {communityCards.length > 0 && (
          <div 
            className="flex"
            style={{ gap: 'var(--community-card-gap, 8px)' }}
          >
            {communityCards.map((card, idx) => {
              // Read CSS variables for responsive sizing - recalculate when window size changes
              let cardWidth = typeof window !== 'undefined' 
                ? parseInt(getComputedStyle(document.documentElement).getPropertyValue('--community-card-width')) || 64
                : 64;
              let cardHeight = typeof window !== 'undefined'
                ? parseInt(getComputedStyle(document.documentElement).getPropertyValue('--community-card-height')) || 90
                : 90;
              
              // Collect all winning cards from all winners
              const allWinningCards: Card[] = [];
              if (showdownResults?.winners) {
                showdownResults.winners.forEach((w: any) => {
                  const winningCards = w.hand?.cards || [];
                  allWinningCards.push(...winningCards);
                });
              }
              
              // Check if this card is part of any winning hand
              const isWinningCard = allWinningCards.some((wc: Card) => wc.rank === card.rank && wc.suit === card.suit);
              
              // Only shrink/gray losing cards when we have winner highlight (not during reveal/flop/turn/river phases)
              const hasWinnerHighlight = showdownActive && showdownResults?.winners && showdownResults.winners.length > 0;
              const isLosingCard = hasWinnerHighlight && !isWinningCard;
              const showdownScale = isLosingCard ? 0.75 : 1; // Make losing cards 75% size
              
              // Use windowSize to trigger recalculation
              return (
                <div
                  key={`community-${idx}-${windowSize.width}`}
                  className="relative transition-all duration-500"
                  style={{
                    transform: `scale(${showdownScale})`,
                  }}
                >
                  <PokerCardImage
                    card={card}
                    width={cardWidth}
                    height={cardHeight}
                    className={`shadow-xl transition-all duration-500 ${
                      isWinningCard ? 'ring-2 ring-yellow-400' : ''
                    } ${
                      isLosingCard ? 'opacity-40 grayscale' : ''
                    }`}
                    useTextCard={isMobile}
                  />
                </div>
              );
            })}
          </div>
          )}
        </div>

        {/* Player Positions - 10 seats at table edge */}
        {allSeats.flatMap((player, seatIdx) => {
          const position = PLAYER_POSITIONS[seatIdx];
          // Calculate radius to position at table edge (use percentage of table size)
          const radiusPercent = 45; // Position at 45% from center (near edge)
          const angleRad = (position.angle * Math.PI) / 180;
          
          const isMyPlayer = player && (String(myUserId ?? "") === String(player.id ?? "") || String(myUserId ?? "") === String(player.userId ?? ""));
          const isCurrentTurn = player && (String(currentPlayer ?? "") === String(player.id ?? "") || String(currentPlayer ?? "") === String(player.userId ?? ""));
          const hasActiveTimer = turnTimer && player && (String(player.userId ?? "") === String(turnTimer.userId ?? "") || String(player.id ?? "") === String(turnTimer.userId ?? ""));
          const timerRemaining = hasActiveTimer 
            ? Math.max(0, Math.ceil((turnTimer.expiresAt - currentTime) / 1000))
            : null;
          
          // Determine card positioning relative to avatar
          // Seats 1, 2, 3, 9, 10: cards to the RIGHT of avatar (positive offset)
          // Seats 4, 5, 6, 7, 8: cards to the LEFT of avatar (negative offset)
          const cardsOnRight = [1, 2, 3, 9, 10].includes(seatIdx + 1);
          // Reduce horizontal offset on smaller screens so cards sit closer to the name/chips block
          const baseCardOffset = 80;
          const offsetScale = windowSize.width < 1000 ? 0.5 : 1; // 50% closer for all screens < 1000px
          const cardOffset = cardsOnRight ? baseCardOffset * offsetScale : -baseCardOffset * offsetScale;

          // Adjust vertical position for smaller screens: seats 1-5 down, 6-10 up
          let verticalOffset = 0;
          if (windowSize.width <= 900) {
            verticalOffset = (seatIdx + 1) <= 5 ? 6 : -22;
          } else if (windowSize.width >= 901 && windowSize.width <= 1000) {
            const seatNumber = seatIdx + 1;
            if (seatNumber === 1 || seatNumber === 5) {
              // Seats 1 and 5: down 5px + 8px = 13px
              verticalOffset = 13;
            } else if (seatNumber === 6 || seatNumber === 10) {
              // Seats 6 and 10: up 20px + 8px = 28px
              verticalOffset = -28;
            } else if (seatNumber <= 5) {
              // Other seats 2-4: down 5px
              verticalOffset = 5;
            } else {
              // Other seats 7-9: up 20px
              verticalOffset = -20;
            }
          }
          
          // Seats 1, 2, 3, 9, 10: move left 20px; seats 4, 5, 6, 7, 8: move right 20px
          const seatNumber = seatIdx + 1;
          const baseHorizontalOffset = [1, 2, 3, 9, 10].includes(seatNumber) ? -20 : 20;
          // Additional horizontal tweak for smaller screens
          const smallScreenOffset = windowSize.width <= 900
            ? ((seatIdx === 0 || seatIdx === 9) ? -12 : ((seatIdx === 4 || seatIdx === 5) ? 12 : 0))
            : 0;
          const horizontalOffset = baseHorizontalOffset + smallScreenOffset;

          const elements = [
            <div
              key={`player-${player?.id || `seat-${seatIdx + 1}`}`}
              className="absolute z-[60]"
              style={{
                left: `calc(50% + ${Math.cos(angleRad) * radiusPercent}% + ${horizontalOffset}px)`,
                top: `calc(50% + ${Math.sin(angleRad) * radiusPercent}% + ${verticalOffset}px)`,
                transform: 'translate(-50%, -50%)',
              }}
            >
              <div 
                className="flex flex-col items-center"
                style={{
                  flexDirection: ((seatIdx + 1) >= 6 && (seatIdx + 1) <= 10) ? 'column-reverse' : 'column'
                }}
              >
                  {/* Player Avatar or Empty Seat */}
                  {player ? (
                    <>
                      <div className={`relative ${hasActiveTimer ? 'animate-pulse' : ''} ${hasActiveTimer ? 'ring-4 ring-yellow-400 ring-offset-2 ring-offset-slate-900 rounded-full' : (isCurrentTurn ? 'ring-4 ring-yellow-400 ring-offset-2 ring-offset-slate-900 rounded-full' : '')}`}>
                        <div 
                          className="overflow-hidden rounded-full border-2 border-slate-700 bg-slate-800 relative"
                          style={{ 
                            width: 'var(--player-avatar-size, 64px)',
                            height: 'var(--player-avatar-size, 64px)'
                          }}
                        >
                          {(() => {
                            // Use Discord avatar for real players (not test players)
                            const isTestPlayer = player.name.toLowerCase().startsWith('test player');
                            if (!isTestPlayer && player.avatarUrl) {
                              return (
                                <img 
                                  src={player.avatarUrl} 
                                  alt={player.name}
                                  className="h-full w-full object-cover"
                                  onError={(e) => {
                                    (e.target as HTMLImageElement).src = '/guest-avatar.png';
                                  }}
                                />
                              );
                            }
                            // Fallback to initial for test players or no avatar
                            return (
                              <div className="flex h-full w-full items-center justify-center bg-gradient-to-br from-blue-600 to-purple-600 text-2xl font-bold text-white">
                                {player.name.charAt(0).toUpperCase()}
                              </div>
                            );
                          })()}
                          
                          {/* Elimination overlay: after showdown, show red X over eliminated players before they disappear next hand */}
                          {showdownActive && player.status === 'ELIMINATED' && (
                            <div className="absolute inset-0 flex items-center justify-center bg-red-900/60">
                              <span className="text-red-300 font-extrabold text-3xl select-none">
                                ✕
                              </span>
                            </div>
                          )}
                          
                          {/* Seat overlay: strict exclusivity between action text and timer */}
                          {(() => {
                            const playerId = player.id || player.userId || '';
                            const overlay = actionOverlays[playerId];
                            const now = Date.now();
                            const hasOverlay = !!overlay;
                            const age = hasOverlay ? now - overlay.timestamp : 0;
                            const permanent = hasOverlay ? isPermanentAction(overlay.action) : false;
                            const actionOpacity = hasOverlay ? (permanent ? 1 : Math.max(0, 1 - (age / ACTION_FADE_MS))) : 0;

                            // First priority: action overlay when active/visible.
                            if (hasOverlay && actionOpacity > 0) {
                              const actionInfo = getActionInfo(overlay.action);
                              const risePx = permanent ? 0 : Math.min(10, age / 80);
                              return (
                                <div
                                  className="absolute inset-0 flex items-center justify-center rounded-full"
                                  style={{
                                    background: `linear-gradient(to bottom, rgba(0,0,0,0.7) 0%, rgba(0,0,0,0.6) 100%)`,
                                    opacity: actionOpacity,
                                    transition: 'opacity 0.1s ease-out',
                                    pointerEvents: 'none',
                                    zIndex: 15
                                  }}
                                >
                                  <span
                                    className="font-bold drop-shadow-lg text-center px-1"
                                    style={{
                                      color: actionInfo.color,
                                      fontSize: 'var(--player-name-size, 15px)',
                                      textShadow: '0 2px 4px rgba(0,0,0,0.8)',
                                      transform: `translateY(${-risePx}px)`,
                                      transition: permanent ? 'none' : 'transform 0.1s linear'
                                    }}
                                  >
                                    {actionInfo.text}
                                  </span>
                                </div>
                              );
                            }

                            // Second priority: timer only when there is no visible action overlay.
                            if (hasActiveTimer && timerRemaining !== null) {
                              return (
                                <div className="absolute inset-0 flex items-center justify-center bg-black/60 rounded-full" style={{ zIndex: 10 }}>
                                  <span 
                                    className="font-bold text-yellow-400 drop-shadow-lg"
                                    style={{ fontSize: 'var(--timer-text-size, 21px)' }}
                                  >
                                    {timerRemaining}
                                  </span>
                                </div>
                              );
                            }
                            return null;
                          })()}
                        </div>
                      
                        {/* Dealer Button */}
                        {player.isDealer && (
                          <div 
                            className="absolute -right-2 -top-2 flex items-center justify-center rounded-full bg-yellow-500 border-2 border-white shadow-lg"
                            style={{ 
                              width: 'var(--dealer-button-size, 32px)',
                              height: 'var(--dealer-button-size, 32px)',
                              zIndex: 60
                            }}
                          >
                            <span 
                              className="font-bold text-yellow-900"
                              style={{ fontSize: 'calc(var(--dealer-button-size, 32px) * 0.375)' }}
                            >
                              D
                            </span>
                          </div>
                        )}
                      </div>

                      {/* Player Name and Chips - In containers, no wrapping */}
                      <div 
                        className="flex flex-col items-center min-w-0"
                        style={{ 
                          maxWidth: 'var(--player-name-max-width, 120px)',
                          zIndex: 50
                        }}
                      >
                        <div className="w-full px-2 py-1 rounded bg-slate-900/80 border border-slate-700/50">
                          <div 
                            className="font-semibold text-white drop-shadow-lg truncate text-center whitespace-nowrap"
                            style={{ fontSize: 'var(--player-name-size, 15px)' }}
                          >
                            {player.name}
                          </div>
                        </div>
                        <div className="w-full px-2 py-1 rounded bg-slate-900/80 border border-slate-700/50">
                          <div 
                            className="font-medium text-emerald-300 text-center whitespace-nowrap"
                            style={{ fontSize: 'var(--player-chips-size, 13px)' }}
                          >
                            {player.chips.toLocaleString()}
                          </div>
                        </div>
                      </div>
                    </>
                  ) : (
                    /* Empty Seat Indicator */
                    <div className="relative mb-2 opacity-30">
                      <div 
                        className="overflow-hidden rounded-full border-2 border-dashed border-slate-600 bg-slate-800/50"
                        style={{ 
                          width: 'var(--player-avatar-size, 64px)',
                          height: 'var(--player-avatar-size, 64px)'
                        }}
                      >
                        <div className="flex h-full w-full items-center justify-center">
                          <span 
                            className="text-slate-500"
                            style={{ fontSize: 'var(--player-chips-size, 13px)' }}
                          >
                            {seatIdx + 1}
                          </span>
                        </div>
                      </div>
                    </div>
                  )}
              </div>
            </div>
          ];

          // Add cards as separate element if player has cards (including own player)
          // Hide table cards for folded players (they can still see their own cards in action panel)
          const isFolded = player?.status === 'FOLDED';
          if (player && player.holeCards && player.holeCards.length > 0 && !isFolded) {
            const isShowdownActive = showdownActive || false;
            // During showdown, turn all active players' cards face up (unless forced face down for test layout)
            const showFaceUp = !forceSeatCardsFaceDown && (isMyPlayer || isShowdownActive);
            
            // Get winner information for highlighting and pot won display
            const winnerInfo = showdownResults?.winners?.find((w: any) => w.playerId === player.id || w.userId === player.userId);
            const isWinner = !!winnerInfo;
            const potWon = winnerInfo?.potWon ?? 0;
            
            // Collect all winning cards from all winners (for highlighting)
            const allWinningCards: Card[] = [];
            if (showdownResults?.winners) {
              showdownResults.winners.forEach((w: any) => {
                const winningCards = w.hand?.cards || [];
                allWinningCards.push(...winningCards);
              });
            }
            
            // Check if a specific card is part of any winning hand
            const isWinningCard = (card: Card) => {
              return allWinningCards.some(wc => wc.rank === card.rank && wc.suit === card.suit);
            };
            
            // Base card dimensions from CSS variables
            const baseHoleWidth = typeof window !== 'undefined'
              ? parseInt(getComputedStyle(document.documentElement).getPropertyValue('--hole-card-width')) || 28
              : 28;
            const baseHoleHeight = typeof window !== 'undefined'
              ? parseInt(getComputedStyle(document.documentElement).getPropertyValue('--hole-card-height')) || 39
              : 39;
            
            // Double the size when cards are face up (showdown)
            const holeWidth = showFaceUp ? baseHoleWidth * 2 : baseHoleWidth;
            const holeHeight = showFaceUp ? baseHoleHeight * 2 : baseHoleHeight;
            
            elements.push(
              <div
                key={`cards-${player.id}`}
                className={`absolute flex flex-col items-center gap-1 ${isFolded ? 'opacity-50' : ''}`}
                style={{
                  left: `calc(50% + ${Math.cos(angleRad) * radiusPercent}% + ${cardOffset + horizontalOffset}px)`,
                  top: `calc(50% + ${Math.sin(angleRad) * radiusPercent}%)`,
                  transform: 'translate(-50%, -50%)',
                  transition: 'transform 0.5s ease-in-out',
                  zIndex: 70, // Higher than names/chips (50) but below dealer button (60)
                }}
              >
                {/* Bet chip and winner +pot above cards for seats 1-5 */}
                {(seatIdx + 1 <= 5) && (
                  <div className="flex flex-wrap items-center justify-center gap-1">
                    {(player.contribution ?? 0) > 0 && <BetChip value={player.contribution!} />}
                    {isWinner && potWon > 0 && (
                      <div className="flex items-center gap-0.5 rounded-md border-2 border-amber-400/80 bg-amber-500/30 px-1.5 py-0.5 shadow-md">
                        <span className="font-bold text-amber-200" style={{ fontSize: 'var(--bet-chip-text-size, 13px)' }}>+{potWon.toLocaleString()}</span>
                      </div>
                    )}
                  </div>
                )}
                <div className="flex" style={{ gap: 'var(--hole-card-gap, 4px)' }}>
                  {player.holeCards.map((card, cardIdx) => {
                    // Only shrink/gray losing cards when we have winner highlight (not during reveal phases)
                    const hasWinnerHighlight = showdownActive && showdownResults?.winners && showdownResults.winners.length > 0;
                    const cardIsWinning = hasWinnerHighlight && !isFolded && isWinningCard(card);
                    const cardIsLosing = hasWinnerHighlight && !isFolded && !isWinningCard(card);
                    const cardScale = cardIsLosing ? 0.75 : 1; // Losing cards at 75% size
                    
                    return (
                      <div 
                        key={`${player.id}-${cardIdx}-${windowSize.width}`} 
                        className="relative transition-all duration-500"
                        style={{
                          transform: `scale(${cardScale})`,
                        }}
                      >
                        <PokerCardImage
                          card={card}
                          width={holeWidth}
                          height={holeHeight}
                          className={`shadow-md transition-all duration-500 ${
                            cardIsWinning ? 'ring-2 ring-yellow-400' : ''
                          } ${
                            cardIsLosing ? 'opacity-40 grayscale' : ''
                          }`}
                          faceDown={!showFaceUp}
                          useTextCard={isMobile}
                        />
                      </div>
                    );
                  })}
                </div>
                {/* Bet chip and winner +pot below cards for seats 6-10 */}
                {(seatIdx + 1 > 5) && (
                  <div className="flex flex-wrap items-center justify-center gap-1">
                    {(player.contribution ?? 0) > 0 && <BetChip value={player.contribution!} />}
                    {isWinner && potWon > 0 && (
                      <div className="flex items-center gap-0.5 rounded-md border-2 border-amber-400/80 bg-amber-500/30 px-1.5 py-0.5 shadow-md">
                        <span className="font-bold text-amber-200" style={{ fontSize: 'var(--bet-chip-text-size, 13px)' }}>+{potWon.toLocaleString()}</span>
                      </div>
                    )}
                  </div>
                )}
              </div>
            );
          } else if (player && (player.contribution ?? 0) > 0) {
            // Bet chip for players without cards but with bets (including own player)
            elements.push(
              <div
                key={`bet-${player.id}`}
                className="absolute z-20"
                style={{
                  left: `calc(50% + ${Math.cos(angleRad) * radiusPercent}% + ${cardOffset + horizontalOffset}px)`,
                  top: `calc(50% + ${Math.sin(angleRad) * radiusPercent}% + ${seatIdx + 1 <= 5 ? -60 : 60}px)`,
                  transform: 'translate(-50%, -50%)',
                }}
              >
                <BetChip value={player.contribution ?? 0} />
              </div>
            );
          }

          return elements;
        })}
      </div>

    </div>
  );
}
