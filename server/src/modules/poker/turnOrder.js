import { prisma } from "../../config/database.js";
import { tableState, turnTimers, hasActiveHand, clearTableStateForGame } from "./tableState.js";
import { resetPlayerRowIfNotEliminated } from "./safeHandCleanupDb.js";
import { postDealerMessage } from "./dealerMessages.js";
import { emitGameState } from "./emitGameState.js";
import { emitIfTournamentCompleted, startHandForGame } from "../socket-handlers/pokerHandler.js";
import { startTurnTimer } from "./turnTimers.js";
import { cleanupHandAndStartNext } from "./handCleanup.js";
import { normalizeUserId } from "./normalizeUserId.js";
import { shouldBlockFoldWinPotAward } from "./foldWinGuard.js";

/** Prisma/JSON sometimes yields string seats; strict === skipped real players (zombie no-turn hands). */
function seatNum(s) {
  const n = Number(s);
  return Number.isFinite(n) ? n : NaN;
}

function playerCanBetThisRound(p) {
  return (
    p.status !== "ALL_IN" &&
    (p.chips ?? 0) > 0
  );
}

function computeNeedsToAct(p, state) {
  if (!playerCanBetThisRound(p)) return false;
  const currentBet = state.bettingRound?.currentBet || 0;
  const contribution = state.bettingRound?.getPlayerContribution(p.id) || 0;
  const hasActed = state.actedPlayersInRound?.has(normalizeUserId(p.userId));
  if (currentBet === 0) return !hasActed;
  return contribution < currentBet || !hasActed;
}

/** Anyone who can still bet and owes action or has not acted this round (used to unstick bad seat walks). */
function listPlayersWhoOweAction(activePlayers, state) {
  return activePlayers.filter((p) => computeNeedsToAct(p, state));
}

