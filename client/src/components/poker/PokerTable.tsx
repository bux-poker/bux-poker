import { Card } from '../../../shared/types/poker';

interface PokerTableProps {
  gameId: string;
  players: Array<{
    id: string;
    name: string;
    chips: number;
    holeCards?: Card[];
    isActive?: boolean;
    isDealer?: boolean;
    isSmallBlind?: boolean;
    isBigBlind?: boolean;
  }>;
  communityCards: Card[];
  pot: number;
  currentBet: number;
  currentPlayer?: string;
}

export function PokerTable({
  gameId,
  players,
  communityCards,
  pot,
  currentBet,
  currentPlayer,
}: PokerTableProps) {
  return (
    <div className="relative flex h-[600px] items-center justify-center rounded-lg border border-slate-800 bg-gradient-to-br from-slate-900 to-slate-950">
      {/* Table surface */}
      <div className="relative h-[500px] w-[700px] rounded-full border-4 border-emerald-500/30 bg-gradient-to-br from-emerald-950/50 to-slate-900/50 shadow-2xl">
        {/* Community cards area */}
        <div className="absolute left-1/2 top-1/2 flex -translate-x-1/2 -translate-y-1/2 gap-2">
          {communityCards.map((card, idx) => (
            <div
              key={idx}
              className="h-20 w-14 rounded border border-slate-700 bg-slate-800"
            >
              {/* Card rendering would go here */}
              <div className="flex h-full items-center justify-center text-xs text-slate-300">
                {card.rank} {card.suit}
              </div>
            </div>
          ))}
        </div>

        {/* Pot display */}
        <div className="absolute left-1/2 top-1/3 -translate-x-1/2 -translate-y-1/2">
          <div className="rounded-lg border border-emerald-500/50 bg-emerald-500/10 px-4 py-2">
            <div className="text-xs text-slate-400">Pot</div>
            <div className="text-lg font-bold text-emerald-200">
              {pot.toLocaleString()}
            </div>
          </div>
        </div>

        {/* Player positions (simplified - would need proper positioning) */}
        <div className="absolute inset-0">
          {players.map((player, idx) => {
            const angle = (idx * 360) / players.length;
            const radius = 200;
            const x = Math.cos((angle * Math.PI) / 180) * radius;
            const y = Math.sin((angle * Math.PI) / 180) * radius;

            return (
              <div
                key={player.id}
                className="absolute"
                style={{
                  left: `calc(50% + ${x}px)`,
                  top: `calc(50% + ${y}px)`,
                  transform: 'translate(-50%, -50%)',
                }}
              >
                <div
                  className={`rounded-lg border p-3 ${
                    currentPlayer === player.id
                      ? 'border-emerald-500 bg-emerald-500/20'
                      : 'border-slate-700 bg-slate-800/50'
                  }`}
                >
                  <div className="text-sm font-medium text-slate-200">
                    {player.name}
                  </div>
                  <div className="text-xs text-slate-400">
                    {player.chips.toLocaleString()} chips
                  </div>
                  {player.isDealer && (
                    <div className="mt-1 text-xs text-yellow-400">D</div>
                  )}
                  {player.isSmallBlind && (
                    <div className="mt-1 text-xs text-blue-400">SB</div>
                  )}
                  {player.isBigBlind && (
                    <div className="mt-1 text-xs text-purple-400">BB</div>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
