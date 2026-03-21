import { prisma } from "../../config/database.js";
import { ensureHandState } from "./ensureHandState.js";
import { postDealerMessage } from "./dealerMessages.js";
import { normalizeUserId } from "./normalizeUserId.js";

export async function applyPlayerAction({ gameId, userId, action, amount, io = null }) {
  const state = await ensureHandState(gameId);

  if (!state.actedPlayersInRound) {
    state.actedPlayersInRound = new Set();
  }

  const uid = normalizeUserId(userId);
  const player = state.players.find(
    (p) => normalizeUserId(p.userId) === uid
  );
  if (!player) {
    throw new Error("Player not at this table");
  }

  const expectedTurn = normalizeUserId(state.currentTurnUserId);
  if (expectedTurn == null || expectedTurn !== uid) {
    throw new Error("Not your turn to act");
  }

  if (player.status === "ELIMINATED") {
    throw new Error("Eliminated players cannot act");
  }

  if (player.status === "ALL_IN" || player.chips === 0) {
    if (player.chips === 0 && player.status !== "ALL_IN") {
      player.status = "ALL_IN";
      console.log(
        `[ACTION] Auto-marking player ${player.name || player.userId} as ALL_IN (0 chips)`
      );
    }
    throw new Error("All-in players cannot act");
  }

  const playerName = player.name || player.user?.username || `Player ${player.seatNumber}`;
  const currentBetBefore = state.bettingRound?.currentBet || 0;
  const playerContributionBefore =
    state.bettingRound?.getPlayerContribution(player.id) || 0;

  console.log(
    `[ACTION] Player ${playerName} (seat ${player.seatNumber}) performing ${action} with amount ${amount}`
  );
  console.log(
    `[ACTION] Before: currentBet=${currentBetBefore}, playerContribution=${playerContributionBefore}, lastRaiseUserId=${state.lastRaiseUserId || "null"}`
  );

  let effectiveAction = action;

  switch (action) {
    case "BET":
    case "RAISE": {
      if (amount > player.chips) {
        amount = player.chips;
      }

      const myContribution = state.bettingRound.getPlayerContribution(player.id);
      const isGoingAllIn = amount >= player.chips;

      if (amount <= 0) {
        console.log(
          `[ACTION] ${action} amount is ${amount} after capping - converting to CHECK for ${playerName}`
        );
        effectiveAction = "CHECK";
        console.log("[ACTION] After CHECK: no change to contributions");
        state.actedPlayersInRound.add(uid);
        if (io) {
          postDealerMessage(gameId, io, `${playerName} checks`);
        }
        break;
      }

      const currentBet = state.bettingRound.currentBet;
      const newContribution = myContribution + amount;

      if (newContribution <= currentBet) {
        console.log(
          `[ACTION] ${action} amount ${amount} would result in contribution ${newContribution} which doesn't exceed current bet ${currentBet} - converting to CALL for ${playerName}`
        );
        effectiveAction = "CALL";
        const toCall = currentBet - myContribution;
        const callAmount = Math.min(toCall, player.chips);
        if (callAmount > 0) {
          state.bettingRound.call(player.id, player.chips);
          player.chips -= callAmount;
          if (player.chips < 0) {
            console.error(
              `[ACTION] WARNING: player ${playerName} chips went negative after CALL. Clamping to 0.`,
              player.chips
            );
            player.chips = 0;
          }
          if (player.chips === 0) {
            player.status = "ALL_IN";
            effectiveAction = "ALL_IN";
          }
        }
        state.actedPlayersInRound.add(uid);
        if (io) {
          if (player.chips === 0 && callAmount > 0) {
            postDealerMessage(
              gameId,
              io,
              `${playerName} calls ${callAmount.toLocaleString()} (all-in)`
            );
          } else {
            postDealerMessage(
              gameId,
              io,
              `${playerName} calls ${callAmount.toLocaleString()}`
            );
          }
        }
        break;
      }

      const raiseAmount = newContribution - currentBet;
      const minRaise =
        state.bettingRound.minimumRaise || state.bettingRound.bigBlind || 20;
      const isShortRaise = raiseAmount > 0 && raiseAmount < minRaise;

      try {
        // Short all-in only: sub-minimum raises are not legal in NLHE just because it's heads-up.
        if (isShortRaise && isGoingAllIn) {
          state.bettingRound.playerBets.set(player.id, newContribution);
          if (newContribution > state.bettingRound.currentBet) {
            state.bettingRound.currentBet = newContribution;
            state.lastRaiseUserId = normalizeUserId(player.userId);
            state.lastRaiseWasShortAllIn = true;
            state.actedPlayersInRound.clear();
          }
          state.actedPlayersInRound.add(uid);
        } else {
          state.bettingRound.bet(player.id, amount);
          state.lastRaiseUserId = normalizeUserId(player.userId);
          state.lastRaiseWasShortAllIn = false;
          state.actedPlayersInRound.clear();
          state.actedPlayersInRound.add(uid);
        }
      } catch (err) {
        if (
          err?.message === "Raise below minimum raise size" &&
          isGoingAllIn
        ) {
          state.bettingRound.playerBets.set(player.id, newContribution);
          if (newContribution > state.bettingRound.currentBet) {
            state.bettingRound.currentBet = newContribution;
            state.lastRaiseUserId = normalizeUserId(player.userId);
            state.lastRaiseWasShortAllIn = true;
            state.actedPlayersInRound.clear();
          }
          state.actedPlayersInRound.add(uid);
        } else {
          throw err;
        }
      }

      player.chips -= amount;
      if (player.chips < 0) {
        console.error(
          `[ACTION] WARNING: player ${playerName} chips went negative after ${action}. Clamping to 0.`,
          player.chips
        );
        player.chips = 0;
      }

      const newBet = state.bettingRound.currentBet;
      const finalContribution = state.bettingRound.getPlayerContribution(player.id);
      console.log(
        `[ACTION] After ${action}: currentBet=${newBet}, playerContribution=${finalContribution}, lastRaiseUserId=${state.lastRaiseUserId}, remainingChips=${player.chips}`
      );

      if (io && action === "BET") {
        const message =
          player.chips === 0
            ? `${playerName} bets ${amount.toLocaleString()} (all-in)`
            : `${playerName} bets ${amount.toLocaleString()}`;
        postDealerMessage(gameId, io, message);
      } else if (io && action === "RAISE") {
        const message =
          player.chips === 0
            ? `${playerName} raises to ${newBet.toLocaleString()} (all-in)`
            : `${playerName} raises to ${newBet.toLocaleString()}`;
        postDealerMessage(gameId, io, message);
      }
      break;
    }
    case "CALL": {
      // Always call what is currently on the table (or go all-in if short).
      // Short all-ins still set currentBet, and action cannot continue until players match it.
      const spent = state.bettingRound.call(player.id, player.chips);
      player.chips -= spent;
      if (player.chips < 0) {
        console.error(
          `[ACTION] WARNING: player ${playerName} chips went negative after CALL. Clamping to 0.`,
          player.chips
        );
        player.chips = 0;
      }

      if (player.chips === 0) {
        player.status = "ALL_IN";
        effectiveAction = "ALL_IN";
        console.log(`[ACTION] Player ${playerName} is now ALL_IN after CALL`);
      }

      const newContribution = state.bettingRound.getPlayerContribution(player.id);
      console.log(
        `[ACTION] After CALL: playerContribution=${newContribution}, spent=${spent}`
      );
      state.actedPlayersInRound.add(uid);

      if (io) {
        if (player.chips === 0 && spent > 0) {
          postDealerMessage(
            gameId,
            io,
            `${playerName} calls ${spent.toLocaleString()} (all-in)`
          );
        } else {
          postDealerMessage(
            gameId,
            io,
            `${playerName} calls ${spent.toLocaleString()}`
          );
        }
      }
      break;
    }
    case "CHECK": {
      console.log("[ACTION] After CHECK: no change to contributions");
      state.actedPlayersInRound.add(uid);
      if (io) {
        postDealerMessage(gameId, io, `${playerName} checks`);
      }
      break;
    }
    case "FOLD": {
      player.status = "FOLDED";
      state.actedPlayersInRound.add(uid);
      console.log(
        "[ACTION] After FOLD: player status=FOLDED, holeCards kept for display"
      );

      if (io) {
        postDealerMessage(gameId, io, `${playerName} folds`);
      }
      break;
    }
    case "ALL_IN": {
      let allInAmount = player.chips;
      if (allInAmount <= 0) {
        throw new Error("Cannot go all-in with zero chips");
      }

      const currentContribution = state.bettingRound.getPlayerContribution(player.id);
      const allInContribution = currentContribution + allInAmount;

      if (allInContribution <= state.bettingRound.currentBet) {
        const amountToCall = state.bettingRound.currentBet - currentContribution;
        const actualCall = Math.min(amountToCall, allInAmount);
        if (actualCall > 0) {
          state.bettingRound.call(player.id, allInAmount);
          player.chips -= actualCall;
          if (player.chips < 0) {
            console.error(
              `[ACTION] WARNING: player ${playerName} chips went negative after ALL_IN-call path. Clamping to 0.`,
              player.chips
            );
            player.chips = 0;
          }
        } else {
          state.actedPlayersInRound.add(uid);
        }
      } else {
        const raiseAmount = allInContribution - state.bettingRound.currentBet;
        const minRaise =
          state.bettingRound.minimumRaise || state.bettingRound.bigBlind;

        if (raiseAmount >= minRaise) {
          state.bettingRound.bet(player.id, allInAmount);
          state.lastRaiseUserId = normalizeUserId(player.userId);
          state.lastRaiseWasShortAllIn = false;
          state.actedPlayersInRound.clear();
        } else {
          state.bettingRound.playerBets.set(player.id, allInContribution);
          if (allInContribution > state.bettingRound.currentBet) {
            state.bettingRound.currentBet = allInContribution;
            state.lastRaiseUserId = normalizeUserId(player.userId);
            state.lastRaiseWasShortAllIn = true;
            state.actedPlayersInRound.clear();
          }
        }
        player.chips = 0;
      }

      state.actedPlayersInRound.add(uid);

      if (io) {
        postDealerMessage(
          gameId,
          io,
          `${playerName} goes ALL IN with ${allInAmount.toLocaleString()}`
        );
      }
      break;
    }
    default:
      throw new Error("Unknown action");
  }

  // Avatar overlay + status: any stack-committing action that leaves 0 chips is ALL_IN
  // (BET/RAISE often left lastAction as BET/RAISE even when the player shoved their entire stack).
  if (
    player.chips === 0 &&
    player.status !== "FOLDED" &&
    player.status !== "ELIMINATED"
  ) {
    player.status = "ALL_IN";
    if (["BET", "RAISE", "CALL", "ALL_IN"].includes(effectiveAction)) {
      effectiveAction = "ALL_IN";
    }
  }

  // Do not clear currentTurnUserId here when the actor goes all-in: moveToNextPlayer needs
  // the previous turn holder to orbit from their seat. Clients get a sanitized turn via
  // buildClientGameState (null when the holder cannot bet).

  // Keep in-memory state authoritative for real-time clients.
  player.lastAction = effectiveAction;
  player.lastActionSeq = (player.lastActionSeq || 0) + 1;

  prisma.player
    .update({
      where: { id: player.id },
      data: {
        chips: player.chips,
        status: player.status,
        lastAction: effectiveAction,
      },
    })
    .catch((err) => {
      if (err?.code === "P2025") {
        console.log(
          `[ACTION] Player ${player.id} already removed (consolidation), skipping update`
        );
      } else {
        console.error("[ACTION] Error updating player in DB:", err);
      }
    });

  await prisma.game
    .update({
      where: { id: gameId },
      data: {
        pot: state.pot,
      },
    })
    .catch((err) => console.error("[ACTION] Error updating game in DB:", err));

  return state;
}

