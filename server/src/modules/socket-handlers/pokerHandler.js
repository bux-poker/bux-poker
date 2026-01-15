// Socket handler for poker table events.
// Wires Socket.IO events to PokerGameService, BettingRound and Prisma.

import { prisma } from "../../config/database.js";
import { PokerGameService } from "../services/PokerGameService.js";
import { TexasHoldem } from "../poker/TexasHoldem.js";
import { BettingRound } from "../poker/BettingRound.js";

const gameService = new PokerGameService();
const engine = new TexasHoldem({ smallBlind: 10, bigBlind: 20 });

// In-memory per-game state for the current hand and betting street.
// For production you'd want this to be more robust / persisted.
const tableState = new Map();

function buildClientGameState(game, state) {
  return {
    id: game.id,
    tournamentId: game.tournamentId,
    tableNumber: game.tableNumber,
    pot: state?.pot ?? game.pot,
    communityCards: JSON.stringify(state?.communityCards ?? []),
    players: (state?.players ?? game.players).map((p) => ({
      id: p.id,
      userId: p.userId,
      name: p.user?.username || "Player",
      chips: p.chips,
      seatNumber: p.seatNumber,
      status: p.status
    }))
  };
}

async function ensureHandState(gameId) {
  let state = tableState.get(gameId);
  if (state) return state;

  const game = await prisma.game.findUnique({
    where: { id: gameId },
    include: {
      players: {
        include: { user: true }
      }
    }
  });

  if (!game) {
    throw new Error("Game not found");
  }

  const deck = engine.createShuffledDeck();
  const { deck: remainingDeck, players: dealtHands } = engine.dealHoleCards(
    deck,
    game.players.length
  );

  // Persist hole cards to players (encoded as JSON string).
  await Promise.all(
    game.players.map((p, index) =>
      prisma.player.update({
        where: { id: p.id },
        data: {
          holeCards: JSON.stringify(dealtHands[index])
        }
      })
    )
  );

  const bettingRound = new BettingRound({
    smallBlind: engine.smallBlind,
    bigBlind: engine.bigBlind,
    startingPot: game.pot
  });

  state = {
    street: "PREFLOP",
    deck: remainingDeck,
    communityCards: [],
    bettingRound,
    pot: game.pot,
    players: game.players.map((p) => ({
      ...p,
      contributions: 0
    }))
  };

  tableState.set(gameId, state);
  return state;
}

async function applyPlayerAction({ gameId, userId, action, amount }) {
  const state = await ensureHandState(gameId);

  const player = state.players.find((p) => p.userId === userId);
  if (!player) {
    throw new Error("Player not at this table");
  }

  // Basic action handling. This is intentionally simplified:
  switch (action) {
    case "BET":
    case "RAISE": {
      state.bettingRound.bet(player.id, amount);
      player.chips -= amount;
      state.pot = state.bettingRound.getTotalPot();
      break;
    }
    case "CALL": {
      const spent = state.bettingRound.call(player.id, player.chips);
      player.chips -= spent;
      state.pot = state.bettingRound.getTotalPot();
      break;
    }
    case "CHECK": {
      // No chips moved; validity (no outstanding bet) assumed client-side for now.
      break;
    }
    case "FOLD": {
      player.status = "FOLDED";
      break;
    }
    case "ALL_IN": {
      const allInAmount = player.chips;
      if (allInAmount <= 0) {
        throw new Error("Cannot go all-in with zero chips");
      }
      state.bettingRound.bet(player.id, allInAmount);
      player.chips = 0;
      state.pot = state.bettingRound.getTotalPot();
      break;
    }
    default:
      throw new Error("Unknown action");
  }

  // Persist chips and status for this player.
  await prisma.player.update({
    where: { id: player.id },
    data: {
      chips: player.chips,
      status: player.status,
      lastAction: action
    }
  });

  // Persist pot to game.
  await prisma.game.update({
    where: { id: gameId },
    data: {
      pot: state.pot
    }
  });

  return state;
}

export function registerPokerHandlers(io) {
  io.on("connection", (socket) => {
    // eslint-disable-next-line no-console
    console.log("Poker client connected", socket.id);

    socket.on("join-table", async ({ gameId }) => {
      try {
        const game = await prisma.game.findUnique({
          where: { id: gameId },
          include: {
            players: {
              include: {
                user: true
              }
            }
          }
        });

        if (!game) {
          socket.emit("error", { message: "Game not found" });
          return;
        }

        socket.join(`game:${gameId}`);

        const state = tableState.get(gameId) || null;
        const payload = buildClientGameState(game, state);

        socket.emit("game-state", payload);
      } catch (err) {
        // eslint-disable-next-line no-console
        console.error("join-table error", err);
        socket.emit("error", { message: "Failed to join table" });
      }
    });

    socket.on("player-action", async ({ gameId, userId, action, amount }) => {
      try {
        const state = await applyPlayerAction({
          gameId,
          userId,
          action,
          amount: Number(amount) || 0
        });

        const game = await prisma.game.findUnique({
          where: { id: gameId },
          include: {
            players: {
              include: {
                user: true
              }
            }
          }
        });

        if (!game) {
          socket.emit("error", { message: "Game not found" });
          return;
        }

        const payload = buildClientGameState(game, state);

        io.to(`game:${gameId}`).emit("game-state", payload);
      } catch (err) {
        // eslint-disable-next-line no-console
        console.error("player-action error", err);
        socket.emit("error", { message: err.message || "Action failed" });
      }
    });

    socket.on("disconnect", () => {
      // eslint-disable-next-line no-console
      console.log("Poker client disconnected", socket.id);
    });
  });
}


