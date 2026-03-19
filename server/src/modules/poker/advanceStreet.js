import { prisma } from "../../config/database.js";
import { TexasHoldem } from "./TexasHoldem.js";
import { tableState, turnTimers } from "./tableState.js";
import { postDealerMessage } from "./dealerMessages.js";
import { buildClientGameState } from "./buildClientGameState.js";
import { emitIfTournamentCompleted, startHandForGame } from "../socket-handlers/pokerHandler.js";
import { handleShowdown, runCinematicAllInShowdown } from "./showdown.js";
import { cleanupHandAndStartNext } from "./handCleanup.js";
import { startTurnTimer } from "./turnTimers.js";

export async function advanceToNextStreet(gameId, io) {
  console.log(`[POKER] advanceToNextStreet called for gameId: ${gameId}`);
  const state = tableState.get(gameId);
  if (!state) {
    console.error(
      `[POKER] ERROR: No state found for gameId ${gameId} in advanceToNextStreet`
    );
    return;
  }

  if (state.handEnded) {
    console.log("[POKER] advanceToNextStreet: Hand already ended, skipping (avoid double run)");
    return;
  }

  const activePlayers = state.players.filter(
    (p) => p.status !== "FOLDED" && p.status !== "ELIMINATED"
  );
  console.log(
    `[POKER] advanceToNextStreet: Current street: ${state.street || "PREFLOP"}, active players: ${activePlayers.length}`
  );

  // Guard: never advance with unequal contributions (e.g. 100 vs 150). Catches callers that wrongly said "betting complete".
  const round = state.bettingRound;
  if (round && activePlayers.length >= 2) {
    const contributions = activePlayers.map((p) => ({
      id: p.id,
      contribution: round.getPlayerContribution(p.id),
      chips: p.chips || 0,
    }));
    const maxContrib = Math.max(...contributions.map((c) => c.contribution));
    const allEqualOrAllIn = contributions.every(
      (c) => c.contribution === maxContrib || c.chips === 0
    );
    if (!allEqualOrAllIn) {
      const contribStr = contributions
        .map((c) => `${c.chips === 0 ? "ALL-IN" : c.contribution}`)
        .join(", ");
      console.error(
        `[POKER] advanceToNextStreet: REFUSING – contributions not equal (max=${maxContrib}). [${contribStr}]. Not advancing.`
      );
      return;
    }
  }

  state.currentTurnUserId = null;
  state.currentTurnStartedAt = null;

  const existingTimer = turnTimers.get(gameId);
  if (existingTimer) {
    clearTimeout(existingTimer.timerId);
    if (existingTimer.graceTimerId) {
      clearTimeout(existingTimer.graceTimerId);
    }
    turnTimers.delete(gameId);
    console.log("[POKER] advanceToNextStreet: Cleared existing turn timer");
  }

  const smallBlind = state.bettingRound?.smallBlind || 10;
  const bigBlind = state.bettingRound?.bigBlind || 20;
  const engine = new TexasHoldem({ smallBlind, bigBlind });

  const collectedPot = state.bettingRound.getTotalPot();
  const oldPot = state.pot || 0;
  state.pot = oldPot + collectedPot;

  state.players.forEach((player) => {
    const currentContribution =
      state.bettingRound.getPlayerContribution(player.id);
    player.contributions = (player.contributions || 0) + currentContribution;
  });

  state.bettingRound.playerBets.clear();
  state.bettingRound.currentBet = 0;
  state.lastRaiseUserId = null;
  state.actedPlayersInRound = new Set();

  const activePlayerIds = activePlayers.map((p) => p.id);
  const allPlayersAllIn = state.bettingRound.areAllPlayersAllIn(
    activePlayerIds,
    state.players
  );

  const playersWithChips = activePlayers.filter((p) => p.chips > 0);

  // One player left (everyone else folded) – award pot and start next hand. Must run BEFORE shouldAutoShowdown,
  // otherwise we hit runCinematicAllInShowdown which returns when activePlayers.length < 2 and the pot is never awarded.
  if (activePlayers.length === 1 && !state.handEnded) {
    const winner = activePlayers[0];
    const totalPot = state.pot;
    winner.chips += totalPot;
    state.pot = 0;
    state.handEnded = true;
    state.currentTurnUserId = null;
    state.currentTurnStartedAt = null;
    tableState.set(gameId, state);

    const winnerName =
      winner.name || winner.user?.username || `Player ${winner.seatNumber}`;
    console.log(
      `[POKER] advanceToNextStreet: One player left – awarding pot of ${totalPot} to ${winnerName}`
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
    }

    await prisma.player
      .update({ where: { id: winner.id }, data: { chips: winner.chips } })
      .catch((err) => {
        if (err?.code === "P2025") {
          console.log(
            `[POKER] Player ${winner.id} already removed (consolidation), skipping chip update`
          );
        } else {
          console.error(`[POKER] Error updating chips for player ${winner.id}:`, err);
        }
      });
    await prisma.game
      .update({ where: { id: gameId }, data: { pot: 0 } })
      .catch((err) =>
        console.error("[POKER] Error updating game pot:", err)
      );

    if (io) {
      const gameForEmit = await prisma.game
        .findUnique({
          where: { id: gameId },
          include: {
            players: { include: { user: true } },
            tournament: true,
          },
        })
        .catch(() => null);
      if (gameForEmit) {
        io.to(`game:${gameId}`).emit(
          "game-state",
          buildClientGameState(gameForEmit, state)
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
      if (gameForEmit?.tournament?.id) {
        await emitIfTournamentCompleted(gameForEmit.tournament.id, io);
      }
    }

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
            .catch((err) => {
              if (err?.code === "P2025") return;
              console.error(`[POKER] Error resetting player ${p.id}:`, err);
            })
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
          gameForNextHand.players.filter((p) => p.status === "ACTIVE").length >=
            2 &&
          io
        ) {
          try {
            await startHandForGame(gameId, io);
          } catch (err) {
            console.error(
              "[POKER] Error starting new hand after one-player-left:",
              err
            );
          }
        }
      });
    }, 3000);
    return;
  }

  const shouldAutoShowdown =
    allPlayersAllIn || playersWithChips.length === 1;
  if (shouldAutoShowdown && io) {
    await runCinematicAllInShowdown(gameId, io, state, engine, allPlayersAllIn);
    return;
  }

  if (state.street === "PREFLOP") {
    const { deck: newDeck, cards: flopCards } = engine.dealFlop(state.deck);
    state.deck = newDeck;
    state.communityCards = flopCards;
    state.street = "FLOP";
    postDealerMessage(gameId, io, "Dealing the flop...");
  } else if (state.street === "FLOP") {
    const { deck: newDeck, card: turnCard } = engine.dealTurnOrRiver(
      state.deck
    );
    state.deck = newDeck;
    state.communityCards = [...state.communityCards, turnCard];
    state.street = "TURN";
    postDealerMessage(gameId, io, "Dealing the turn...");
  } else if (state.street === "TURN") {
    const { deck: newDeck, card: riverCard } = engine.dealTurnOrRiver(
      state.deck
    );
    state.deck = newDeck;
    state.communityCards = [...state.communityCards, riverCard];
    state.street = "RIVER";
    postDealerMessage(gameId, io, "Dealing the river...");
  } else if (state.street === "RIVER") {
    await handleShowdown(gameId, io);
    return;
  }

  if (activePlayers.length === 0) {
    if (state.handEnded) {
      console.log(
        "[POKER] advanceToNextStreet: All folded but hand already ended - clearing state and starting next hand"
      );
      cleanupHandAndStartNext(gameId, io, state, startHandForGame);
      return;
    }
    console.log(
      "[POKER] advanceToNextStreet: All players folded - finding last player who didn't fold to award pot"
    );

    const allPlayers = state.players.filter(
      (p) => p.status !== "ELIMINATED"
    );
    if (allPlayers.length > 0) {
      const bbPlayer = allPlayers.find((p) => {
        const contribution =
          state.bettingRound?.getPlayerContribution(p.id) || 0;
        return contribution > 0;
      });

      if (bbPlayer) {
        const totalPot = state.pot;
        bbPlayer.chips += totalPot;
        state.pot = 0;
        state.handEnded = true;
        tableState.set(gameId, state);

        const winnerName =
          bbPlayer.name ||
          bbPlayer.user?.username ||
          `Player ${bbPlayer.seatNumber}`;
        console.log(
          `[POKER] All players folded - awarding pot of ${totalPot} to ${winnerName} (big blind)`
        );

        if (io) {
          postDealerMessage(
            gameId,
            io,
            `${winnerName} wins ${totalPot.toLocaleString()} (all other players folded)`
          );
          state.showdownActive = true;
          state.showdownResults = {
            winners: [
              {
                playerId: bbPlayer.id,
                userId: bbPlayer.userId,
                name: winnerName,
                potWon: totalPot,
              },
            ],
          };
          tableState.set(gameId, state);
        }

        await prisma.player
          .update({
            where: { id: bbPlayer.id },
            data: { chips: bbPlayer.chips },
          })
          .catch((err) => {
            if (err?.code === "P2025") {
              console.log(
                `[POKER] Player ${bbPlayer.id} already removed (consolidation), skipping chip update`
              );
            } else {
              console.error(
                `[POKER] Error updating chips for player ${bbPlayer.id}:`,
                err
              );
            }
          });
        await prisma.game
          .update({
            where: { id: gameId },
            data: { pot: 0 },
          })
          .catch((err) =>
            console.error("[POKER] Error updating game pot:", err)
          );

        if (io) {
          const gameForEmit = await prisma.game
            .findUnique({
              where: { id: gameId },
              include: {
                players: { include: { user: true } },
                tournament: true,
              },
            })
            .catch(() => null);
          if (gameForEmit) {
            io.to(`game:${gameId}`).emit(
              "game-state",
              buildClientGameState(gameForEmit, state)
            );
          }
          io.to(`game:${gameId}`).emit("winner", {
            gameId,
            winners: [
              {
                playerId: bbPlayer.id,
                userId: bbPlayer.userId,
                name: winnerName,
                potWon: totalPot,
              },
            ],
          });
          if (gameForEmit?.tournament?.id) {
            await emitIfTournamentCompleted(gameForEmit.tournament.id, io);
          }
        }

        setTimeout(() => {
          const savedPlayers = [...state.players];
          tableState.delete(gameId);

          const resetPromises = savedPlayers
            .filter((p) => p.status !== "ELIMINATED" && p.chips > 0)
            .map((p) => {
              return prisma.player
                .update({
                  where: { id: p.id },
                  data: {
                    status: "ACTIVE",
                    holeCards: "",
                    lastAction: null,
                  },
                })
                .catch((err) => {
                  if (err?.code === "P2025") return;
                  console.error(
                    `[POKER] Error resetting player ${p.id}:`,
                    err
                  );
                });
            });

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
                .length >= 2
            ) {
              if (io) {
                try {
                  await startHandForGame(gameId, io);
                } catch (err) {
                  console.error(
                    "[POKER] Error starting new hand after all-fold:",
                    err
                  );
                }
              }
            }
          });
        }, 3000);

        return;
      }
    }

    console.error(
      "[POKER] CRITICAL ERROR: All players folded but could not find player to award pot!"
    );
    state.currentTurnUserId = null;
    state.currentTurnStartedAt = null;
    return;
  }

  if (activePlayers.length > 1) {
    // First to act post-flop/turn/river = first active player left of button (so client enables that player's action buttons).
    // Bug: we used to never set currentTurnUserId here, so seat-3 (left of dealer 4) never got the turn and their buttons stayed disabled.
    const dealerSeat = state.dealerSeat ?? Math.min(...state.players.map((p) => p.seatNumber));
    const sorted = [...activePlayers].sort((a, b) => a.seatNumber - b.seatNumber);
    const leftOfDealer = sorted.filter((p) => p.seatNumber < dealerSeat);
    const firstToAct =
      leftOfDealer.length > 0 ? leftOfDealer[leftOfDealer.length - 1] : sorted[sorted.length - 1];
    state.currentTurnUserId = firstToAct.userId;
    state.currentTurnStartedAt = Date.now();
    tableState.set(gameId, state);
    if (io) {
      startTurnTimer(gameId, state.currentTurnUserId, io);
      const name = firstToAct.name || firstToAct.user?.username || firstToAct.userId;
      console.log(
        `[POKER] advanceToNextStreet: First to act on ${state.street} is seat ${firstToAct.seatNumber} (${name}) – currentTurnUserId set so client enables buttons`
      );
      const game = await prisma.game
        .findUnique({
          where: { id: gameId },
          include: { players: { include: { user: true } }, tournament: true },
        })
        .catch(() => null);
      if (game) {
        const payload = buildClientGameState(game, state);
        io.to(`game:${gameId}`).emit("game-state", payload);
        console.log(
          `[POKER] advanceToNextStreet: Emitted game state for street ${state.street}`
        );
      } else {
        console.error(
          "[POKER] ERROR: Could not emit game state in advanceToNextStreet - game not found"
        );
      }
    }
  }
}

