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
  const state = tableState.get(gameId);
  if (!state) return;

  const existingTimer = turnTimers.get(gameId);
  if (existingTimer) {
    clearTimeout(existingTimer.timerId);
    if (existingTimer.graceTimerId) {
      clearTimeout(existingTimer.graceTimerId);
    }
    turnTimers.delete(gameId);
  }

  const player = state.players.find((p) => p.userId === userId);
  if (!player) return;

  const playerName = player.name || player.user?.username || "";
  const isTestPlayer =
    (player.user?.email || "").toLowerCase().endsWith("@test.buxpoker.local") ||
    playerName.toLowerCase().startsWith("test player");

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
    // Human timing policy:
    // - 20s total action window on the backend
    // - show UI countdown only for the final 10s
    const totalActionMs = 20000;
    const autoActionExpiresAt = Date.now() + totalActionMs;
    const timeoutTimerId = setTimeout(() => {
      autoFoldPlayer(gameId, userId, io, timeoutTimerId);
    }, totalActionMs);

    // Emit immediately so client always has a timer anchor; client renders only last 10s for humans.
    io.to(`game:${gameId}`).emit("turn-timer-start", {
      gameId,
      userId,
      expiresAt: autoActionExpiresAt,
      duration: totalActionMs,
    });

    turnTimers.set(gameId, {
      timerId: timeoutTimerId,
      userId,
      expiresAt: autoActionExpiresAt,
      duration: totalActionMs,
    });
  }
}

async function autoFoldPlayer(gameId, userId, io, timerId) {
  try {
    const uidStr = String(userId);
    const timerState = turnTimers.get(gameId);
    // Guard against stale timer callbacks from previous turns.
    if (
      !timerState ||
      timerState.timerId !== timerId ||
      String(timerState.userId) !== uidStr
    ) {
      return;
    }
    // If the OS/event loop fires slightly before expiresAt, retry at the real deadline (old code returned and never folded).
    const msUntilExpiry = (timerState.expiresAt || 0) - Date.now();
    if (msUntilExpiry > 0) {
      setTimeout(() => {
        autoFoldPlayer(gameId, userId, io, timerId);
      }, msUntilExpiry);
      return;
    }

    // Release this turn's slot before actions / moveToNextPlayer (which starts a new timer).
    turnTimers.delete(gameId);

    const state = tableState.get(gameId);
    const turnStr =
      state?.currentTurnUserId != null ? String(state.currentTurnUserId) : "";
    if (!state || turnStr !== uidStr) {
      console.log(
        `[POKER] autoFoldPlayer: skipping – not ${uidStr}'s turn (currentTurn=${state?.currentTurnUserId})`
      );
      if (state?.currentTurnUserId) {
        startTurnTimer(gameId, state.currentTurnUserId, io);
      }
      return;
    }

    const player = state.players.find(
      (p) => p.userId === userId || String(p.userId) === uidStr
    );
    if (!player) {
      console.log(
        `[POKER] autoFoldPlayer: player not found for ${uidStr}, moving turn`
      );
      await moveToNextPlayer(gameId, io);
      return;
    }
    const playerName = player?.name || player?.user?.username || "";

    const currentBet = state.bettingRound?.currentBet || 0;
    const myContribution =
      state.bettingRound?.getPlayerContribution(player.id) || 0;
    const canCheck = myContribution >= currentBet;

    // Human timer expiry policy: CHECK if no bet to call, otherwise FOLD.
    let stateAfter;
    try {
      stateAfter = await applyPlayerAction({
        gameId,
        userId,
        action: canCheck ? "CHECK" : "FOLD",
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

    console.log(
      `[POKER] turn-timer expiry auto-action: ${canCheck ? "CHECK" : "FOLD"} for ${playerName || userId} (currentBet=${currentBet}, contribution=${myContribution})`
    );

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