export async function moveToNextPlayer(gameId, io) {
  const state = tableState.get(gameId);
  if (!state) return;

  // Do NOT null currentTurnUserId here when the holder is all-in / 0 chips: that hits the
  // `!currentTurnUserId` branch below and incorrectly assigns the lowest seat instead of
  // orbiting from the player who just acted. Keep the turn id on the (non-active) player;
  // `currentPlayer` lookup against `activePlayers` misses them and the `!currentPlayer` branch
  // walks seats in order from that seat.

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
      await emitIfTournamentCompleted(game.tournament.id, io);
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
        "[POKER] One player left but hand already ended - clearing state and starting next hand"
      );
      cleanupHandAndStartNext(gameId, io, state, startHandForGame);
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
    if (await shouldBlockFoldWinPotAward(gameId)) {
      clearTableStateForGame(gameId);
      return;
    }
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
      // Always emit winner state for fold-wins, even if DB read is temporarily unavailable.
      await emitGameState(gameId, io, state);

      const game = await prisma.game
        .findUnique({
          where: { id: gameId },
          include: { players: { include: { user: true } }, tournament: true },
        })
        .catch(() => null);
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
        await emitIfTournamentCompleted(game.tournament.id, io);
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
      clearTableStateForGame(gameId);
      const resetPromises = savedPlayers
        .filter((p) => p.status !== "ELIMINATED" && p.chips > 0)
        .map((p) => resetPlayerRowIfNotEliminated(p.id).catch(() => {}));
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
    // No one left who can bet (everyone still in the hand is all-in or has 0 chips).
    // If we only null the turn, the hand becomes a zombie: street is set, no turn, hasActiveHand stays true
    // forever and the idle poll loops on "recovered no-turn active hand" (see Render logs).
    if (playersInHand.length >= 2 && state.bettingRound && !state.handEnded) {
      const activePlayerIds = state.players
        .filter((p) => p.status !== "FOLDED" && p.status !== "ELIMINATED")
        .map((p) => p.id);
      const bettingComplete = state.bettingRound.isBettingComplete(
        activePlayerIds,
        state.lastRaiseUserId,
        state.currentTurnUserId,
        state.players,
        state.actedPlayersInRound || new Set()
      );
      if (bettingComplete) {
        console.log(
          `[POKER] moveToNextPlayer: no players can bet but betting complete — advancing street/showdown (game ${gameId})`
        );
        tableState.set(gameId, state);
        try {
          if (state.street === "RIVER") {
            const { handleShowdown } = await import("./showdown.js");
            await handleShowdown(gameId, io);
          } else {
            const { advanceToNextStreet } = await import("./advanceStreet.js");
            await advanceToNextStreet(gameId, io);
          }
        } catch (e) {
          console.error(
            `[POKER] moveToNextPlayer: failed to advance all-in runout for ${gameId}:`,
            e?.message
          );
        }
        return;
      }
      console.warn(
        `[POKER] moveToNextPlayer: no one can bet but betting not complete (game ${gameId}) — leaving turn null`
      );
    }
    state.currentTurnUserId = null;
    state.currentTurnStartedAt = null;
    return;
  }

  if (!state.currentTurnUserId) {
    const sortedPlayers = [...activePlayers].sort(
      (a, b) => seatNum(a.seatNumber) - seatNum(b.seatNumber)
    );
    state.currentTurnUserId = normalizeUserId(sortedPlayers[0].userId);
    state.currentTurnStartedAt = Date.now();
    startTurnTimer(gameId, state.currentTurnUserId, io);
    return;
  }

  const allSeatNums = state.players
    .map((p) => seatNum(p.seatNumber))
    .filter(Number.isFinite);
  const minSeat = Math.min(...allSeatNums);
  const maxSeat = Math.max(...allSeatNums);

  const turnUid = normalizeUserId(state.currentTurnUserId);
  const currentPlayer = activePlayers.find(
    (p) => normalizeUserId(p.userId) === turnUid
  );

  if (!currentPlayer) {
    const allPlayersCurrent = state.players.find(
      (p) => normalizeUserId(p.userId) === turnUid
    );

    console.log(
      `[TURN ORDER] Current player not in active players. Looking for folded player: ${
        state.currentTurnUserId
      }, found: ${!!allPlayersCurrent}`
    );

    if (allPlayersCurrent) {
      const foldedSeat = seatNum(allPlayersCurrent.seatNumber);
      const seatMap = new Map();
      activePlayers.forEach((p) => {
        const sn = seatNum(p.seatNumber);
        if (Number.isFinite(sn)) seatMap.set(sn, p);
      });
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
          const needsToAct = computeNeedsToAct(playerAtSeat, state);
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

      // Seat walk can miss with sparse seats / edge cases — brute-force scan.
      if (!nextPlayer) {
        const owed = listPlayersWhoOweAction(activePlayers, state);
        if (owed.length > 0) {
          owed.sort((a, b) => seatNum(a.seatNumber) - seatNum(b.seatNumber));
          nextPlayer = owed[0];
          console.warn(
            `[TURN ORDER] After fold: seat walk missed; brute-force owed actor seat ${nextPlayer.seatNumber} (${nextPlayer.name || nextPlayer.userId})`
          );
        }
      }

      if (nextPlayer) {
        state.currentTurnUserId = normalizeUserId(nextPlayer.userId);
        state.currentTurnStartedAt = Date.now();
        startTurnTimer(gameId, state.currentTurnUserId, io);
        return;
      } else {
        console.log(
          `[TURN ORDER] No player needing to act found after folded player at seat ${foldedSeat}`
        );
      }
    }

    const owedFallback = listPlayersWhoOweAction(activePlayers, state);
    if (owedFallback.length > 0) {
      owedFallback.sort((a, b) => seatNum(a.seatNumber) - seatNum(b.seatNumber));
      const pick = owedFallback[0];
      state.currentTurnUserId = normalizeUserId(pick.userId);
      state.currentTurnStartedAt = Date.now();
      startTurnTimer(gameId, state.currentTurnUserId, io);
      console.log(
        `[TURN ORDER] Fallback: turn to player who still owes action — seat ${pick.seatNumber} (${pick.name || pick.userId})`
      );
      return;
    }

    console.log("[TURN ORDER] Falling back to first active player (no separate owed list)");
    const sortedPlayers = [...activePlayers].sort(
      (a, b) => seatNum(a.seatNumber) - seatNum(b.seatNumber)
    );
    if (sortedPlayers.length > 0) {
      state.currentTurnUserId = normalizeUserId(sortedPlayers[0].userId);
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

  const activeSeatNums = activePlayers
    .map((p) => seatNum(p.seatNumber))
    .filter(Number.isFinite);
  const minActiveSeat = Math.min(...activeSeatNums);
  const maxActiveSeat = Math.max(...activeSeatNums);

  let nextSeat = seatNum(currentPlayer.seatNumber) - 1;
  if (nextSeat < minActiveSeat) nextSeat = maxActiveSeat;

  let attempts = 0;
  let nextPlayer = null;
  const totalActiveSeats = maxActiveSeat - minActiveSeat + 1;

  while (attempts < totalActiveSeats) {
    const candidate = activePlayers.find(
      (p) => seatNum(p.seatNumber) === nextSeat
    );
    if (candidate && computeNeedsToAct(candidate, state)) {
      nextPlayer = candidate;
      break;
    }
    nextSeat = nextSeat - 1;
    if (nextSeat < minActiveSeat) nextSeat = maxActiveSeat;
    attempts++;
  }

  if (!nextPlayer) {
    // Fallback: orbit walk from current seat over anyone who still needs to act.
    const owed = activePlayers.filter((p) => computeNeedsToAct(p, state));
    if (owed.length > 0) {
      const owedSeats = new Set(
        owed.map((p) => seatNum(p.seatNumber)).filter(Number.isFinite)
      );
      const c = seatNum(currentPlayer.seatNumber);
      let s = c - 1;
      if (s < minActiveSeat) s = maxActiveSeat;
      for (let i = 0; i < totalActiveSeats + 1; i++) {
        if (owedSeats.has(s)) {
          nextPlayer = owed.find((p) => seatNum(p.seatNumber) === s) ?? null;
          break;
        }
        s -= 1;
        if (s < minActiveSeat) s = maxActiveSeat;
      }
      if (nextPlayer) {
        console.warn(
          `[TURN ORDER] Seat-walk missed next actor; orbit fallback seat ${seatNum(
            nextPlayer.seatNumber
          )} (${nextPlayer.name || nextPlayer.userId})`
        );
      }
    }
  }

  if (!nextPlayer) {
    const owedLast = listPlayersWhoOweAction(activePlayers, state);
    if (owedLast.length > 0) {
      owedLast.sort((a, b) => seatNum(a.seatNumber) - seatNum(b.seatNumber));
      nextPlayer = owedLast[0];
      console.warn(
        `[TURN ORDER] Last resort: assigning turn to owed player seat ${nextPlayer.seatNumber} (${nextPlayer.name || nextPlayer.userId}) — was about to null turn with betting incomplete`
      );
    }
  }

  if (!nextPlayer) {
    console.log(
      "[TURN ORDER] No next player needing to act found - betting round likely complete"
    );
    state.currentTurnUserId = null;
    state.currentTurnStartedAt = null;
    return;
  }

  state.currentTurnUserId = normalizeUserId(nextPlayer.userId);
  state.currentTurnStartedAt = Date.now();
  startTurnTimer(gameId, state.currentTurnUserId, io);
}

