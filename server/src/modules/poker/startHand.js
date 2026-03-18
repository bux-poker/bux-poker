import { prisma } from "../../config/database.js";
import { TexasHoldem } from "./TexasHoldem.js";
import { BettingRound } from "./BettingRound.js";
import { tableState } from "./tableState.js";

const engine = new TexasHoldem({ smallBlind: 10, bigBlind: 20 });

/**
 * Core logic for starting a new hand:
 * - Load non-eliminated players with chips
 * - Determine blinds from tournament/game
 * - Rotate dealer and assign SB/BB
 * - Deal cards and persist holeCards
 * - Create BettingRound and post blinds
 * - Initialize in-memory hand state in tableState
 *
 * This is extracted from pokerHandler so it can be reasoned about and tested in isolation.
 */
export async function startHandCore(gameId, io, options = {}) {
  const game = await prisma.game.findUnique({
    where: { id: gameId },
    include: {
      players: {
        where: { status: { not: "ELIMINATED" }, chips: { gt: 0 } },
        include: { user: true },
      },
      tournament: true,
    },
  });

  if (!game) {
    throw new Error("Game not found");
  }
  if (game.status !== "ACTIVE") {
    return null;
  }
  if (game.players.length < 2) {
    throw new Error("Not enough players");
  }

  if (tableState.get(gameId)) {
    return tableState.get(gameId);
  }

  // Delegate to the existing _startHandForGameBody in pokerHandler (for now) so we
  // do not change behavior while extracting modules. This keeps a single source of truth.
  const { _startHandForGameBody } = await import(
    "../socket-handlers/pokerHandler.js"
  );
  return _startHandForGameBody(gameId, io, { preloadedGame: game, engine });
}

