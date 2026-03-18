// Socket handler for poker table events.
// Wires Socket.IO events to PokerGameService, BettingRound and Prisma.

import { prisma } from "../../config/database.js";
import { PokerGameService } from "../../services/PokerGameService.js";
import { TexasHoldem } from "../poker/TexasHoldem.js";
import { BettingRound } from "../poker/BettingRound.js";
import { HandEvaluator } from "../poker/HandEvaluator.js";
import {
  tableState,
  turnTimers,
  testPlayerTimers,
  getIO,
  hasActiveHand,
  getTurnStartedAt,
  setIO,
} from "../poker/tableState.js";
export { clearAllStateForGames } from "../poker/tableState.js";
import { ensureHandState } from "../poker/ensureHandState.js";
import { postDealerMessage } from "../poker/dealerMessages.js";
import { applyPlayerAction } from "../poker/actions.js";
import { buildClientGameState } from "../poker/buildClientGameState.js";
import { advanceToNextStreet } from "../poker/advanceStreet.js";
import { moveToNextPlayer } from "../poker/turnOrder.js";
import { emitIfTournamentCompleted } from "../poker/tableTournamentHooks.js";
import { handleShowdown } from "../poker/showdown.js";
export { emitIfTournamentCompleted, getIO };
import { startTurnTimer } from "../poker/turnTimers.js";
import { startHandForGameBody } from "../poker/startHand.js";
import { emitGameState } from "../poker/emitGameState.js";
import { checkAndAdvanceBlindLevel } from "../poker/blindLevel.js";

const gameService = new PokerGameService();
const engine = new TexasHoldem({ smallBlind: 10, bigBlind: 20 });

/** Delay in ms between each phase of the cinematic all-in showdown */
const SHOWDOWN_PHASE_DELAY_MS = 1000;

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// In-memory table state, timers, and IO live in ../poker/tableState.js

/** Prevents two concurrent startHandForGame(gameId) from both running (e.g. idle poll + join-table). */
const startHandLocks = new Map();
/**
 * Force a stuck hand to advance by making the current player CHECK (if legal) or FOLD.
 * Used when consolidation is waiting but a hand's turn timer failed (e.g. io was null).
 * Preserves chips - applies a real action, does NOT clear state.
 */
export async function forceStuckPlayerToAct(gameId, io) {
  const state = tableState.get(gameId);
  if (!state || !io) return false;
  const userId = state.currentTurnUserId;
  if (!userId) {
    // No turn set - try moveToNextPlayer which may detect betting complete
    await moveToNextPlayer(gameId, io);
    return true;
  }
  const player = state.players.find(p => p.userId === userId);
  if (!player || player.status === 'FOLDED' || player.status === 'ELIMINATED') {
    await moveToNextPlayer(gameId, io);
    return true;
  }
  if (player.chips === 0 || player.status === 'ALL_IN') {
    await moveToNextPlayer(gameId, io);
    return true;
  }
  const currentBet = state.bettingRound?.currentBet || 0;
  const myContribution = state.bettingRound?.getPlayerContribution(player.id) || 0;
  const canCheck = myContribution >= currentBet;
  try {
    if (canCheck) {
      await applyPlayerAction({ gameId, userId, action: "CHECK", amount: 0, io });
    } else {
      await applyPlayerAction({ gameId, userId, action: "FOLD", amount: 0, io });
    }
    await moveToNextPlayer(gameId, io);
    console.log(`[POKER] Force-stuck recovery: ${canCheck ? "CHECK" : "FOLD"} for ${player.name || userId} at table ${gameId}`);
    return true;
  } catch (err) {
    console.error(`[POKER] Force-stuck recovery failed for ${gameId}:`, err?.message);
    return false;
  }
}

/**
 * Start a hand for a game with dealer assignment and blinds
 * This can be called from startTournament or when players join
 */
export async function startHandForGame(gameId, io) {
  if (tableState.get(gameId)) return;
  let lock = startHandLocks.get(gameId);
  if (lock) {
    await lock;
    return;
  }
  lock = (async () => {
    try {
      return await startHandForGameBody(gameId, io);
    } finally {
      startHandLocks.delete(gameId);
    }
  })();
  startHandLocks.set(gameId, lock);
  await lock;
}

// startTurnTimer, emitGameState, checkAndAdvanceBlindLevel live in ../poker (turnTimers, emitGameState, blindLevel)
// runCinematicAllInShowdown lives in ../poker/showdown.js (used by advanceStreet)

