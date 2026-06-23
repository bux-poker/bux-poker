import { prisma } from "../../../config/database.js";
import { tableState, turnTimers } from "../../poker/tableState.js";
import { applyPlayerAction } from "../../poker/actions.js";
import { emitGameState } from "../../poker/emitGameState.js";
import { postDealerMessage } from "../../poker/dealerMessages.js";
import { moveToNextPlayer } from "../../poker/turnOrder.js";
import { advanceToNextStreet } from "../../poker/advanceStreet.js";
import { emitIfTournamentCompleted } from "../../poker/tableTournamentHooks.js";
import { checkAndAdvanceBlindLevel } from "../../poker/blindLevel.js";
import { cleanupHandAndStartNext } from "../../poker/handCleanup.js";
import { persistAllPlayerStacksFromHandState } from "../../poker/persistHandStacks.js";
import {
  clearHoleCardsIfEliminated,
  resetPlayerRowIfNotEliminated,
} from "../../poker/safeHandCleanupDb.js";
import { awardPotToSingleWinner } from "../../poker/sidePotMath.js";

/**
 * Register the player-action socket handler.
 * @param {object} socket - Socket.IO socket
 * @param {object} io - Socket.IO server
 * @param {{ startHandForGame: (gameId: string, io: object) => Promise<void> }} deps - startHandForGame from router
 */
