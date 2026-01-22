import React, { useState, useEffect } from 'react';
import { Card } from '@shared/types/poker';

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
        style={{ fontSize: 'var(--bet-chip-text-size, 12px)' }}
      >
        {value.toLocaleString()}
      </span>
    </div>
  );
}

// Simple poker card image component
function PokerCardImage({ 
  card, 
  width, 
  height, 
  className = '', 
  faceDown = false 
}: { 
  card: Card; 
  width: number; 
  height: number; 
  className?: string;
  faceDown?: boolean;
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
              backgroundImage: "repeating-linear-gradient(45deg, transparent, transparent 6px, white 6px, white 7px), repeating-linear-gradient(-45deg, transparent, transparent 6px, white 6px, white 7px)"
            }}
          />
        </div>
      </div>
    );
  }

  // Get card image filename - always use PNG images
  const getCardImage = (card: Card): string => {
    const suitMap: Record<string, string> = {
      "SPADES": "S", "HEARTS": "H", "DIAMONDS": "D", "CLUBS": "C"
    };
    const suit = suitMap[card.suit] || card.suit.charAt(0);
    // Handle 10 specially since it's "10" not "TEN"
    const rank = card.rank === "10" ? "10" : card.rank;
    return `${rank}${suit}.png`;
  };

      return (
        <img
          src={`/cards/${getCardImage(card)}`}
          alt={`${card.rank}${card.suit}`}
          className={className}
          style={{ 
            width: width - 2, 
            height, 
            objectFit: 'contain', 
            padding: 0, 
            margin: 0, 
            borderRadius: '1px'
          }}
          onError={(e) => {
        console.error('Card image failed to load:', getCardImage(card));
            const target = e.target as HTMLImageElement;
            target.style.display = 'none';
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
  }>;
  communityCards: Card[];
  pot: number;
  tournamentCountdown?: { startTime: string; seconds: number } | null;
  currentBet: number;
  currentPlayer?: string;
  smallBlind?: number;
  bigBlind?: number;
  myUserId?: string;
  showdownActive?: boolean;
  showdownResults?: any;
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
  showdownActive = false,
  showdownResults,
  tournamentCountdown,
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
  
  // Track visible action overlays: { playerId: { action: string, timestamp: number } }
  const [actionOverlays, setActionOverlays] = useState<Record<string, { action: string; timestamp: number }>>({});
  
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
        return { text: 'ALL IN', color: '#b91c1c' }; // red-700
      default:
        return { text: action, color: '#64748b' }; // slate-500
    }
  };
  
  // Track player actions and show overlays
  useEffect(() => {
    const now = Date.now();
    const newOverlays: Record<string, { action: string; timestamp: number }> = {};
    
    players.forEach(player => {
      if (player.lastAction && player.lastAction !== '') {
        const playerId = player.id || player.userId || '';
        // Check if this is a new action (player's lastAction changed)
        const existingOverlay = actionOverlays[playerId];
        if (!existingOverlay || existingOverlay.action !== player.lastAction) {
          // New action - show overlay
          newOverlays[playerId] = {
            action: player.lastAction,
            timestamp: now
          };
        } else {
          // Keep existing overlay if it's still fresh (less than 3 seconds old)
          if (now - existingOverlay.timestamp < 3000) {
            newOverlays[playerId] = existingOverlay;
          }
        }
      }
    });
    
    setActionOverlays(newOverlays);
  }, [players.map(p => p.lastAction).join(',')]); // Only track lastAction changes
  
  // Clean up old overlays after fade duration
  useEffect(() => {
    const interval = setInterval(() => {
      const now = Date.now();
      setActionOverlays(prev => {
        const updated = { ...prev };
        Object.keys(updated).forEach(playerId => {
          if (now - updated[playerId].timestamp >= 3000) {
            delete updated[playerId];
          }
        });
        return updated;
      });
    }, 100);
    
    return () => clearInterval(interval);
  }, []);
  
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
      style={{ padding: 'var(--table-padding, 32px)' }}
    >
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
                style={{ fontSize: 'var(--countdown-title-size, 14px)' }}
              >
                Game Starting Soon
              </p>
              <div 
                className="font-bold text-emerald-400"
                style={{ fontSize: 'var(--countdown-time-size, 28px)' }}
              >
                {Math.floor(tournamentCountdown.seconds / 60)}:{(tournamentCountdown.seconds % 60).toString().padStart(2, '0')}
              </div>
            </div>
          </div>
        )}

        {/* Community Cards - Center of table */}
        {communityCards.length > 0 && (
          <div 
            className="absolute left-1/2 top-1/2 z-10 flex -translate-x-1/2 -translate-y-1/2"
            style={{ gap: 'var(--community-card-gap, 8px)' }}
          >
            {communityCards.map((card, idx) => {
              // Read CSS variables for responsive sizing - recalculate when window size changes
              let cardWidth = typeof window !== 'undefined' 
                ? parseInt(getComputedStyle(document.documentElement).getPropertyValue('--community-card-width')) || 80
                : 80;
              let cardHeight = typeof window !== 'undefined'
                ? parseInt(getComputedStyle(document.documentElement).getPropertyValue('--community-card-height')) || 112
                : 112;
              
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
              
              // During showdown: keep winning cards normal size with 2px border, make losing cards smaller
              const isLosingCard = showdownActive && !isWinningCard;
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
                  />
                </div>
              );
            })}
          </div>
        )}

        {/* Player Positions - 10 seats at table edge */}
        {allSeats.flatMap((player, seatIdx) => {
          const position = PLAYER_POSITIONS[seatIdx];
          // Calculate radius to position at table edge (use percentage of table size)
          const radiusPercent = 45; // Position at 45% from center (near edge)
          const angleRad = (position.angle * Math.PI) / 180;
          
          const isMyPlayer = player && (myUserId === player.id || myUserId === player.userId);
          const isCurrentTurn = player && (currentPlayer === player.id || currentPlayer === player.userId);
          const hasActiveTimer = turnTimer && player && (player.userId === turnTimer.userId || player.id === turnTimer.userId);
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
          
          // Adjust horizontal position for smaller screens: seats 1,10 left, seats 5,6 right
          const horizontalOffset = windowSize.width <= 900
            ? ((seatIdx === 0 || seatIdx === 9) ? -12 : ((seatIdx === 4 || seatIdx === 5) ? 12 : 0))
            : 0;

          const elements = [
            <div
              key={`player-${player?.id || `seat-${seatIdx + 1}`}`}
              className="absolute z-20"
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
                          
                          {/* Action Overlay - shows when player acts (takes priority over timer) */}
                          {(() => {
                            const playerId = player.id || player.userId || '';
                            const overlay = actionOverlays[playerId];
                            // Show action overlay if player acted - takes priority over timer
                            if (overlay) {
                              const actionInfo = getActionInfo(overlay.action);
                              const age = Date.now() - overlay.timestamp;
                              const opacity = Math.max(0, 1 - (age / 3000)); // Fade out over 3 seconds
                              if (opacity > 0) {
                                return (
                                  <div 
                                    className="absolute inset-0 flex items-center justify-center rounded-full"
                                    style={{
                                      background: `linear-gradient(to bottom, rgba(0,0,0,0.7) 0%, rgba(0,0,0,0.6) 100%)`,
                                      opacity: opacity,
                                      transition: 'opacity 0.1s ease-out',
                                      pointerEvents: 'none',
                                      zIndex: 15 // Higher than timer overlay
                                    }}
                                  >
                                    <span 
                                      className="font-bold drop-shadow-lg text-center px-1"
                                      style={{ 
                                        color: actionInfo.color,
                                        fontSize: 'var(--player-name-size, 14px)',
                                        textShadow: '0 2px 4px rgba(0,0,0,0.8)'
                                      }}
                                    >
                                      {actionInfo.text}
                                    </span>
                                  </div>
                                );
                              }
                            }
                            return null;
                          })()}
                          
                          {/* Timer Overlay - only shows when player hasn't acted yet */}
                          {(() => {
                            const playerId = player.id || player.userId || '';
                            const hasActionOverlay = actionOverlays[playerId] && (Date.now() - actionOverlays[playerId].timestamp < 3000);
                            // Only show timer if player hasn't acted recently
                            if (hasActiveTimer && timerRemaining !== null && !hasActionOverlay) {
                              return (
                                <div className="absolute inset-0 flex items-center justify-center bg-black/60 rounded-full" style={{ zIndex: 10 }}>
                                  <span 
                                    className="font-bold text-yellow-400 drop-shadow-lg"
                                    style={{ fontSize: 'var(--timer-text-size, 20px)' }}
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
                            style={{ fontSize: 'var(--player-name-size, 14px)' }}
                          >
                            {player.name}
                          </div>
                        </div>
                        <div className="w-full px-2 py-1 rounded bg-slate-900/80 border border-slate-700/50">
                          <div 
                            className="font-medium text-emerald-300 text-center whitespace-nowrap"
                            style={{ fontSize: 'var(--player-chips-size, 12px)' }}
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
                            style={{ fontSize: 'var(--player-chips-size, 12px)' }}
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
          if (player && player.holeCards && player.holeCards.length > 0) {
            const isFolded = player.status === 'FOLDED';
            const isShowdownActive = showdownActive || false;
            // During showdown, turn all active players' cards face up
            const showFaceUp = isMyPlayer || isShowdownActive;
            
            // Get winner information for highlighting
            const isWinner = showdownResults?.winners?.some((w: any) => w.playerId === player.id || w.userId === player.userId);
            
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
            
            const holeWidth = typeof window !== 'undefined'
              ? parseInt(getComputedStyle(document.documentElement).getPropertyValue('--hole-card-width')) || 28
              : 28;
            const holeHeight = typeof window !== 'undefined'
              ? parseInt(getComputedStyle(document.documentElement).getPropertyValue('--hole-card-height')) || 39
              : 39;
            
            elements.push(
              <div
                key={`cards-${player.id}`}
                className={`absolute flex flex-col items-center gap-1 ${isFolded ? 'opacity-50' : ''}`}
                style={{
                  left: `calc(50% + ${Math.cos(angleRad) * radiusPercent}% + ${cardOffset}px)`,
                  top: `calc(50% + ${Math.sin(angleRad) * radiusPercent}%)`,
                  transform: 'translate(-50%, -50%)',
                  transition: 'transform 0.5s ease-in-out',
                  zIndex: 70, // Higher than names/chips (50) but below dealer button (60)
                }}
              >
                {/* Bet chip above cards for seats 1-5 */}
                {(player.contribution ?? 0) > 0 && (seatIdx + 1 <= 5) && (
                  <BetChip value={player.contribution!} />
                )}
                <div className="flex" style={{ gap: 'var(--hole-card-gap, 4px)' }}>
                  {player.holeCards.map((card, cardIdx) => {
                    // During showdown: keep winning cards normal size, make losing cards smaller
                    const cardIsWinning = isShowdownActive && !isFolded && isWinningCard(card);
                    const cardIsLosing = isShowdownActive && !isFolded && !isWinningCard(card);
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
                        />
                      </div>
                    );
                  })}
                </div>
                {/* Bet chip below cards for seats 6-10 */}
                {(player.contribution ?? 0) > 0 && (seatIdx + 1 > 5) && (
                  <BetChip value={player.contribution!} />
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
                  left: `calc(50% + ${Math.cos(angleRad) * radiusPercent}% + ${cardOffset}px)`,
                  top: `calc(50% + ${Math.sin(angleRad) * radiusPercent}% + ${seatIdx + 1 <= 5 ? -60 : 60}px)`,
                  transform: 'translate(-50%, -50%)',
                }}
              >
                <BetChip value={player.contribution} />
              </div>
            );
          }

          return elements;
        })}
      </div>

    </div>
  );
}
