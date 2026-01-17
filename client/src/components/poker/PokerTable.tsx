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
    <div className="flex items-center gap-1">
      <div
        className="w-6 h-6 rounded-full shadow-lg flex items-center justify-center relative overflow-hidden"
        style={{ backgroundColor: chipColor }}
      >
        <img
          src="/poker-chip.svg"
          alt="chip"
          className="w-full h-full object-contain"
          style={{ filter: 'brightness(0) invert(1)' }}
        />
      </div>
      <span className="text-xs font-semibold text-white drop-shadow-lg">
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

  // Get card image filename
  const getCardImage = (card: Card): string => {
    const suitMap: Record<string, string> = {
      "SPADES": "S", "HEARTS": "H", "DIAMONDS": "D", "CLUBS": "C"
    };
    const suit = suitMap[card.suit] || card.suit.charAt(0);
    // Handle 10 specially since it's "10" not "TEN"
    const rank = card.rank === "10" ? "10" : card.rank;
    return `${rank}${suit}.png`;
  };

  const isLargeScreen = window.innerWidth >= 900 && window.innerHeight > 449;
  
    if (isLargeScreen) {
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
            borderRadius: '8px'
          }}
          onError={(e) => {
            // Fallback to CSS card if image not found
            const target = e.target as HTMLImageElement;
            target.style.display = 'none';
            const parent = target.parentElement;
            if (parent) {
              parent.innerHTML = `
                <div class="bg-white rounded-lg border-2 border-black" style="width: ${width - 2}px; height: ${height}px; display: flex; flex-direction: column; justify-content: space-between; padding: 4px;">
                  <div class="text-black text-sm font-bold">${card.rank}</div>
                  <div class="text-black text-lg self-center">${card.suit === 'HEARTS' ? '♥' : card.suit === 'DIAMONDS' ? '♦' : card.suit === 'CLUBS' ? '♣' : '♠'}</div>
                  <div class="text-black text-sm font-bold rotate-180">${card.rank}</div>
                </div>
              `;
            }
          }}
        />
      );
    }

  // CSS-based card for small screens
  const suitSymbol = card.suit === 'HEARTS' ? '♥' : card.suit === 'DIAMONDS' ? '♦' : card.suit === 'CLUBS' ? '♣' : '♠';
  const suitColor = (card.suit === 'HEARTS' || card.suit === 'DIAMONDS') ? 'text-red-600' : 'text-black';

  return (
    <div
      className={`${className} bg-white rounded-lg border-2 border-black relative overflow-hidden ${suitColor}`}
      style={{ width, height }}
    >
      {/* Top left corner */}
      <div className="absolute top-1 left-1 text-sm font-bold">
        <div>{card.rank}</div>
        <div className="text-xs">{suitSymbol}</div>
      </div>
      {/* Center large suit */}
      <div className="absolute inset-0 flex items-center justify-center">
        <div className="text-3xl font-bold">{suitSymbol}</div>
      </div>
      {/* Bottom right corner (rotated) */}
      <div className="absolute bottom-1 right-1 text-sm font-bold rotate-180">
        <div>{card.rank}</div>
        <div className="text-xs">{suitSymbol}</div>
      </div>
    </div>
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
  }>;
  communityCards: Card[];
  pot: number;
  currentBet: number;
  currentPlayer?: string;
  smallBlind?: number;
  bigBlind?: number;
  myUserId?: string;
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
  
  // Update timer every second
  useEffect(() => {
    if (turnTimer) {
      const interval = setInterval(() => {
        setCurrentTime(Date.now());
      }, 100); // Update every 100ms for smooth countdown
      return () => clearInterval(interval);
    }
  }, [turnTimer]);

  return (
    <div className="relative flex h-full w-full items-center justify-center bg-gradient-to-br from-slate-950 to-slate-900 overflow-hidden p-8">
      {/* Oval/Circular Table */}
      <div className="relative h-full w-full max-h-[calc(85vh-4rem)] max-w-[calc(90vw-4rem)] rounded-[50%] border-8 border-amber-600/40 bg-gradient-to-br from-emerald-900/60 to-slate-900/80 shadow-2xl" style={{ aspectRatio: '3/2' }}>
        


        {/* Community Cards - Center of table */}
        {communityCards.length > 0 && (
          <div className="absolute left-1/2 top-1/2 z-10 flex -translate-x-1/2 -translate-y-1/2 gap-2">
            {communityCards.map((card, idx) => (
              <PokerCardImage
                key={idx}
                card={card}
                width={80}
                height={112}
                className="shadow-xl"
              />
            ))}
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
          const cardOffset = cardsOnRight ? 80 : -80; // Offset cards to right or left of avatar

          const elements = [
            <div
              key={`player-${player?.id || `seat-${seatIdx + 1}`}`}
              className="absolute z-20"
              style={{
                left: `calc(50% + ${Math.cos(angleRad) * radiusPercent}%)`,
                top: `calc(50% + ${Math.sin(angleRad) * radiusPercent}%)`,
                transform: 'translate(-50%, -50%)',
              }}
            >
              <div className="flex flex-col items-center">
                  {/* Player Avatar or Empty Seat */}
                  {player ? (
                    <>
                      <div className={`relative mb-2 ${hasActiveTimer ? 'animate-pulse' : ''} ${hasActiveTimer ? 'ring-4 ring-yellow-400 ring-offset-2 ring-offset-slate-900 rounded-full' : (isCurrentTurn ? 'ring-4 ring-yellow-400 ring-offset-2 ring-offset-slate-900 rounded-full' : '')}`}>
                        <div className="h-16 w-16 overflow-hidden rounded-full border-2 border-slate-700 bg-slate-800 relative">
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
                          
                          {/* Timer Overlay */}
                          {hasActiveTimer && timerRemaining !== null && (
                            <div className="absolute inset-0 flex items-center justify-center bg-black/60 rounded-full">
                              <span className="text-xl font-bold text-yellow-400 drop-shadow-lg">
                                {timerRemaining}
                              </span>
                            </div>
                          )}
                        </div>
                      
                        {/* Dealer Button */}
                        {player.isDealer && (
                          <div className="absolute -right-2 -top-2 flex h-8 w-8 items-center justify-center rounded-full bg-yellow-500 border-2 border-white shadow-lg">
                            <span className="text-xs font-bold text-yellow-900">D</span>
                          </div>
                        )}
                      </div>

                      {/* Player Name and Chips - In containers, no wrapping */}
                      <div className="flex flex-col items-center gap-1 min-w-0 max-w-[120px]">
                        <div className="w-full px-2 py-1 rounded bg-slate-900/80 border border-slate-700/50">
                          <div className="text-sm font-semibold text-white drop-shadow-lg truncate text-center whitespace-nowrap">
                            {player.name}
                          </div>
                        </div>
                        <div className="w-full px-2 py-1 rounded bg-slate-900/80 border border-slate-700/50">
                          <div className="text-xs font-medium text-emerald-300 text-center whitespace-nowrap">
                            {player.chips.toLocaleString()}
                          </div>
                        </div>
                      </div>
                    </>
                  ) : (
                    /* Empty Seat Indicator */
                    <div className="relative mb-2 opacity-30">
                      <div className="h-16 w-16 overflow-hidden rounded-full border-2 border-dashed border-slate-600 bg-slate-800/50">
                        <div className="flex h-full w-full items-center justify-center">
                          <span className="text-xs text-slate-500">{seatIdx + 1}</span>
                        </div>
                      </div>
                    </div>
                  )}
              </div>
            </div>
          ];

          // Add cards as separate element if player has cards (including own player)
          if (player && player.holeCards && player.holeCards.length > 0) {
            elements.push(
              <div
                key={`cards-${player.id}`}
                className="absolute z-20 flex flex-col items-center gap-1"
                style={{
                  left: `calc(50% + ${Math.cos(angleRad) * radiusPercent}% + ${cardOffset}px)`,
                  top: `calc(50% + ${Math.sin(angleRad) * radiusPercent}%)`,
                  transform: 'translate(-50%, -50%)',
                }}
              >
                {/* Bet chip above cards for seats 1-5 */}
                {(player.contribution ?? 0) > 0 && (seatIdx + 1 <= 5) && (
                  <BetChip value={player.contribution!} />
                )}
                <div className="flex gap-1">
                  {player.holeCards.map((_, cardIdx) => (
                    <PokerCardImage
                      key={cardIdx}
                      card={player.holeCards![cardIdx]}
                      width={28}
                      height={39}
                      className="shadow-md"
                      faceDown={!isMyPlayer}
                    />
                  ))}
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
