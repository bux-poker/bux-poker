import { prisma } from "../../config/database.js";
import { tableState, turnTimers, hasActiveHand } from "./tableState.js";
import { postDealerMessage } from "./dealerMessages.js";
import { buildClientGameState } from "./buildClientGameState.js";
import { emitIfTournamentCompleted, startHandForGame } from "../socket-handlers/pokerHandler.js";
import { startTurnTimer } from "./turnTimers.js";

export async function moveToNextPlayer(gameId, io) {
  const state = tableState.get(gameId);
  if (!state) return;

  const hasActiveHandNow = hasActiveHand(gameId);

  if (!hasActiveHandNow) {
    const { TournamentEngine } = await import("../../services/TournamentEngine.js");
    const tournamentEngine = new TournamentEngine();

    const game = await prisma.game.findUnique({
      where: { id: gameId },
      include: { tournament: true },
    });

    const playersToEliminate = state.players.filter(
      (p) => p.chips <= 0 && p.status === "ACTIVE"
    );

    for (const player of playersToEliminate) {
      console.log(
        `[POKER] Eliminating player ${player.name || player.userId} with ${
          player.chips
        } chips (no active hand)`
      );
      player.status = "ELIMINATED";

      await prisma.player
        .update({
          where: { id: player.id },
          data: {
            status: "ELIMINATED",
            chips: 0,
          },
        })
        .catch((err) => {
          if (err?.code === "P2025") {
            console.log(
              `[POKER] Player ${player.id} already removed (consolidation), skipping eliminate`
            );
          } else {
            console.error(
              `[POKER] Error eliminating player ${player.id}:`,
              err
            );
          }
        });

      if (game?.tournament) {
        await tournamentEngine
          .onPlayerBust(game.tournament.id, player.id)
          .catch((err) => {
            console.error(
              "[POKER] Error notifying tournament of player bust:",
              err
            );
          });
      }
    }
    if (game?.tournament && io) {
      if (playersToEliminate.length > 0) {
        io.emit("tournament_updated", { tournamentId: game.tournament.id });
      }
      await emitIfTournamentCompleted(game.tournament.id, gameId, io);
    }
  } else {
    console.log(
      "[POKER] Active hand in progress - skipping elimination of players with 0 chips until hand completes"
    );
  }

  const activePlayers = state.players.filter(
    (p) =>
      p.status !== "FOLDED" &&
      p.status !== "ELIMINATED" &&
      p.status !== "ALL_IN" &&
      p.chips > 0
  );

  const playersInHand = state.players.filter(
    (p) => p.status !== "FOLDED" && p.status !== "ELIMINATED"
  );

  if (playersInHand.length === 1) {
    if (state.handEnded) {
      console.log(
        "[POKER] One player left but hand already ended - skipping award"
      );
      return;
    }
    const existingTimer = turnTimers.get(gameId);
    if (existingTimer) {
      clearTimeout(existingTimer.timerId);
      if (existingTimer.graceTimerId) clearTimeout(existingTimer.graceTimerId);
      turnTimers.delete(gameId);
    }
    const winner = playersInHand[0];
    const collectedPot = state.bettingRound?.getTotalPot() || 0;
    const totalPot = (state.pot || 0) + collectedPot;
    winner.chips += totalPot;
    state.pot = 0;
    state.handEnded = true;
    tableState.set(gameId, state);
    state.currentTurnUserId = null;
    state.currentTurnStartedAt = null;
    const winnerName =
      winner.name || winner.user?.username || `Player ${winner.seatNumber}`;
    console.log(
      `[POKER] One player left – awarding pot of ${totalPot} to ${winnerName}`
    );

    if (io) {
      postDealerMessage(
        gameId,
        io,
        `${winnerName} wins ${totalPot.toLocaleString()} (all other players folded)`
      );
      // Do not set showdownActive so cards are not turned over (fold win, no showdown)
      state.showdownResults = {
        winners: [
          {
            playerId: winner.id,
            userId: winner.userId,
            name: winnerName,
            potWon: totalPot,
          },
        ],
      };
      tableState.set(gameId, state);
      const game = await prisma.game
        .findUnique({
          where: { id: gameId },
          include: { players: { include: { user: true } }, tournament: true },
        })
        .catch(() => null);
      if (game) {
        io.to(`game:${gameId}`).emit(
          "game-state",
          buildClientGameState(game, state)
        );
      }
      io.to(`game:${gameId}`).emit("winner", {
        gameId,
        winners: [
          {
            playerId: winner.id,
            userId: winner.userId,
            name: winnerName,
            potWon: totalPot,
          },
        ],
      });
      if (game?.tournament?.id) {
        await emitIfTournamentCompleted(game.tournament.id, gameId, io);
      }
    }
    await prisma.player
      .update({ where: { id: winner.id }, data: { chips: winner.chips } })
      .catch(() => {});
    await prisma.game
      .update({ where: { id: gameId }, data: { pot: 0 } })
      .catch(() => {});

    setTimeout(() => {
      const savedPlayers = [...state.players];
      tableState.delete(gameId);
      const resetPromises = savedPlayers
        .filter((p) => p.status !== "ELIMINATED" && p.chips > 0)
        .map((p) =>
          prisma.player
            .update({
              where: { id: p.id },
              data: { status: "ACTIVE", holeCards: "", lastAction: null },
            })
            .catch(() => {})
        );
      Promise.all(resetPromises).then(async () => {
        const gameForNextHand = await prisma.game
          .findUnique({
            where: { id: gameId },
            include: {
              players: { include: { user: true } },
              tournament: true,
            },
          })
          .catch(() => null);
        if (
          gameForNextHand &&
          gameForNextHand.players.filter((p) => p.status === "ACTIVE")
            .length >= 2 &&
          io
        ) {
          try {
            await startHandForGame(gameId, io);
          } catch (err) {
            console.error(
              "[POKER] Error starting new hand after everyone-fold:",
              err
            );
          }
        }
      });
    }, 3000);
    return;
  }

  if (activePlayers.length === 0) {
    state.currentTurnUserId = null;
    state.currentTurnStartedAt = null;
    return;
  }

  if (!state.currentTurnUserId) {
    const sortedPlayers = [...activePlayers].sort(
      (a, b) => a.seatNumber - b.seatNumber
    );
    state.currentTurnUserId = sortedPlayers[0].userId;
    state.currentTurnStartedAt = Date.now();
    startTurnTimer(gameId, state.currentTurnUserId, io);
    return;
  }

  const allSeatNumbers = state.players.map((p) => p.seatNumber);
  const minSeat = Math.min(...allSeatNumbers);
  const maxSeat = Math.max(...allSeatNumbers);

  const currentPlayer = activePlayers.find(
    (p) => p.userId === state.currentTurnUserId
  );

  if (!currentPlayer) {
    const allPlayersCurrent = state.players.find(
      (p) => p.userId === state.currentTurnUserId
    );

    console.log(
      `[TURN ORDER] Current player not in active players. Looking for folded player: ${
        state.currentTurnUserId
      }, found: ${!!allPlayersCurrent}`
    );

    if (allPlayersCurrent) {
      const foldedSeat = allPlayersCurrent.seatNumber;
      const seatMap = new Map();
      activePlayers.forEach((p) => {
        seatMap.set(p.seatNumber, p);
      });
      const currentBet = state.bettingRound?.currentBet || 0;
      if (!state.actedPlayersInRound) {
        state.actedPlayersInRound = new Set();
      }

      let nextSeat = foldedSeat - 1;
      if (nextSeat < minSeat) nextSeat = maxSeat;

      let attempts = 0;
      let nextPlayer = null;
      const totalSeats = maxSeat - minSeat + 1;

      while (attempts < totalSeats) {
        const playerAtSeat = seatMap.get(nextSeat);
        if (playerAtSeat) {
          const contribution =
            state.bettingRound?.getPlayerContribution(playerAtSeat.id) || 0;
          const hasActed = state.actedPlayersInRound.has(playerAtSeat.userId);
          const isAllIn =
            playerAtSeat.status === "ALL_IN" || playerAtSeat.chips === 0;
          let needsToAct = false;
          if (!isAllIn) {
            needsToAct =
              currentBet === 0
                ? !hasActed
                : contribution < currentBet || !hasActed;
          }
          if (needsToAct) {
            nextPlayer = playerAtSeat;
            console.log(
              `[TURN ORDER] Found next player after folded (seat ${foldedSeat}): seat ${
                nextPlayer.seatNumber
              } (${nextPlayer.name || nextPlayer.userId}) needs to act`
            );
            break;
          }
        }
        nextSeat = nextSeat - 1;
        if (nextSeat < minSeat) nextSeat = maxSeat;
        attempts++;
      }

      if (nextPlayer) {
        state.currentTurnUserId = nextPlayer.userId;
        state.currentTurnStartedAt = Date.now();
        startTurnTimer(gameId, state.currentTurnUserId, io);
        return;
      } else {
        console.log(
          `[TURN ORDER] No player needing to act found after folded player at seat ${foldedSeat}`
        );
      }
    }

    console.log("[TURN ORDER] Falling back to first active player");
    const sortedPlayers = [...activePlayers].sort(
      (a, b) => a.seatNumber - b.seatNumber
    );
    if (sortedPlayers.length > 0) {
      state.currentTurnUserId = sortedPlayers[0].userId;
      state.currentTurnStartedAt = Date.now();
      startTurnTimer(gameId, state.currentTurnUserId, io);
      console.log(
        `[TURN ORDER] Set turn to first active player: seat ${
          sortedPlayers[0].seatNumber
        } (${sortedPlayers[0].name || sortedPlayers[0].userId})`
      );
    } else {
      console.log(
        "[TURN ORDER] No active players found, setting currentTurnUserId to null"
      );
      state.currentTurnUserId = null;
      state.currentTurnStartedAt = null;
    }
    return;
  }

  const seatNumbers = activePlayers.map((p) => p.seatNumber);
  const minActiveSeat = Math.min(...seatNumbers);
  const maxActiveSeat = Math.max(...seatNumbers);

  let nextSeat = currentPlayer.seatNumber - 1;
  if (nextSeat < minActiveSeat) nextSeat = maxActiveSeat;

  let attempts = 0;
  let nextPlayer = null;
  const totalActiveSeats = maxActiveSeat - minActiveSeat + 1;

  while (attempts < totalActiveSeats) {
    const candidate = activePlayers.find((p) => p.seatNumber === nextSeat);
    if (candidate) {
      const contribution =
        state.bettingRound?.getPlayerContribution(candidate.id) || 0;
      const currentBet = state.bettingRound?.currentBet || 0;
      const hasActed = state.actedPlayersInRound?.has(candidate.userId);
      let needsToAct = false;
      if (candidate.status !== "ALL_IN" && candidate.chips > 0) {
        needsToAct =
          currentBet === 0
            ? !hasActed
            : contribution < currentBet || !hasActed;
      }
      if (needsToAct) {
        nextPlayer = candidate;
        break;
      }
    }
    nextSeat = nextSeat - 1;
    if (nextSeat < minActiveSeat) nextSeat = maxActiveSeat;
    attempts++;
  }

  if (!nextPlayer) {
    console.log(
      "[TURN ORDER] No next player needing to act found - betting round likely complete"
    );
    state.currentTurnUserId = null;
    state.currentTurnStartedAt = null;
    return;
  }

  state.currentTurnUserId = nextPlayer.userId;
  state.currentTurnStartedAt = Date.now();
  startTurnTimer(gameId, state.currentTurnUserId, io);
}