export function registerPlayerAction(socket, io, { startHandForGame }) {
  socket.on("player-action", async ({ gameId, userId, action, amount }) => {
    try {
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

      const actingPlayer = state.players.find((p) => p.userId === userId);
      if (actingPlayer?.isAway) {
        actingPlayer.isAway = false;
        tableState.set(gameId, state);
      }

      await emitGameState(gameId, io, state);

      const activePlayerIds = state.players
        .filter(p => p.status !== "FOLDED" && p.status !== "ELIMINATED")
        .map(p => p.id);

      const player = state.players.find((p) => p.userId === userId);
      const playerName = player?.name || player?.user?.username || `Player ${player?.seatNumber || userId}`;

      console.log(`[BETTING] Checking if betting complete after ${action} by ${playerName}`);
      console.log(`[BETTING] Active players: ${activePlayerIds.length}, lastRaiseUserId=${state.lastRaiseUserId || "null"}, currentTurnUserId=${state.currentTurnUserId || "null"}`);
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
        const activePlayersAfterAction = state.players.filter(p => p.status !== "FOLDED" && p.status !== "ELIMINATED");
        const currentBet = state.bettingRound.currentBet || 0;
        const lastRaiserUserId = state.lastRaiseUserId;

        if (activePlayersAfterAction.length === 1) {
          if (state.handEnded) {
            console.log(`[POKER] Single player remaining but hand already ended - clearing state and starting next hand`);
            cleanupHandAndStartNext(gameId, io, state, startHandForGame);
            return;
          }
          const {
            persistBlockedFoldWinPotToDatabase,
            shouldBlockFoldWinPotAward,
          } = await import("../../poker/foldWinGuard.js");
          const winner = activePlayersAfterAction[0];
          const winnerName = winner.name || winner.user?.username || `Player ${winner.seatNumber}`;
          const isUncalledBet = lastRaiserUserId && lastRaiserUserId === winner.userId && currentBet > 0;

          if (await shouldBlockFoldWinPotAward(gameId)) {
            await persistBlockedFoldWinPotToDatabase(gameId, state);
            tableState.delete(gameId);
            return;
          }
          const { potToAward: totalPot, uncalledEvents } = awardPotToSingleWinner(
            state,
            winner
          );
          state.handEnded = true;
          tableState.set(gameId, state);

          console.log(`[POKER] Single player remaining - awarding pot of ${totalPot} to ${winnerName}`);
          if (isUncalledBet) {
            console.log(`[POKER] Uncalled bet - ${winnerName} wins without showdown`);
          }

          if (io) {
            for (const ev of uncalledEvents) {
              postDealerMessage(
                gameId,
                io,
                `${ev.name} receives ${ev.amount.toLocaleString()} back (uncalled bet)`
              );
            }
            if (isUncalledBet) {
              postDealerMessage(gameId, io, `${winnerName} wins ${totalPot.toLocaleString()} (uncalled bet)`);
            } else {
              postDealerMessage(gameId, io, `${winnerName} wins ${totalPot.toLocaleString()} (all other players folded)`);
            }
          }

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

          await persistAllPlayerStacksFromHandState(
            state,
            "[POKER] fold-win"
          ).catch((err) =>
            console.error("[POKER] Error persisting stacks after fold win:", err)
          );
          await prisma.game.update({
            where: { id: gameId },
            data: { pot: 0 }
          }).catch(err => console.error("[POKER] Error updating game pot:", err));

          const savedPlayers = [...state.players];
          // Schedule cleanup BEFORE onPlayerBust: bust can trigger consolidateTables; if we hadn't scheduled this yet we'd deadlock.
          setTimeout(async () => {
            tableState.delete(gameId);

            savedPlayers.forEach((p) => {
              if (p.status === "ELIMINATED") {
                clearHoleCardsIfEliminated(p.id).catch((err) =>
                  console.error(`[POKER] Error clearing holes for eliminated ${p.id}:`, err)
                );
              } else {
                resetPlayerRowIfNotEliminated(p.id).catch((err) =>
                  console.error(`[POKER] Error resetting player ${p.id}:`, err)
                );
              }
            });

            const gameForNext = await prisma.game.findUnique({
              where: { id: gameId },
              include: { tournament: true }
            });

            if (gameForNext?.tournament?.status === "RUNNING") {
              await checkAndAdvanceBlindLevel(gameForNext.tournament.id, gameId, io);
              try {
                await startHandForGame(gameId, io);
              } catch (err) {
                console.error(`[POKER] Error starting new hand:`, err);
              }
            }
          }, 3000);

          const { TournamentEngine } = await import("../../../services/TournamentEngine.js");
          const tournamentEngine = new TournamentEngine();
          const game = await prisma.game.findUnique({
            where: { id: gameId },
            include: { tournament: true }
          });
          if (game?.tournament) {
            // Any non-eliminated player with 0 chips is out (includes FOLDED after losing last chips).
            const bustedPlayers = state.players.filter(
              (p) => p.chips <= 0 && p.status !== "ELIMINATED"
            );
            for (const busted of bustedPlayers) {
              console.log(`[POKER] Player ${busted.name || busted.userId} busted with 0 chips after pot award`);
              await tournamentEngine.onPlayerBust(game.tournament.id, busted.id).catch(() => {});
              busted.status = "ELIMINATED";
              await prisma.player.update({
                where: { id: busted.id },
                data: { status: "ELIMINATED", chips: 0 }
              }).catch(err => {
                if (err?.code === "P2025") {
                  console.log(`[POKER] Player ${busted.id} already removed (consolidation), skipping bust update`);
                } else {
                  console.error(`[POKER] Error updating busted player ${busted.id}:`, err);
                }
              });
            }
            if (bustedPlayers.length > 0) {
              socket.server.emit("tournament_updated", { tournamentId: game.tournament.id });
            }
            await emitIfTournamentCompleted(game.tournament.id, socket.server);
          }

          // Do not set showdownActive so cards are not turned over (fold win, no showdown)
          state.showdownResults = {
            winners: [{ playerId: winner.id, userId: winner.userId, name: winnerName, potWon: totalPot }]
          };
          tableState.set(gameId, state);

          await emitGameState(gameId, io, state);

          return;
        }

        await advanceToNextStreet(gameId, io);
        const updatedState = tableState.get(gameId);
        if (updatedState) {
          await emitGameState(gameId, io, updatedState);
        }
      } else {
        await moveToNextPlayer(gameId, io);
        const updatedState = tableState.get(gameId);
        if (updatedState) {
          await emitGameState(gameId, io, updatedState);
        }
      }
    } catch (err) {
      console.error("player-action error", err);
      socket.emit("error", { message: err.message || "Action failed" });
    }
  });
}
