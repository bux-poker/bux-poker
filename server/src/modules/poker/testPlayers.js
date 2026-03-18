import { tableState, turnTimers } from "./tableState.js";
import { applyPlayerAction } from "./actions.js";
import { buildClientGameState } from "./buildClientGameState.js";
import { moveToNextPlayer } from "./turnOrder.js";
import { advanceToNextStreet } from "./advanceStreet.js";
import { handleShowdownCore } from "./showdown.js";
import { emitIfTournamentCompleted } from "./tableTournamentHooks.js";
import { prisma } from "../../config/database.js";

export async function handleTestPlayerAction(gameId, userId, io) {
  try {
    console.log(`[POKER] handleTestPlayerAction called for userId: ${userId}`);
    const state = tableState.get(gameId);
    if (!state) {
      console.log(
        `[POKER] No state found for gameId: ${gameId} - game may have ended or new hand starting`
      );
      const existingTimer = turnTimers.get(gameId);
      if (existingTimer) {
        clearTimeout(existingTimer.timerId);
        if (existingTimer.graceTimerId) {
          clearTimeout(existingTimer.graceTimerId);
        }
        turnTimers.delete(gameId);
      }
      return;
    }

    if (state.currentTurnUserId !== userId) {
      console.log(
        `[POKER] handleTestPlayerAction: It's no longer ${userId}'s turn (currentTurn=${state.currentTurnUserId}). State may have changed.`
      );
      const existingTimer = turnTimers.get(gameId);
      if (existingTimer) {
        clearTimeout(existingTimer.timerId);
        if (existingTimer.graceTimerId) {
          clearTimeout(existingTimer.graceTimerId);
        }
        turnTimers.delete(gameId);
      }

      if (!state.currentTurnUserId) {
        console.log(
          "[POKER] No current turn - attempting to move to next player"
        );
        try {
          await moveToNextPlayer(gameId, io);
        } catch (err) {
          console.error(
            "[POKER] Error in moveToNextPlayer after stale timer:",
            err
          );
        }
      }
      return;
    }

    const player = state.players.find((p) => p.userId === userId);
    if (!player) {
      console.log(
        `[POKER] Player not found in state for userId: ${userId} - they may have been eliminated`
      );
      const existingTimer = turnTimers.get(gameId);
      if (existingTimer) {
        clearTimeout(existingTimer.timerId);
        if (existingTimer.graceTimerId) {
          clearTimeout(existingTimer.graceTimerId);
        }
        turnTimers.delete(gameId);
      }
      try {
        await moveToNextPlayer(gameId, io);
      } catch (err) {
        console.error(
          "[POKER] Error moving to next player after player not found:",
          err
        );
      }
      return;
    }
    if (player.status === "FOLDED" || player.status === "ELIMINATED") {
      console.log(
        `[POKER] Player ${player.name || userId} is already ${
          player.status
        }, skipping action`
      );
      const existingTimer = turnTimers.get(gameId);
      if (existingTimer) {
        clearTimeout(existingTimer.timerId);
        if (existingTimer.graceTimerId) {
          clearTimeout(existingTimer.graceTimerId);
        }
        turnTimers.delete(gameId);
      }
      try {
        await moveToNextPlayer(gameId, io);
      } catch (err) {
        console.error(
          `[POKER] Error moving to next player after ${player.status} player:`,
          err
        );
      }
      return;
    }
    if (player.chips === 0 || player.status === "ALL_IN") {
      console.log(
        `[POKER] Test player ${
          player.name || userId
        } is all-in (0 chips), skipping action and advancing`
      );
      if (player.status !== "ALL_IN") player.status = "ALL_IN";
      state.actedPlayersInRound.add(userId);
      tableState.set(gameId, state);
      const existingTimer = turnTimers.get(gameId);
      if (existingTimer) {
        clearTimeout(existingTimer.timerId);
        if (existingTimer.graceTimerId) clearTimeout(existingTimer.graceTimerId);
        turnTimers.delete(gameId);
      }
      try {
        await moveToNextPlayer(gameId, io);
      } catch (err) {
        console.error(
          "[POKER] Error moving to next player after all-in:",
          err
        );
      }
      return;
    }

    console.log(
      `[POKER] Test player ${player.name || userId} is acting...`
    );

    const currentBet = state.bettingRound?.currentBet || 0;
    const bigBlind = state.bettingRound?.bigBlind || 20;
    const myChips = player.chips;
    const myContribution =
      state.bettingRound?.getPlayerContribution(player.id) || 0;
    const amountToCall = currentBet - myContribution;
    const canCheck = amountToCall === 0;

    const rand = Math.random();

    let action, amount;

    if (canCheck) {
      if (rand < 0.6) {
        action = "CHECK";
        amount = 0;
        console.log(
          `[POKER] Test player ${
            player.name || userId
          } decided to CHECK (rand=${rand.toFixed(2)})`
        );
      } else {
        const minRaiseAmount =
          currentBet + (state.bettingRound?.minimumRaise || bigBlind);
        const halfPot = Math.floor((state.pot || 0) / 2);
        const totalBetAmount = Math.max(minRaiseAmount, halfPot);

        const additionalAmount = totalBetAmount - myContribution;
        amount = Math.min(Math.max(additionalAmount, 0), myChips);

        if (currentBet === 0) {
          action = "BET";
          console.log(
            `[POKER] Test player ${
              player.name || userId
            } decided to BET ${amount} (rand=${rand.toFixed(2)})`
          );
        } else {
          action = "RAISE";
          console.log(
            `[POKER] Test player ${
              player.name || userId
            } decided to RAISE ${amount} (total bet would be ${
              myContribution + amount
            }) (rand=${rand.toFixed(2)})`
          );
        }
      }
    } else {
      if (rand < 0.3) {
        action = "FOLD";
        amount = 0;
        console.log(
          `[POKER] Test player ${
            player.name || userId
          } decided to FOLD (rand=${rand.toFixed(2)})`
        );
      } else if (rand < 0.7) {
        action = "CALL";
        amount = Math.min(amountToCall, myChips);
        console.log(
          `[POKER] Test player ${
            player.name || userId
          } decided to CALL ${amount} (rand=${rand.toFixed(2)})`
        );
      } else {
        const minimumRaise =
          state.bettingRound?.minimumRaise || bigBlind;
        const minRaiseAmount = currentBet + minimumRaise;
        const halfPot = Math.floor((state.pot || 0) / 2);
        const totalBetAmount = Math.max(minRaiseAmount, halfPot);

        const additionalAmount = totalBetAmount - myContribution;

        const minAdditionalForRaise =
          currentBet > 0
            ? Math.max(
                minimumRaise,
                currentBet + minimumRaise - myContribution
              )
            : minimumRaise;

        if (myChips < minAdditionalForRaise) {
          action = "CALL";
          amount = Math.min(amountToCall, myChips);
          console.log(
            `[POKER] Test player ${
              player.name || userId
            } doesn't have enough chips for raise, calling ${amount} instead (rand=${rand.toFixed(
              2
            )})`
          );
        } else {
          amount = Math.min(
            Math.max(additionalAmount, minAdditionalForRaise),
            myChips
          );

          if (currentBet === 0) {
            action = "BET";
            console.log(
              `[POKER] Test player ${
                player.name || userId
              } decided to BET ${amount} (rand=${rand.toFixed(2)})`
            );
          } else {
            action = "RAISE";
            console.log(
              `[POKER] Test player ${
                player.name || userId
              } decided to RAISE ${amount} (total bet would be ${
                myContribution + amount
              }, minRaise=${minimumRaise}, rand=${rand.toFixed(2)})`
            );
          }
        }
      }
    }

    let newState;
    try {
      newState = await applyPlayerAction({
        gameId,
        userId,
        action,
        amount,
        io,
      });
    } catch (error) {
      if (
        (action === "RAISE" || action === "BET") &&
        (error.message?.includes("Raise below minimum raise size") ||
          error.message?.includes("Insufficient chips"))
      ) {
        console.log(
          `[TEST PLAYER] ${action} failed for ${
            player.name || userId
          }: ${error.message}. Falling back to CALL.`
        );
        action = "CALL";
        amount = Math.min(amountToCall, myChips);
        newState = await applyPlayerAction({
          gameId,
          userId,
          action,
          amount,
          io,
        });
      } else {
        throw error;
      }
    }

    // Use same definition as playerAction: all non-folded, non-eliminated (include ALL_IN).
    // Excluding ALL_IN here could shrink activePlayerIds to 1 and make isBettingComplete return true,
    // advancing to flop with unequal bets.
    const activePlayerIds = newState.players
      .filter(
        (p) => p.status !== "FOLDED" && p.status !== "ELIMINATED"
      )
      .map((p) => p.id);

    console.log(
      `[TEST PLAYER] Checking betting complete after ${action} by ${
        player.name || userId
      }`
    );
    console.log(
      `[TEST PLAYER] Active players: ${
        activePlayerIds.length
      }, lastRaiseUserId=${
        newState.lastRaiseUserId || "null"
      }, currentTurnUserId=${newState.currentTurnUserId || "null"}`
    );

    const bettingComplete = newState.bettingRound?.isBettingComplete(
      activePlayerIds,
      newState.lastRaiseUserId,
      newState.currentTurnUserId,
      newState.players,
      newState.actedPlayersInRound || new Set()
    );

    console.log(`[TEST PLAYER] Betting complete? ${bettingComplete}`);

    const activePlayersAfterAction = newState.players.filter(
      (p) => p.status !== "FOLDED" && p.status !== "ELIMINATED"
    );

    if (!bettingComplete) {
      console.log(
        "[TEST PLAYER] Betting not complete, moving to next player..."
      );
      console.log(
        `[TEST PLAYER] Active players after action: ${activePlayersAfterAction.length}`
      );

      try {
        await moveToNextPlayer(gameId, io);
      } catch (moveError) {
        console.error(
          "[TEST PLAYER] ERROR in recovery moveToNextPlayer:",
          moveError
        );
      }
    } else {
      console.log(
        "[TEST PLAYER] Multiple players remaining, advancing to next street or showdown..."
      );
      console.log(
        `[TEST PLAYER] Current street: ${newState.street || "PREFLOP"}`
      );

      try {
        if (newState.street === "RIVER") {
          console.log(
            "[TEST PLAYER] On RIVER - going to showdown"
          );
          await handleShowdownCore(gameId, io, {});
        } else {
          console.log(
            `[TEST PLAYER] Advancing from ${
              newState.street || "PREFLOP"
            } to next street`
          );
          await advanceToNextStreet(gameId, io);
        }

        const latestState = tableState.get(gameId);
        if (!latestState) {
          console.error(
            "[TEST PLAYER] ERROR: State missing after advancing street!"
          );
        } else {
          const game = await prisma.game
            .findUnique({
              where: { id: gameId },
              include: {
                players: { include: { user: true } },
                tournament: true,
              },
            })
            .catch(() => null);
          if (game && io) {
            const payload = buildClientGameState(game, latestState);
            io.to(`game:${gameId}`).emit("game-state", payload);
            console.log(
              "[TEST PLAYER] Emitted game state after advancing street/showdown"
            );
            if (game.tournament?.id) {
              await emitIfTournamentCompleted(
                game.tournament.id,
                io
              );
            }
          } else {
            console.error(
              "[TEST PLAYER] ERROR: Could not fetch game or state after advancing street!"
            );
          }
        }
      } catch (advanceError) {
        console.error(
          "[TEST PLAYER] ERROR advancing to next street/showdown:",
          advanceError
        );
        console.error(
          "[TEST PLAYER] Error stack:",
          advanceError.stack
        );
      }
    }
  } catch (err) {
    console.error("[POKER] Error handling test player action:", err);
  }
}

