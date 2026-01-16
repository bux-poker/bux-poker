import { Card } from '@shared/types/poker';

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
        className={`${className} bg-blue-800 border-4 border-white rounded-lg relative overflow-hidden`}
        style={{ width, height }}
      >
        <div className="absolute inset-0 opacity-20">
          <div 
            className="absolute inset-0" 
            style={{
              backgroundImage: "repeating-linear-gradient(45deg, transparent, transparent 10px, white 10px, white 12px), repeating-linear-gradient(-45deg, transparent, transparent 10px, white 10px, white 12px)"
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
    return `${card.rank}${suit}.png`;
  };

  const isLargeScreen = window.innerWidth >= 900 && window.innerHeight > 449;
  
  if (isLargeScreen) {
    return (
      <img
        src={`/optimized/cards/${getCardImage(card)}`}
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
  }>;
  communityCards: Card[];
  pot: number;
  currentBet: number;
  currentPlayer?: string;
  smallBlind?: number;
  bigBlind?: number;
  myUserId?: string;
}

// Player positions around the table (6-player layout)
const PLAYER_POSITIONS = [
  { angle: 180, label: 'bottom' }, // Bottom center (seat 1)
  { angle: 120, label: 'bottom-left' }, // Bottom left (seat 2)
  { angle: 60, label: 'top-left' }, // Top left (seat 3)
  { angle: 0, label: 'top' }, // Top center (seat 4)
  { angle: -60, label: 'top-right' }, // Top right (seat 5)
  { angle: -120, label: 'bottom-right' }, // Bottom right (seat 6)
];

export function PokerTable({
  gameId,
  players,
  communityCards,
  pot,
  currentBet,
  currentPlayer,
  smallBlind = 10,
  bigBlind = 20,
  myUserId,
}: PokerTableProps) {
  // Sort players by seat number
  const sortedPlayers = [...players].sort((a, b) => a.seatNumber - b.seatNumber);
  
  // Get player's own hole cards (face up) - shown separately at bottom
  const myPlayer = myUserId ? sortedPlayers.find(p => p.id === myUserId) : null;
  const myHoleCards = myPlayer?.holeCards || [];

  return (
    <div className="relative flex h-full w-full items-center justify-center bg-gradient-to-br from-slate-950 to-slate-900">
      {/* Oval/Circular Table */}
      <div className="relative h-[600px] w-[900px] rounded-[50%] border-8 border-amber-600/40 bg-gradient-to-br from-emerald-900/60 to-slate-900/80 shadow-2xl">
        
        {/* BUX DAO Logo in Center */}
        <div className="absolute left-1/2 top-1/2 z-0 -translate-x-1/2 -translate-y-1/2">
          <img 
            src="/images/bux-poker.png" 
            alt="BUX DAO" 
            className="h-24 w-24 opacity-30"
          />
        </div>

        {/* Pot Display - Above community cards */}
        <div className="absolute left-1/2 top-[40%] z-10 -translate-x-1/2 -translate-y-1/2">
          <div className="rounded-lg border-2 border-emerald-500/50 bg-emerald-900/80 px-6 py-3 shadow-lg backdrop-blur-sm">
            <div className="text-xs font-semibold text-emerald-200/80 uppercase tracking-wide">Total Pot</div>
            <div className="text-2xl font-bold text-white">
              ${pot.toLocaleString()}
            </div>
          </div>
        </div>

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

        {/* Player Positions */}
        {sortedPlayers.map((player, idx) => {
          // Use seat number to determine position, fallback to index
          const seatIdx = (player.seatNumber - 1) % PLAYER_POSITIONS.length;
          const position = PLAYER_POSITIONS[seatIdx] || PLAYER_POSITIONS[idx % PLAYER_POSITIONS.length];
          const radius = 280;
          const angleRad = (position.angle * Math.PI) / 180;
          const x = Math.cos(angleRad) * radius;
          const y = Math.sin(angleRad) * radius;
          
          const isMyPlayer = myUserId === player.id;
          const isCurrentTurn = currentPlayer === player.id;
          const showCards = isMyPlayer && player.holeCards && player.holeCards.length > 0;

          return (
            <div
              key={player.id}
              className="absolute z-20"
              style={{
                left: `calc(50% + ${x}px)`,
                top: `calc(50% + ${y}px)`,
                transform: 'translate(-50%, -50%)',
              }}
            >
              <div className="flex flex-col items-center">
                {/* Player Avatar */}
                <div className={`relative mb-2 ${isCurrentTurn ? 'ring-4 ring-emerald-400 ring-offset-2 ring-offset-slate-900' : ''}`}>
                  <div className="h-16 w-16 overflow-hidden rounded-full border-2 border-slate-700 bg-slate-800">
                    {player.avatarUrl ? (
                      <img 
                        src={player.avatarUrl} 
                        alt={player.name}
                        className="h-full w-full object-cover"
                        onError={(e) => {
                          (e.target as HTMLImageElement).src = '/guest-avatar.png';
                        }}
                      />
                    ) : (
                      <div className="flex h-full w-full items-center justify-center bg-gradient-to-br from-blue-600 to-purple-600 text-2xl font-bold text-white">
                        {player.name.charAt(0).toUpperCase()}
                      </div>
                    )}
                  </div>
                  
                  {/* Dealer Button */}
                  {player.isDealer && (
                    <div className="absolute -right-2 -top-2 flex h-8 w-8 items-center justify-center rounded-full bg-yellow-500 border-2 border-white shadow-lg">
                      <span className="text-xs font-bold text-yellow-900">D</span>
                    </div>
                  )}
                  
                  {/* Small Blind Chip */}
                  {player.isSmallBlind && (
                    <div className="absolute -bottom-1 -left-2 flex h-6 w-6 items-center justify-center rounded-full bg-red-600 border-2 border-white shadow-md">
                      <span className="text-[10px] font-bold text-white">${smallBlind}</span>
                    </div>
                  )}
                  
                  {/* Big Blind Chip */}
                  {player.isBigBlind && (
                    <div className="absolute -bottom-1 -left-2 flex h-6 w-6 items-center justify-center rounded-full bg-blue-600 border-2 border-white shadow-md">
                      <span className="text-[10px] font-bold text-white">${bigBlind}</span>
                    </div>
                  )}
                </div>

                {/* Player Name */}
                <div className="mb-1 text-center">
                  <div className="text-sm font-semibold text-white drop-shadow-lg">
                    {player.name.length > 12 ? `${player.name.substring(0, 12)}...` : player.name}
                  </div>
                  <div className="text-xs font-medium text-emerald-300">
                    ${player.chips.toLocaleString()}
                  </div>
                </div>

                {/* Face-down cards for other players, face-up for current player (if not showing separately) */}
                {!isMyPlayer && player.holeCards && player.holeCards.length > 0 && (
                  <div className="flex gap-1">
                    {player.holeCards.map((_, cardIdx) => (
                      <PokerCardImage
                        key={cardIdx}
                        card={player.holeCards![cardIdx]}
                        width={40}
                        height={56}
                        className="shadow-md"
                        faceDown={true}
                      />
                    ))}
                  </div>
                )}
              </div>
            </div>
          );
        })}
      </div>

      {/* My Hole Cards - Shown at bottom left (like in screenshot) */}
      {myHoleCards.length > 0 && (
        <div className="absolute bottom-4 left-4 z-30 flex gap-2">
          {myHoleCards.map((card, idx) => (
            <PokerCardImage
              key={idx}
              card={card}
              width={100}
              height={140}
              className="shadow-2xl"
              faceDown={false}
            />
          ))}
        </div>
      )}
    </div>
  );
}