export function registerPokerHandlers(io) {
  // Store io instance for use by other modules (getIO from tableState)
  setIO(io);
  
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
            },
            tournament: true
          }
        });

        if (!game) {
          socket.emit("error", { message: "Game not found" });
          return;
        }

        // Leave all other game rooms so we only receive events for THIS table.
        // Without this, after consolidation+redirect the user stays in the old room
        // and receives game-state from both tables, causing the view to flip between them.
        for (const room of socket.rooms) {
          if (room.startsWith("game:") && room !== `game:${gameId}`) {
            socket.leave(room);
          }
        }
        socket.join(`game:${gameId}`);

        // Auto-start a hand if:
        // 1. No hand state exists yet
        // 2. Game is ACTIVE
        // 3. Tournament is RUNNING (not just SEATED)
        // 4. There are at least 2 players
        let state = tableState.get(gameId);
        if (!state && game.status === "ACTIVE" && game.players.length >= 2) {
          // Only start hand if tournament is RUNNING
          if (game.tournament && game.tournament.status === "RUNNING") {
            try {
              // Use the exported startHandForGame function to ensure consistency
              state = await startHandForGame(gameId, socket.server);
            } catch (handError) {
              console.error("[POKER] Error auto-starting hand:", handError);
              // Continue without state if hand creation fails
            }
          }
        }

        // Get state again in case it was just created
        state = tableState.get(gameId);
        const payload = buildClientGameState(game, state);

        socket.emit("game-state", payload);
        
        // Broadcast to all players in the room if we just started a hand
        // (socket.server is the io instance)
        if (state) {
          socket.server.to(`game:${gameId}`).emit("game-state", payload);
        }
      } catch (err) {
        // eslint-disable-next-line no-console
        console.error("join-table error", err);
        socket.emit("error", { message: "Failed to join table" });
      }
    });

    socket.on("player-action", async ({ gameId, userId, action, amount }) => {
      try {
        // Clear turn timer for this game before processing action
        const existingTimer = turnTimers.get(gameId);
        if (existingTimer) {
          clearTimeout(existingTimer.timerId);
          if (existingTimer.graceTimerId) {
            clearTimeout(existingTimer.graceTimerId);
          }
          turnTimers.delete(gameId);
        }

        const state = await applyPlayerAction({
          gameId,
          userId,
          action,
          amount: Number(amount) || 0,
          io
        });

        // Build game state from in-memory state (fast - no DB query)
        // We need game data but can use the state we have
        const gameFromState = {
          id: gameId,
          pot: state.pot,
          players: state.players.map(p => ({
            id: p.id,
            userId: p.userId,
            name: p.name,
            chips: p.chips,
            seatNumber: p.seatNumber,
            status: p.status,
            holeCards: p.holeCards,
            avatarUrl: p.avatarUrl || p.user?.avatarUrl,
            user: p.user
          }))
        };

        // Emit game state IMMEDIATELY after action (no DB query - use in-memory state)
        const immediatePayload = buildClientGameState(gameFromState, state);
        io.to(`game:${gameId}`).emit("game-state", immediatePayload);

        // Check if betting round is complete
        const activePlayerIds = state.players
          .filter(p => p.status !== 'FOLDED' && p.status !== 'ELIMINATED')
          .map(p => p.id);
        
        // Get player name for logging
        const player = state.players.find((p) => p.userId === userId);
        const playerName = player?.name || player?.user?.username || `Player ${player?.seatNumber || userId}`;
        
        console.log(`[BETTING] Checking if betting complete after ${action} by ${playerName}`);
        console.log(`[BETTING] Active players: ${activePlayerIds.length}, lastRaiseUserId=${state.lastRaiseUserId || 'null'}, currentTurnUserId=${state.currentTurnUserId || 'null'}`);
        activePlayerIds.forEach(id => {
          const p = state.players.find(pl => pl.id === id);
          const contrib = state.bettingRound?.getPlayerContribution(id) || 0;
          console.log(`[BETTING]   Player ${p?.name || id} (seat ${p?.seatNumber}): contribution=${contrib}`);
        });
        
        const bettingComplete = state.bettingRound.isBettingComplete(
          activePlayerIds, 
          state.lastRaiseUserId,
          state.currentTurnUserId,
          state.players,
          state.actedPlayersInRound || new Set()
        );
        
        console.log(`[BETTING] Betting complete? ${bettingComplete}`);
        
        if (bettingComplete) {
          // Check for uncalled bet (bet/raise with no calls) - bettor wins immediately
          const activePlayersAfterAction = state.players.filter(p => p.status !== 'FOLDED' && p.status !== 'ELIMINATED');
          const currentBet = state.bettingRound.currentBet || 0;
          const lastRaiserUserId = state.lastRaiseUserId;
          
          // Check if there's a last raiser and only one active player remains
          // OR if someone bet/raised and everyone else folded (uncalled bet)
          if (activePlayersAfterAction.length === 1) {
            // Guard: prevent double-award if hand already ended (e.g. from another path)
            if (state.handEnded) {
              console.log(`[POKER] Single player remaining but hand already ended - skipping award`);
              return;
            }
            // Only one player remaining - award pot and end hand
            const winner = activePlayersAfterAction[0];
            const collectedPot = state.bettingRound.getTotalPot();
            const totalPot = state.pot + collectedPot;
            
            const winnerName = winner.name || winner.user?.username || `Player ${winner.seatNumber}`;
            
            // Check if this is an uncalled bet (bet/raise that wasn't called)
            const isUncalledBet = lastRaiserUserId && lastRaiserUserId === winner.userId && currentBet > 0;
            
            winner.chips += totalPot;
            state.pot = 0;
            state.handEnded = true;
            tableState.set(gameId, state);
            
            console.log(`[POKER] Single player remaining - awarding pot of ${totalPot} to ${winnerName}`);
            if (isUncalledBet) {
              console.log(`[POKER] Uncalled bet - ${winnerName} wins without showdown`);
            }
            
            // Post dealer message
            if (io) {
              if (isUncalledBet) {
                postDealerMessage(gameId, io, `${winnerName} wins ${totalPot.toLocaleString()} (uncalled bet)`);
              } else {
                postDealerMessage(gameId, io, `${winnerName} wins ${totalPot.toLocaleString()} (all other players folded)`);
              }
            }
            
            // Emit winner event for UI
            if (io) {
              io.to(`game:${gameId}`).emit("pot-winner", {
                gameId,
                winner: {
                  playerId: winner.id,
                  userId: winner.userId,
                  name: winnerName,
                  seatNumber: winner.seatNumber,
                  potWon: totalPot
                }
              });
            }
            
            // Persist winner chips and game pot BEFORE tournament completion so audit sees correct totals
            await prisma.player.update({
              where: { id: winner.id },
              data: { chips: winner.chips }
            }).catch(err => console.error('[POKER] Error updating winner chips:', err));
            await prisma.game.update({
              where: { id: gameId },
              data: { pot: 0 }
            }).catch(err => console.error('[POKER] Error updating game pot:', err));

            // Check for player elimination (though unlikely with folded players, check anyway)
            const { TournamentEngine } = await import("../../services/TournamentEngine.js");
            const tournamentEngine = new TournamentEngine();
            const game = await prisma.game.findUnique({
              where: { id: gameId },
              include: { tournament: true }
            });
            if (game?.tournament) {
              // Eliminate ANY players who have 0 chips after this pot is awarded
              const bustedPlayers = state.players.filter(p => p.chips <= 0 && p.status === 'ACTIVE');
              for (const busted of bustedPlayers) {
                console.log(`[POKER] Player ${busted.name || busted.userId} busted with 0 chips after pot award`);
                await tournamentEngine.onPlayerBust(game.tournament.id, busted.id).catch(() => {});
                busted.status = 'ELIMINATED';
                // Don't change seatNumber - keep it to avoid unique constraint violation
                // ELIMINATED players are filtered out by status, not seatNumber
                await prisma.player.update({
                  where: { id: busted.id },
                  data: { 
                    status: 'ELIMINATED',
                    chips: 0
                  }
                }).catch(err => {
                  if (err?.code === 'P2025') {
                    console.log(`[POKER] Player ${busted.id} already removed (consolidation), skipping bust update`);
                  } else {
                    console.error(`[POKER] Error updating busted player ${busted.id}:`, err);
                  }
                });
              }
              await emitIfTournamentCompleted(game.tournament.id, gameId, socket.server);
            }
            
            // Clear hand state after delay
            const savedPlayers = [...state.players];
            setTimeout(async () => {
              tableState.delete(gameId);
              
              // Reset player statuses (async) - keep ELIMINATED players eliminated
              savedPlayers.forEach(p => {
                const isEliminated = p.status === 'ELIMINATED';
                prisma.player.update({
                  where: { id: p.id },
                  data: { 
                    status: isEliminated ? 'ELIMINATED' : 'ACTIVE',
                    holeCards: "",
                    lastAction: null
                  }
                }).catch(err => {
                  if (err?.code === 'P2025') return;
                  console.error(`[POKER] Error resetting player ${p.id}:`, err);
                });
              });
              
              // Advance blind level and start new hand if tournament
              const game = await prisma.game.findUnique({
                where: { id: gameId },
                include: { tournament: true }
              });
              
              if (game && game.tournament && game.tournament.status === 'RUNNING') {
                // Check if blind level should advance
                await checkAndAdvanceBlindLevel(game.tournament.id, gameId, io);
                
                // Start new hand
                try {
                  await startHandForGame(gameId, io);
                } catch (err) {
                  console.error(`[POKER] Error starting new hand:`, err);
                }
              }
            }, 3000); // 3 second delay to show winner

            // Show table win message and +potWon before next hand (no hand strength - fold/uncalled win)
            state.showdownActive = true;
            state.showdownResults = {
              winners: [{ playerId: winner.id, userId: winner.userId, name: winnerName, potWon: totalPot }]
            };
            tableState.set(gameId, state);

            // Emit updated state
            const updatedGameFromState = {
              id: gameId,
              pot: 0,
              players: state.players.map(p => ({
                id: p.id,
                userId: p.userId,
                name: p.name,
                chips: p.chips,
                seatNumber: p.seatNumber,
                status: p.status,
                holeCards: p.holeCards,
                avatarUrl: p.avatarUrl || p.user?.avatarUrl,
                user: p.user
              }))
            };
            const payload = buildClientGameState(updatedGameFromState, state);
            io.to(`game:${gameId}`).emit("game-state", payload);
            
            return; // Don't advance to next street
          }
          
          // Multiple players remaining - advance to next street
          await advanceToNextStreet(gameId, io);
          // Emit updated state immediately from in-memory state (no DB query needed)
            const updatedState = tableState.get(gameId);
          if (updatedState) {
            const updatedGameFromState = {
              id: gameId,
              pot: updatedState.pot,
              communityCards: updatedState.communityCards,
              players: updatedState.players.map(p => ({
                id: p.id,
                userId: p.userId,
                name: p.name,
                chips: p.chips,
                seatNumber: p.seatNumber,
                status: p.status,
                holeCards: p.holeCards,
                avatarUrl: p.avatarUrl || p.user?.avatarUrl,
                user: p.user
              }))
            };
            const payload = buildClientGameState(updatedGameFromState, updatedState);
            io.to(`game:${gameId}`).emit("game-state", payload);
          }
        } else {
          // Move to next player in current betting round
          await moveToNextPlayer(gameId, io);
          // Emit updated state immediately from in-memory state (no DB query needed)
          const updatedState = tableState.get(gameId);
          if (updatedState) {
            const updatedGameFromState = {
              id: gameId,
              pot: updatedState.pot,
              players: updatedState.players.map(p => ({
                id: p.id,
                userId: p.userId,
                name: p.name,
                chips: p.chips,
                seatNumber: p.seatNumber,
                status: p.status,
                holeCards: p.holeCards,
                avatarUrl: p.avatarUrl || p.user?.avatarUrl,
                user: p.user
              }))
            };
            const payload = buildClientGameState(updatedGameFromState, updatedState);
          io.to(`game:${gameId}`).emit("game-state", payload);
          }
        }
      } catch (err) {
        // eslint-disable-next-line no-console
        console.error("player-action error", err);
        socket.emit("error", { message: err.message || "Action failed" });
      }
    });

    socket.on("game_message", async ({ gameId, message }) => {
      try {
        // Broadcast message to all players in the game
        io.to(`game:${gameId}`).emit("game_message", { gameId, message });
      } catch (err) {
        // eslint-disable-next-line no-console
        console.error("game_message error", err);
        socket.emit("error", { message: "Failed to send message" });
      }
    });

    socket.on("disconnect", () => {
      // eslint-disable-next-line no-console
      console.log("Poker client disconnected", socket.id);
    });
  });
}


