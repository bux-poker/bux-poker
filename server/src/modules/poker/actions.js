import { prisma } from "../../config/database.js";
import { ensureHandState } from "./ensureHandState.js";
import { postDealerMessage } from "./dealerMessages.js";

export async function applyPlayerAction({ gameId, userId, action, amount, io = null }) {
  const state = await ensureHandState(gameId);

  if (!state.actedPlayersInRound) {
    state.actedPlayersInRound = new Set();
  }

  const player = state.players.find((p) => p.userId === userId);
  if (!player) {
    throw new Error("Player not at this table");
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

  const activeNonFoldedPlayers = state.players.filter(
    (p) =>
      p.status !== "FOLDED" &&
      p.status !== "ELIMINATED" &&
      p.status !== "ALL_IN" &&
      p.chips > 0
  );
  const isHeadsUpPot = activeNonFoldedPlayers.length === 2;
  let effectiveAction = action;

  const getEffectiveCap = () => {
    const myContribution = state.bettingRound.getPlayerContribution(player.id);
    const currentBet = state.bettingRound.currentBet || 0;
    const othersWithChips = activeNonFoldedPlayers.filter(
      (p) => p.userId !== userId && p.chips > 0
    );
    if (othersWithChips.length === 0) return myContribution + player.chips;
    const minOpponentChips = Math.min(...othersWithChips.map((o) => o.chips));
    const sidePotRoom = currentBet + minOpponentChips;
    return Math.min(myContribution + player.chips, sidePotRoom);
  };

  switch (action) {
    case "BET":
    case "RAISE": {
      if (amount > player.chips) {
        amount = player.chips;
      }

      const myContribution = state.bettingRound.getPlayerContribution(player.id);
      const isGoingAllIn = amount >= player.chips;

      if (!isGoingAllIn) {
        const effectiveCap = getEffectiveCap();
        const desiredNewContribution = myContribution + amount;
        if (desiredNewContribution > effectiveCap) {
          const cappedAmount = Math.max(0, effectiveCap - myContribution);
          if (cappedAmount < amount) {
            console.log(
              `[ACTION] Capping ${action} amount for ${playerName} from ${amount} to ${cappedAmount} based on effective stack`
            );
            amount = cappedAmount;
          }
        }
      }

      if (amount <= 0) {
        console.log(
          `[ACTION] ${action} amount is ${amount} after capping - converting to CHECK for ${playerName}`
        );
        effectiveAction = "CHECK";
        console.log("[ACTION] After CHECK: no change to contributions");
        state.actedPlayersInRound.add(userId);
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
        state.actedPlayersInRound.add(userId);
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

      const activeCount = state.players.filter(
        (p) => p.status !== "FOLDED" && p.status !== "ELIMINATED"
      ).length;
      const isHeadsUp = activeCount === 2;
      const raiseAmount = newContribution - currentBet;
      const minRaise =
        state.bettingRound.minimumRaise || state.bettingRound.bigBlind || 20;
      const isShortRaise = raiseAmount > 0 && raiseAmount < minRaise;

      try {
        if (isShortRaise && (isGoingAllIn || isHeadsUp)) {
          state.bettingRound.playerBets.set(player.id, newContribution);
          if (newContribution > state.bettingRound.currentBet) {
            state.bettingRound.currentBet = newContribution;
            state.lastRaiseUserId = player.userId;
            state.lastRaiseWasShortAllIn = true;
            state.actedPlayersInRound.clear();
          }
          state.actedPlayersInRound.add(userId);
        } else {
          state.bettingRound.bet(player.id, amount);
          state.lastRaiseUserId = player.userId;
          state.lastRaiseWasShortAllIn = false;
          state.actedPlayersInRound.clear();
          state.actedPlayersInRound.add(userId);
        }
      } catch (err) {
        if (
          err?.message === "Raise below minimum raise size" &&
          (isGoingAllIn || raiseAmount > 0)
        ) {
          state.bettingRound.playerBets.set(player.id, newContribution);
          if (newContribution > state.bettingRound.currentBet) {
            state.bettingRound.currentBet = newContribution;
            state.lastRaiseUserId = player.userId;
            state.lastRaiseWasShortAllIn = true;
            state.actedPlayersInRound.clear();
          }
          state.actedPlayersInRound.add(userId);
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
      state.actedPlayersInRound.add(userId);

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
      state.actedPlayersInRound.add(userId);
      if (io) {
        postDealerMessage(gameId, io, `${playerName} checks`);
      }
      break;
    }
    case "FOLD": {
      player.status = "FOLDED";
      state.actedPlayersInRound.add(userId);
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
          state.actedPlayersInRound.add(userId);
        }
      } else {
        const raiseAmount = allInContribution - state.bettingRound.currentBet;
        const minRaise =
          state.bettingRound.minimumRaise || state.bettingRound.bigBlind;

        if (raiseAmount >= minRaise) {
          state.bettingRound.bet(player.id, allInAmount);
          state.lastRaiseUserId = player.userId;
          state.lastRaiseWasShortAllIn = false;
          state.actedPlayersInRound.clear();
        } else {
          state.bettingRound.playerBets.set(player.id, allInContribution);
          if (allInContribution > state.bettingRound.currentBet) {
            state.bettingRound.currentBet = allInContribution;
            state.lastRaiseUserId = player.userId;
            state.lastRaiseWasShortAllIn = true;
            state.actedPlayersInRound.clear();
          }
        }
        player.chips = 0;
      }

      state.actedPlayersInRound.add(userId);

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

