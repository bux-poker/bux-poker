import { tableState, turnTimers } from "./tableState.js";
import { buildClientGameState } from "./buildClientGameState.js";
import { applyPlayerAction } from "./actions.js";
import { advanceToNextStreet } from "./advanceStreet.js";
import { moveToNextPlayer } from "./turnOrder.js";
import { handleShowdown } from "./showdown.js";
import { handleTestPlayerAction } from "./testPlayers.js";
import { postDealerMessage } from "./dealerMessages.js";
import { prisma } from "../../config/database.js";

export function startTurnTimer(gameId, userId, io) {
  const existingTimer = turnTimers.get(gameId);
  if (existingTimer) {
    clearTimeout(existingTimer.timerId);
    if (existingTimer.graceTimerId) {
      clearTimeout(existingTimer.graceTimerId);
    }
    turnTimers.delete(gameId);
  }

  const state = tableState.get(gameId);
  if (!state) return;

  const player = state.players.find((p) => p.userId === userId);
  if (!player) return;

  const playerName = player.name || player.user?.username || "";
  const isTestPlayer = playerName.toLowerCase().startsWith("test player");

  console.log(
    `[POKER] startTurnTimer for player ${playerName} (userId: ${userId}): isTestPlayer=${isTestPlayer}`
  );

  if (!io) {
    console.error(
      `[POKER] Cannot start turn timer: io is null for gameId ${gameId}`
    );
    return;
  }

  if (isTestPlayer) {
    const timeoutMs = 3000;
    const expiresAt = Date.now() + timeoutMs;

    console.log(
      `[POKER] Starting 3-second timer for test player ${playerName}, will call handleTestPlayerAction`
    );

    const timerId = setTimeout(async () => {
      turnTimers.delete(gameId);

      console.log(
        `[POKER] Timer expired for test player ${playerName} (userId: ${userId})`
      );

      const currentState = tableState.get(gameId);
      if (!currentState) {
        console.error(
          `[POKER] State missing when timer fired for test player ${playerName}, gameId: ${gameId}`
        );
        return;
      }

      if (currentState.currentTurnUserId !== userId) {
        console.log(
          `[POKER] Timer fired for test player ${playerName} but it's no longer their turn (currentTurn=${currentState.currentTurnUserId}).`
        );
        if (currentState.currentTurnUserId) {
          const nextPlayer = currentState.players.find(
            (p) => p.userId === currentState.currentTurnUserId
          );
          if (nextPlayer && !turnTimers.has(gameId)) {
            console.log(
              `[POKER] Starting timer for current turn holder ${
                nextPlayer.name || currentState.currentTurnUserId
              } (hand was stuck)`
            );
            startTurnTimer(gameId, currentState.currentTurnUserId, io);
          }
        }
        if (!currentState.currentTurnUserId) {
          console.log(
            "[POKER] No current turn - checking if betting is complete and advancing if needed"
          );
          const activePlayerIds = currentState.players
            .filter(
              (p) => p.status !== "FOLDED" && p.status !== "ELIMINATED"
            )
            .map((p) => p.id);

          const bettingComplete = currentState.bettingRound?.isBettingComplete(
            activePlayerIds,
            currentState.lastRaiseUserId,
            currentState.currentTurnUserId,
            currentState.players,
            currentState.actedPlayersInRound || new Set()
          );

          if (bettingComplete && currentState.street) {
            if (currentState.street === "RIVER") {
              await handleShowdown(gameId, io);
            } else {
              await advanceToNextStreet(gameId, io);
            }
          } else if (!bettingComplete) {
            await moveToNextPlayer(gameId, io);
          }
        }

        turnTimers.delete(gameId);
        return;
      }

      const currentPlayer = currentState.players.find(
        (p) => p.userId === userId
      );
      if (!currentPlayer) {
        console.error(
          `[POKER] Player not found in state when timer fired for userId: ${userId}`
        );
        turnTimers.delete(gameId);
        try {
          await moveToNextPlayer(gameId, io);
        } catch (moveErr) {
          console.error(
            "[POKER] Error moving to next player after player not found:",
            moveErr
          );
        }
        return;
      }

      await handleTestPlayerAction(gameId, userId, io);
      turnTimers.delete(gameId);
    }, timeoutMs);

    turnTimers.set(gameId, { timerId, userId, expiresAt, duration: timeoutMs });

    io.to(`game:${gameId}`).emit("turn-timer-start", {
      gameId,
      userId,
      expiresAt,
      duration: timeoutMs,
    });
  } else {
    const gracePeriodMs = 10000;
    const countdownMs = 10000;
    const totalTimeoutMs = gracePeriodMs + countdownMs;
    const expiresAt = Date.now() + totalTimeoutMs;

    const graceTimerId = setTimeout(() => {
      io.to(`game:${gameId}`).emit("turn-timer-start", {
        gameId,
        userId,
        expiresAt,
        duration: countdownMs,
      });
    }, gracePeriodMs);

    const timeoutTimerId = setTimeout(() => {
      autoFoldPlayer(gameId, userId, io);
    }, totalTimeoutMs);

    turnTimers.set(gameId, {
      timerId: timeoutTimerId,
      graceTimerId,
      userId,
      expiresAt,
      duration: countdownMs,
      gracePeriodMs,
    });
  }
}

async function autoFoldPlayer(gameId, userId, io) {
  try {
    const state = tableState.get(gameId);
    if (!state || state.currentTurnUserId !== userId) {
      console.log(
        `[POKER] autoFoldPlayer: skipping – not ${userId}'s turn (currentTurn=${state?.currentTurnUserId})`
      );
      if (state?.currentTurnUserId) {
        startTurnTimer(gameId, state.currentTurnUserId, io);
      }
      return;
    }

    const player = state.players.find((p) => p.userId === userId);
    const playerName = player?.name || player?.user?.username || "";
    const isTestPlayer = playerName.toLowerCase().startsWith("test player");
    if (!isTestPlayer) {
      console.log(
        `[POKER] autoFoldPlayer: skipping – ${playerName || userId} is a human player; never auto-fold. Restarting turn timer.`
      );
      startTurnTimer(gameId, userId, io);
      return;
    }

    let stateAfter;
    try {
      stateAfter = await applyPlayerAction({
        gameId,
        userId,
        action: "FOLD",
        amount: 0,
        io,
      });
    } catch (err) {
      if (err?.message === "All-in players cannot act") {
        await moveToNextPlayer(gameId, io);
        return;
      }
      throw err;
    }

    const game = await prisma.game.findUnique({
      where: { id: gameId },
      include: {
        players: {
          include: { user: true },
        },
      },
    });

    if (!game) return;

    await moveToNextPlayer(gameId, io);

    const stateNow = tableState.get(gameId);
    const payload = buildClientGameState(game, stateNow || stateAfter);
    io.to(`game:${gameId}`).emit("game-state", payload);
  } catch (err) {
    console.error("[POKER] Error auto-folding player:", err);
  }
}

