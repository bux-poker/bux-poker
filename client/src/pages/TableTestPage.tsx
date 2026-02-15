/**
 * Test page for table position adjustments.
 * Renders a full poker table with 10 seated players, face-down cards, 100 chips each, 5 community cards.
 * Open /table-test to tweak PLAYER_POSITIONS in PokerTable.tsx while viewing.
 */
import { PokerTable } from "../components/poker/PokerTable";
import type { Card } from "@shared/types/poker";

const PLACEHOLDER_CARD: Card = { suit: "HEARTS", rank: "A" };
const COMMUNITY_CARDS: Card[] = [
  { suit: "SPADES", rank: "K" },
  { suit: "HEARTS", rank: "Q" },
  { suit: "DIAMONDS", rank: "J" },
  { suit: "CLUBS", rank: "10" },
  { suit: "SPADES", rank: "9" },
];

function buildTestPlayers() {
  return Array.from({ length: 10 }, (_, i) => ({
    id: `test-player-${i + 1}`,
    name: `Player ${i + 1}`,
    chips: 100,
    seatNumber: i + 1,
    status: "ACTIVE",
    holeCards: [PLACEHOLDER_CARD, { ...PLACEHOLDER_CARD, rank: "K" }] as Card[],
    contribution: 0,
  }));
}

export function TableTestPage() {
  const players = buildTestPlayers();

  return (
    <div className="flex min-h-[100dvh] flex-col">
      <div className="flex-1 flex items-center justify-center p-4">
        <PokerTable
          gameId="table-test"
          players={players}
          communityCards={COMMUNITY_CARDS}
          pot={500}
          currentBet={20}
          smallBlind={10}
          bigBlind={20}
        />
      </div>
    </div>
  );
}
