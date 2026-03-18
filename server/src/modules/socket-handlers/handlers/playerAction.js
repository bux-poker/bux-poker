import { prisma } from "../../../config/database.js";
import { tableState, turnTimers } from "../../poker/tableState.js";
import { applyPlayerAction } from "../../poker/actions.js";
import { buildClientGameState } from "../../poker/buildClientGameState.js";
import { postDealerMessage } from "../../poker/dealerMessages.js";
import { moveToNextPlayer } from "../../poker/turnOrder.js";
import { advanceToNextStreet } from "../../poker/advanceStreet.js";
import { emitIfTournamentCompleted } from "../../poker/tableTournamentHooks.js";
import { checkAndAdvanceBlindLevel } from "../../poker/blindLevel.js";

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

      const immediatePayload = buildClientGameState(gameFromState, state);
      io.to(`game:${gameId}`).emit("game-state", immediatePayload);

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
            console.log(`[POKER] Single player remaining but hand already ended - skipping award`);
            return;
          }
          const winner = activePlayersAfterAction[0];
          const collectedPot = state.bettingRound.getTotalPot();
          const totalPot = state.pot + collectedPot;

          const winnerName = winner.name || winner.user?.username || `Player ${winner.seatNumber}`;
          const isUncalledBet = lastRaiserUserId && lastRaiserUserId === winner.userId && currentBet > 0;

          winner.chips += totalPot;
          state.pot = 0;
          state.handEnded = true;
          tableState.set(gameId, state);

          console.log(`[POKER] Single player remaining - awarding pot of ${totalPot} to ${winnerName}`);
          if (isUncalledBet) {
            console.log(`[POKER] Uncalled bet - ${winnerName} wins without showdown`);
          }

          if (io) {
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

          await prisma.player.update({
            where: { id: winner.id },
            data: { chips: winner.chips }
          }).catch(err => console.error("[POKER] Error updating winner chips:", err));
          await prisma.game.update({
            where: { id: gameId },
            data: { pot: 0 }
          }).catch(err => console.error("[POKER] Error updating game pot:", err));

          const { TournamentEngine } = await import("../../../services/TournamentEngine.js");
          const tournamentEngine = new TournamentEngine();
          const game = await prisma.game.findUnique({
            where: { id: gameId },
            include: { tournament: true }
          });
          if (game?.tournament) {
            const bustedPlayers = state.players.filter(p => p.chips <= 0 && p.status === "ACTIVE");
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

          const savedPlayers = [...state.players];
          setTimeout(async () => {
            tableState.delete(gameId);

            savedPlayers.forEach(p => {
              const isEliminated = p.status === "ELIMINATED";
              prisma.player.update({
                where: { id: p.id },
                data: {
                  status: isEliminated ? "ELIMINATED" : "ACTIVE",
                  holeCards: "",
                  lastAction: null
                }
              }).catch(err => {
                if (err?.code === "P2025") return;
                console.error(`[POKER] Error resetting player ${p.id}:`, err);
              });
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

          // Do not set showdownActive so cards are not turned over (fold win, no showdown)
          state.showdownResults = {
            winners: [{ playerId: winner.id, userId: winner.userId, name: winnerName, potWon: totalPot }]
          };
          tableState.set(gameId, state);

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

          return;
        }

        await advanceToNextStreet(gameId, io);
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
        await moveToNextPlayer(gameId, io);
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
      console.error("player-action error", err);
      socket.emit("error", { message: err.message || "Action failed" });
    }
  });
}
