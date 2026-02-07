// Socket handler for poker table events.
// Wires Socket.IO events to PokerGameService, BettingRound and Prisma.

import { prisma } from "../../config/database.js";
import { PokerGameService } from "../../services/PokerGameService.js";
import { TexasHoldem } from "../poker/TexasHoldem.js";
import { BettingRound } from "../poker/BettingRound.js";
import { HandEvaluator } from "../poker/HandEvaluator.js";

const gameService = new PokerGameService();
const engine = new TexasHoldem({ smallBlind: 10, bigBlind: 20 });

/** Delay in ms between each phase of the cinematic all-in showdown */
const SHOWDOWN_PHASE_DELAY_MS = 1000;

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// In-memory per-game state for the current hand and betting street.
// For production you'd want this to be more robust / persisted.
const tableState = new Map();

// Turn timers: map of gameId -> { playerId, timeout, expiresAt }
const turnTimers = new Map();

// Test player action timeouts: map of gameId -> { playerId, timeout }
const testPlayerTimers = new Map();

// Store io instance for use by other modules
let ioInstance = null;

export function getIO() {
  return ioInstance;
}

/**
 * Check if a game has an active hand in progress
 * A hand is considered active if:
 * - State exists AND
 * - Not in showdown (showdownActive is false or undefined) AND
 * - Has a current turn OR is in a betting round (street is set)
 * 
 * After showdown completes, the hand is no longer "active" even though state exists
 * (state is kept for a few seconds to show results, then cleared)
 */
export function hasActiveHand(gameId) {
  const state = tableState.get(gameId);
  if (!state) return false;
  
  // If showdown is active, the hand is complete (just showing results)
  // Consolidation can proceed
  if (state.showdownActive) {
    return false;
  }
  
  // If there's a current turn, hand is active
  if (state.currentTurnUserId) {
    return true;
  }
  
  // If street is set and not null, hand is in progress
  if (state.street && state.street !== null) {
    return true;
  }
  
  // No active hand
  return false;
}

/**
 * Clear all in-memory state and timers for given game IDs.
 * MUST be called before consolidation deletes/moves players, otherwise
 * pending timers will try to update deleted player records (P2025).
 */
export function clearAllStateForGames(gameIds) {
  if (!gameIds || gameIds.length === 0) return;
  for (const gameId of gameIds) {
    tableState.delete(gameId);
    const timer = turnTimers.get(gameId);
    if (timer) {
      if (timer.timerId) clearTimeout(timer.timerId);
      if (timer.graceTimerId) clearTimeout(timer.graceTimerId);
      turnTimers.delete(gameId);
    }
  }
  console.log(`[POKER] Cleared state for ${gameIds.length} game(s) before consolidation`);
}

function buildClientGameState(game, state) {
  // Calculate total pot: state.pot (accumulated from previous streets) + current betting round
  const totalPot = state 
    ? (state.pot || 0) + (state.bettingRound?.getTotalPot() || 0)
    : game.pot || 0;
  
  return {
    id: game.id,
    tournamentId: game.tournamentId,
    tableNumber: game.tableNumber,
    pot: totalPot,
    communityCards: JSON.stringify(state?.communityCards ?? []),
    street: state?.street || "PREFLOP",
    currentBet: state?.bettingRound?.currentBet || 0,
    minimumRaise: state?.bettingRound?.minimumRaise || (state?.bettingRound?.bigBlind || 20),
    smallBlind: state?.bettingRound?.smallBlind || 10,
    bigBlind: state?.bettingRound?.bigBlind || 20,
    dealerSeat: state?.dealerSeat ?? game.dealerSeat,
    smallBlindSeat: state?.smallBlindSeat ?? game.smallBlindSeat,
    bigBlindSeat: state?.bigBlindSeat ?? game.bigBlindSeat,
    currentTurnUserId: state?.currentTurnUserId,
    showdownActive: state?.showdownActive || false,
    showdownResults: state?.showdownResults || null,
    players: (state?.players ?? game.players)
      .filter(p => p.status !== 'ELIMINATED') // Only include non-eliminated players
      .map((p) => ({
      id: p.id,
      userId: p.userId,
      name: p.user?.username || "Player",
      chips: p.chips,
      seatNumber: p.seatNumber,
      status: p.status,
      avatarUrl: p.user?.avatarUrl || null,
      lastAction: p.lastAction || null, // Include last action for overlay
      holeCards: (() => {
        if (!p.holeCards) return null;
        // If already an object, return as-is
        if (typeof p.holeCards === 'object') return p.holeCards;
        // If it's a string, try to parse it
        if (typeof p.holeCards === 'string') {
          try {
            return JSON.parse(p.holeCards);
          } catch (e) {
            console.warn(`[POKER] Failed to parse holeCards for player ${p.id}:`, e.message);
            return null;
          }
        }
        return null;
      })(),
      contribution: state?.bettingRound?.getPlayerContribution(p.id) || 0
    }))
  };
}

async function ensureHandState(gameId) {
  let state = tableState.get(gameId);
  if (state) return state;

  const game = await prisma.game.findUnique({
    where: { id: gameId },
    include: {
      players: {
        include: { user: true }
      }
    }
  });

  if (!game) {
    throw new Error("Game not found");
  }

  const deck = engine.createShuffledDeck();
  const { deck: remainingDeck, players: dealtHands } = engine.dealHoleCards(
    deck,
    game.players.length
  );

  // Persist hole cards to players (encoded as JSON string).
  await Promise.all(
    game.players.map((p, index) =>
      prisma.player.update({
        where: { id: p.id },
        data: {
          holeCards: JSON.stringify(dealtHands[index])
        }
      })
    )
  );

  const bettingRound = new BettingRound({
    smallBlind: engine.smallBlind,
    bigBlind: engine.bigBlind,
    startingPot: 0 // Pot is tracked in state, not in BettingRound
  });

  state = {
    street: "PREFLOP",
    deck: remainingDeck,
    communityCards: [],
    bettingRound,
    pot: game.pot + bettingRound.getTotalPot(), // Start with game.pot + current betting round (blinds)
    players: game.players.map((p) => ({
      ...p,
      contributions: 0
    }))
  };

  tableState.set(gameId, state);
  return state;
}

async function applyPlayerAction({ gameId, userId, action, amount, io = null }) {
  const state = await ensureHandState(gameId);
  
  // Initialize actedPlayersInRound if not exists (for new betting rounds)
  if (!state.actedPlayersInRound) {
    state.actedPlayersInRound = new Set();
  }

  const player = state.players.find((p) => p.userId === userId);
  if (!player) {
    throw new Error("Player not at this table");
  }

  // Reject actions from eliminated players
  if (player.status === 'ELIMINATED') {
    throw new Error("Eliminated players cannot act");
  }
  
  // Reject actions from all-in players (they've already committed all chips)
  if (player.status === 'ALL_IN' || player.chips === 0) {
    // If player has 0 chips but isn't marked as ALL_IN, mark them as ALL_IN
    if (player.chips === 0 && player.status !== 'ALL_IN') {
      player.status = 'ALL_IN';
      console.log(`[ACTION] Auto-marking player ${player.name || player.userId} as ALL_IN (0 chips)`);
    }
    throw new Error("All-in players cannot act");
  }

  const playerName = player.name || player.user?.username || `Player ${player.seatNumber}`;
  const currentBetBefore = state.bettingRound?.currentBet || 0;
  const playerContributionBefore = state.bettingRound?.getPlayerContribution(player.id) || 0;
  
  console.log(`[ACTION] Player ${playerName} (seat ${player.seatNumber}) performing ${action} with amount ${amount}`);
  console.log(`[ACTION] Before: currentBet=${currentBetBefore}, playerContribution=${playerContributionBefore}, lastRaiseUserId=${state.lastRaiseUserId || 'null'}`);

  // Basic action handling. This is intentionally simplified:
  //
  // Cap bet/raise to effective stack: never bet more than the most chips
  // any other active player has (so we don't create uncallable side pots).
  // Filter out folded, eliminated, and all-in players
  const activeNonFoldedPlayers = state.players.filter(
    (p) => p.status !== "FOLDED" && p.status !== "ELIMINATED" && p.status !== "ALL_IN" && p.chips > 0
  );
  const isHeadsUpPot = activeNonFoldedPlayers.length === 2;
  const opponent =
    isHeadsUpPot && activeNonFoldedPlayers[0].userId === userId
      ? activeNonFoldedPlayers[1]
      : isHeadsUpPot && activeNonFoldedPlayers[1].userId === userId
      ? activeNonFoldedPlayers[0]
      : null;

  // Effective stack cap: max total contribution = min(my stack, largest opponent effective stack)
  const getEffectiveCap = () => {
    const myContribution = state.bettingRound.getPlayerContribution(player.id);
    const others = activeNonFoldedPlayers.filter((p) => p.userId !== userId);
    if (others.length === 0) return myContribution + player.chips;
    const maxOtherEffective = Math.max(
      ...others.map((o) => (state.bettingRound.getPlayerContribution(o.id) || 0) + o.chips)
    );
    return Math.min(myContribution + player.chips, maxOtherEffective);
  };

  switch (action) {
    case "BET":
    case "RAISE": {
      // Clamp bet/raise amount to available chips so we can never overspend
      if (amount > player.chips) {
        amount = player.chips;
      }

      const myContribution = state.bettingRound.getPlayerContribution(player.id);

      // Only apply effective stack cap when NOT going all-in. When betting full stack,
      // always allow it - side pot logic handles it. Capping would block "bet all chips".
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
      
      // If amount is 0 or negative after capping, convert BET/RAISE to CHECK
      if (amount <= 0) {
        console.log(
          `[ACTION] ${action} amount is ${amount} after capping - converting to CHECK for ${playerName}`
        );
        // Execute CHECK logic directly (no chips moved)
        console.log(`[ACTION] After CHECK: no change to contributions`);
        // Mark player as acted in this betting round
        state.actedPlayersInRound.add(userId);
        
        // Post dealer message
        if (io) {
          postDealerMessage(gameId, io, `${playerName} checks`);
        }
        break; // Exit BET/RAISE case, CHECK is complete
      }
      
      // Check if the capped amount would actually be a raise or just a call
      const currentBet = state.bettingRound.currentBet;
      const newContribution = myContribution + amount;
      
      // If the new contribution doesn't exceed the current bet, convert to CALL
      if (newContribution <= currentBet) {
        console.log(
          `[ACTION] ${action} amount ${amount} would result in contribution ${newContribution} which doesn't exceed current bet ${currentBet} - converting to CALL for ${playerName}`
        );
        // Convert to CALL
        const toCall = currentBet - myContribution;
        const callAmount = Math.min(toCall, player.chips);
        if (callAmount > 0) {
          state.bettingRound.call(player.id, player.chips);
          player.chips -= callAmount;
          if (player.chips < 0) {
            console.error(`[ACTION] WARNING: player ${playerName} chips went negative after CALL. Clamping to 0.`, player.chips);
            player.chips = 0;
          }
        }
        // Mark player as acted
        state.actedPlayersInRound.add(userId);
        
        // Post dealer message
        if (io) {
          if (player.chips === 0 && callAmount > 0) {
            postDealerMessage(gameId, io, `${playerName} calls ${callAmount.toLocaleString()} (all-in)`);
          } else {
            postDealerMessage(gameId, io, `${playerName} calls ${callAmount.toLocaleString()}`);
          }
        }
        break; // Exit BET/RAISE case, CALL is complete
      }
      
      // Only proceed with BET/RAISE if amount is still positive and would be a raise
      state.bettingRound.bet(player.id, amount);
      player.chips -= amount;
      if (player.chips < 0) {
        console.error(`[ACTION] WARNING: player ${playerName} chips went negative after ${action}. Clamping to 0.`, player.chips);
        player.chips = 0;
      }
      // Don't update state.pot here - it's accumulated when advancing streets
      // state.pot should only change when collecting from betting round
      state.lastRaiseUserId = player.userId; // Track who raised
      // Reset acted players when someone raises - all players need to act again
      state.actedPlayersInRound.clear();
      // Mark the raiser as having acted (they just raised)
      state.actedPlayersInRound.add(userId);
      
      const newBet = state.bettingRound.currentBet;
      const finalContribution = state.bettingRound.getPlayerContribution(player.id);
      console.log(`[ACTION] After ${action}: currentBet=${newBet}, playerContribution=${finalContribution}, lastRaiseUserId=${state.lastRaiseUserId}, remainingChips=${player.chips}`);
      
      // Post dealer message
      if (io && action === "BET") {
        const message = player.chips === 0 
          ? `${playerName} bets ${amount.toLocaleString()} (all-in)`
          : `${playerName} bets ${amount.toLocaleString()}`;
        postDealerMessage(gameId, io, message);
      } else if (io && action === "RAISE") {
        const message = player.chips === 0
          ? `${playerName} raises to ${newBet.toLocaleString()} (all-in)`
          : `${playerName} raises to ${newBet.toLocaleString()}`;
        postDealerMessage(gameId, io, message);
      }
      
      // Note: We don't set next player here - moveToNextPlayer will handle it
      // The raise logic above was trying to set next player, but moveToNextPlayer does this correctly
      break;
    }
    case "CALL": {
      const spent = state.bettingRound.call(player.id, player.chips);
      player.chips -= spent;
      if (player.chips < 0) {
        console.error(`[ACTION] WARNING: player ${playerName} chips went negative after CALL. Clamping to 0.`, player.chips);
        player.chips = 0;
      }
      
      // Mark player as ALL_IN if they have no chips remaining
      if (player.chips === 0) {
        player.status = 'ALL_IN';
        console.log(`[ACTION] Player ${playerName} is now ALL_IN after CALL`);
      }
      
      // Don't update state.pot here - it's accumulated when advancing streets
      // state.pot should only change when collecting from betting round
      const newContribution = state.bettingRound.getPlayerContribution(player.id);
      console.log(`[ACTION] After CALL: playerContribution=${newContribution}, spent=${spent}`);
      // Mark player as acted in this betting round
      state.actedPlayersInRound.add(userId);
      
      // Post dealer message
      if (io) {
        if (player.chips === 0 && spent > 0) {
          postDealerMessage(gameId, io, `${playerName} calls ${spent.toLocaleString()} (all-in)`);
        } else {
          postDealerMessage(gameId, io, `${playerName} calls ${spent.toLocaleString()}`);
        }
      }
      break;
    }
    case "CHECK": {
      // No chips moved; validity (no outstanding bet) assumed client-side for now.
      console.log(`[ACTION] After CHECK: no change to contributions`);
      // Mark player as acted in this betting round
      state.actedPlayersInRound.add(userId);
      
      // Post dealer message
      if (io) {
        postDealerMessage(gameId, io, `${playerName} checks`);
      }
      break;
    }
    case "FOLD": {
      player.status = "FOLDED";
      // Keep hole cards when player folds - they should remain visible but faded
      // The client will handle the visual fade effect
      // Don't clear holeCards or update database - keep them for display
      console.log(`[ACTION] After FOLD: player status=FOLDED, holeCards kept for display`);
      
      // Post dealer message
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
      // No effective stack cap for explicit ALL_IN - user intentionally goes all-in,
      // side pot logic handles uncallable amounts
      
      // All-in acts as a raise if it's more than current bet
      const currentContribution = state.bettingRound.getPlayerContribution(player.id);
      const allInContribution = currentContribution + allInAmount;
      
      // Special handling for all-in: allow even if it doesn't meet minimum raise
      // If all-in doesn't increase bet enough, treat it as a call
      if (allInContribution <= state.bettingRound.currentBet) {
        // All-in amount doesn't even cover the current bet - treat as call
        const amountToCall = state.bettingRound.currentBet - currentContribution;
        const actualCall = Math.min(amountToCall, allInAmount);
        if (actualCall > 0) {
          state.bettingRound.call(player.id, allInAmount);
          player.chips -= actualCall;
          if (player.chips < 0) {
            console.error(`[ACTION] WARNING: player ${playerName} chips went negative after ALL_IN-call path. Clamping to 0.`, player.chips);
            player.chips = 0;
          }
        } else {
          // Already called, just mark as acted
          state.actedPlayersInRound.add(userId);
        }
      } else {
        // All-in is large enough to be a raise - use special all-in bet method
        // Check if it meets minimum raise requirement
        const raiseAmount = allInContribution - state.bettingRound.currentBet;
        const minRaise = state.bettingRound.minimumRaise || state.bettingRound.bigBlind;
        
        if (raiseAmount >= minRaise) {
          // Valid raise - use normal bet method
          state.bettingRound.bet(player.id, allInAmount);
          state.lastRaiseUserId = player.userId;
          state.actedPlayersInRound.clear();
        } else {
          // All-in doesn't meet minimum raise, but we allow it anyway
          // Manually update player contribution
          state.bettingRound.playerBets.set(player.id, allInContribution);
          // Update currentBet if all-in amount is higher (even if not a full raise)
          // This ensures other players know they need to match this amount
          if (allInContribution > state.bettingRound.currentBet) {
            state.bettingRound.currentBet = allInContribution;
            state.lastRaiseUserId = player.userId;
            state.actedPlayersInRound.clear();
          }
        }
        player.chips = 0;
      }
      // Don't update state.pot here - it's accumulated when advancing streets
      // state.pot should only change when collecting from betting round
      // Mark player as having acted (they went all-in)
      state.actedPlayersInRound.add(userId);
      
      // Post dealer message
      if (io) {
        postDealerMessage(gameId, io, `${playerName} goes ALL IN with ${allInAmount.toLocaleString()}`);
      }
      break;
    }
    default:
      throw new Error("Unknown action");
  }

  // Persist chips and status for this player (async - don't block)
  prisma.player.update({
    where: { id: player.id },
    data: {
      chips: player.chips,
      status: player.status,
      lastAction: action
    }
  }).catch(err => console.error('[ACTION] Error updating player in DB:', err));

  // Persist pot to game (async - don't block)
  prisma.game.update({
    where: { id: gameId },
    data: {
      pot: state.pot
    }
  }).catch(err => console.error('[ACTION] Error updating game in DB:', err));

  return state;
}

/**
 * If the tournament just ended (COMPLETED), emit so clients refetch and show winner modal.
 */
async function emitIfTournamentCompleted(tournamentId, gameId, io) {
  if (!tournamentId || !io) return;
  try {
    const t = await prisma.tournament.findUnique({
      where: { id: tournamentId },
      select: { status: true }
    });
    if (t?.status === "COMPLETED") {
      io.emit("tournament_completed", { tournamentId });
      console.log(`[POKER] Emitted tournament_completed for tournament ${tournamentId} (broadcast to all clients)`);
    }
  } catch (err) {
    console.error("[POKER] Error in emitIfTournamentCompleted:", err);
  }
}

/**
 * Start a hand for a game with dealer assignment and blinds
 * This can be called from startTournament or when players join
 */
export async function startHandForGame(gameId, io) {
  const game = await prisma.game.findUnique({
    where: { id: gameId },
    include: {
      players: {
        include: { user: true }
      },
      tournament: true
    }
  });

  if (!game) {
    throw new Error("Game not found");
  }
  if (game.status !== "ACTIVE") {
    return; // Do not start hands for COMPLETED or other non-ACTIVE games
  }
  if (game.players.length < 2) {
    throw new Error("Not enough players");
  }

  // CRITICAL: Ensure every non-eliminated player with chips is ACTIVE for the new hand.
  // Post-hand reset can miss players in some paths (e.g. only in-hand players reset);
  // this guarantees all 8 (or N) are included, not just half.
  const needActivation = game.players.filter(
    p => p.chips > 0 && p.status !== 'ELIMINATED' && p.status !== 'ACTIVE'
  );
  if (needActivation.length > 0) {
    console.log(`[POKER] Activating ${needActivation.length} players for new hand (were ${needActivation.map(p => p.status).join(', ')})`);
    await prisma.player.updateMany({
      where: {
        gameId,
        chips: { gt: 0 },
        status: { not: 'ELIMINATED' }
      },
      data: { status: 'ACTIVE', holeCards: '', lastAction: null }
    });
    // Reload game so rest of startHandForGame sees ACTIVE status
    const refreshed = await prisma.game.findUnique({
      where: { id: gameId },
      include: { players: { include: { user: true } }, tournament: true }
    });
    if (refreshed) {
      game.players = refreshed.players;
      Object.assign(game, refreshed);
    }
  }

  // Skip if hand already exists
  if (tableState.get(gameId)) {
    return;
  }

  // Need at least 2 players with chips to start a hand (SB + BB)
  const playersWithChips = game.players.filter(p => p.status !== 'ELIMINATED' && p.chips > 0);
  if (playersWithChips.length < 2) {
    console.log(`[POKER] Not enough players with chips to start hand (${playersWithChips.length}), skipping. Tournament may be complete.`);
    if (game.tournament?.id && io) {
      await emitIfTournamentCompleted(game.tournament.id, gameId, io);
    }
    return;
  }

  // Get tournament blind levels - use current level from game, not always first level
  let smallBlind = 10;
  let bigBlind = 20;
  
  if (game.tournament?.blindLevelsJson) {
    try {
      const blindLevels = JSON.parse(game.tournament.blindLevelsJson);
      if (blindLevels && blindLevels.length > 0) {
        // Use currentBlindLevel from game (updated by checkAndAdvanceBlindLevel)
        // If not set, default to first level (0)
        const currentLevelIndex = game.currentBlindLevel ?? 0;
        const currentLevel = blindLevels[currentLevelIndex] || blindLevels[0];
        smallBlind = currentLevel.smallBlind || 10;
        bigBlind = currentLevel.bigBlind || 20;
        
        console.log(`[POKER] Using blind level ${currentLevelIndex}: ${smallBlind}/${bigBlind}`);
      }
    } catch (e) {
      console.warn("Failed to parse blind levels, using defaults");
    }
  } else if (game.smallBlind && game.bigBlind) {
    // Fallback: use blinds from game record if tournament blind levels not available
    smallBlind = game.smallBlind;
    bigBlind = game.bigBlind;
    console.log(`[POKER] Using blinds from game record: ${smallBlind}/${bigBlind}`);
  }

  // Create engine with tournament blind levels
  const tournamentEngine = new TexasHoldem({ 
    smallBlind, 
    bigBlind 
  });

  // Rotate dealer clockwise (or assign randomly if no previous dealer)
  // Get previous dealer seat from last hand state if it exists, OR from game record
  let dealerPlayer;
  let dealerSeat;
  const previousState = tableState.get(gameId);
  const previousDealerSeat = previousState?.dealerSeat ?? game.dealerSeat;
  
  // Get active players with valid seats for dealer selection
  // Filter out eliminated players and players with 0 chips
  const activePlayersForDealer = game.players.filter(p => 
    p.status === 'ACTIVE' && 
    p.seatNumber >= 0 && 
    p.chips > 0 // Must have chips to be active
  );
  
  if (previousDealerSeat !== null && previousDealerSeat !== undefined && activePlayersForDealer.length > 0) {
    // Rotate dealer clockwise (decrease seat number, wrap if needed)
    // Seats are numbered ANTICLOCKWISE, so CLOCKWISE movement = DECREASING seat numbers
    const maxSeat = Math.max(...activePlayersForDealer.map(p => p.seatNumber));
    const minSeat = Math.min(...activePlayersForDealer.map(p => p.seatNumber));
    let nextDealerSeat = previousDealerSeat - 1;
    if (nextDealerSeat < minSeat) nextDealerSeat = maxSeat;
    
    // Find active player at next dealer seat
    dealerPlayer = activePlayersForDealer.find(p => p.seatNumber === nextDealerSeat);
    
    // If no player at that seat, find next active player clockwise
    if (!dealerPlayer) {
      let attempts = 0;
      while (!dealerPlayer && attempts < activePlayersForDealer.length) {
        nextDealerSeat = nextDealerSeat - 1;
        if (nextDealerSeat < minSeat) nextDealerSeat = maxSeat;
        dealerPlayer = activePlayersForDealer.find(p => p.seatNumber === nextDealerSeat);
        attempts++;
      }
    }
    
    if (dealerPlayer) {
      dealerSeat = dealerPlayer.seatNumber;
      console.log(`[POKER] Rotated dealer clockwise from seat ${previousDealerSeat} to seat ${dealerSeat}`);
    }
  }
  
  // Fallback: if no previous dealer or rotation failed, randomly assign from active players
  if (!dealerPlayer && activePlayersForDealer.length > 0) {
    const dealerIndex = Math.floor(Math.random() * activePlayersForDealer.length);
    dealerPlayer = activePlayersForDealer[dealerIndex];
    dealerSeat = dealerPlayer.seatNumber;
    console.log(`[POKER] ${previousDealerSeat !== null && previousDealerSeat !== undefined ? 'Rotation failed, ' : ''}Randomly assigned dealer at seat ${dealerSeat}`);
  }
  
  if (!dealerPlayer) {
    throw new Error(`No active players available to assign dealer`);
  }
  
  // Update game record with new dealer seat for next hand
  // Note: dealerSeat field may not exist in database yet if migration hasn't been run
  await prisma.game.update({
    where: { id: gameId },
    data: { dealerSeat: dealerSeat }
  }).catch(err => {
    // If field doesn't exist, log warning but don't fail
    if (err.message && err.message.includes('Unknown argument')) {
      console.warn(`[POKER] dealerSeat field not in database yet - migration needed. Error: ${err.message}`);
    } else {
      console.error(`[POKER] Error updating dealer seat:`, err);
    }
  });
  
  // Seats are numbered ANTICLOCKWISE, so CLOCKWISE movement = DECREASING seat numbers
  // Use ACTIVE players only for seat range (eliminated players may be at empty seats)
  const maxSeat = Math.max(...activePlayersForDealer.map(p => p.seatNumber), 1);
  const minSeat = Math.min(...activePlayersForDealer.map(p => p.seatNumber), 8);
  const seatRange = maxSeat >= minSeat ? maxSeat - minSeat + 1 : 8; // Number of seats to search
  
  // Handle heads-up (2 players) special blind rules
  // In heads-up: dealer posts small blind, other player posts big blind
  // Filter out eliminated players and players with 0 chips
  const activePlayers = game.players.filter(p => 
    p.status === 'ACTIVE' && 
    p.seatNumber >= 0 && 
    p.chips > 0 // Must have chips to be active
  );
  const isHeadsUp = activePlayers.length === 2;
  
  let sbSeat, bbSeat, sbPlayer, bbPlayer;
  
  if (isHeadsUp) {
    // Heads-up rules: Dealer posts small blind, other player posts big blind
    sbPlayer = dealerPlayer;
    sbSeat = dealerSeat;
    bbPlayer = activePlayers.find(p => p.id !== dealerPlayer.id);
    bbSeat = bbPlayer?.seatNumber;
    console.log(`[POKER] Heads-up game: Dealer (seat ${sbSeat}) posts small blind, Other player (seat ${bbSeat}) posts big blind`);
  } else {
    // Standard rules: SB and BB are clockwise from dealer (decreasing seat numbers)
    sbSeat = dealerSeat - 1 < minSeat ? maxSeat : dealerSeat - 1;
    bbSeat = sbSeat - 1 < minSeat ? maxSeat : sbSeat - 1;
    
    // Find players at those seat numbers (must be active players with valid seats)
    sbPlayer = activePlayers.find(p => p.seatNumber === sbSeat && p.seatNumber >= 0);
    bbPlayer = activePlayers.find(p => p.seatNumber === bbSeat && p.seatNumber >= 0);
    
    // If no player found at calculated seat, find next active player clockwise (decreasing)
    if (!sbPlayer) {
      let attempts = 0;
      let searchSeat = sbSeat;
      while (!sbPlayer && attempts < seatRange) {
        searchSeat = searchSeat - 1 < minSeat ? maxSeat : searchSeat - 1;
        sbPlayer = activePlayers.find(p => p.seatNumber === searchSeat && p.seatNumber >= 0);
        attempts++;
      }
      if (sbPlayer) {
        sbSeat = sbPlayer.seatNumber;
        console.log(`[POKER] SB player not at calculated seat, found at seat ${sbSeat} clockwise`);
      }
    }
    
    if (!bbPlayer) {
      let attempts = 0;
      let searchSeat = bbSeat;
      while (!bbPlayer && attempts < seatRange) {
        searchSeat = searchSeat - 1 < minSeat ? maxSeat : searchSeat - 1;
        bbPlayer = activePlayers.find(p => p.seatNumber === searchSeat && p.seatNumber >= 0 && p.id !== sbPlayer?.id);
        attempts++;
      }
      if (bbPlayer) {
        bbSeat = bbPlayer.seatNumber;
        console.log(`[POKER] BB player not at calculated seat, found at seat ${bbSeat} clockwise`);
      } else {
        bbPlayer = activePlayers.find(p => p.id !== sbPlayer?.id);
        if (bbPlayer) {
          bbSeat = bbPlayer.seatNumber;
          console.log(`[POKER] BB fallback: using seat ${bbSeat} (non-contiguous seats)`);
        }
      }
    }
  }
  
  if (!sbPlayer || !bbPlayer) {
    throw new Error(`Could not find SB or BB players. Dealer seat: ${dealerSeat}, SB seat: ${sbSeat}, BB seat: ${bbSeat}`);
  }

  // Deal hole cards ONLY to active players (eliminated players should not receive cards)
  // IMPORTANT: Filter out eliminated players
  // IMPORTANT: We must keep a consistent ordering between the players we deal to
  // and the players we later persist holeCards for. We use seatNumber ordering
  // for both dealing and mapping so that cards are assigned to the correct seats.
  const deck = tournamentEngine.createShuffledDeck();
  const activeDealtPlayers = game.players
    .filter(p => p.status === 'ACTIVE' && p.chips > 0) // Only ACTIVE players with chips (not ELIMINATED)
    .sort((a, b) => a.seatNumber - b.seatNumber);
  
  if (activeDealtPlayers.length < 2) {
    throw new Error(`Not enough active players to deal cards. Found ${activeDealtPlayers.length} active players with valid seats.`);
  }
  
  console.log(`[POKER] Dealing cards to ${activeDealtPlayers.length} active players (filtered from ${game.players.length} total players)`);
  const { deck: remainingDeck, players: dealtHands } = tournamentEngine.dealHoleCards(
    deck,
    activeDealtPlayers.length
  );

  // Persist hole cards
  // CRITICAL: We must iterate over activeDealtPlayers in the SAME order we dealt cards,
  // not over game.players, to ensure cards are assigned correctly.
  await Promise.all(
    activeDealtPlayers.map((p, index) => {
      const holeCards = JSON.stringify(dealtHands[index]);
      
      // Log card assignment for debugging
      console.log(`[CARD DEAL] Assigning cards to ${p.name || p.userId} (seat ${p.seatNumber}, id: ${p.id}):`, dealtHands[index]);
      
      return prisma.player.update({
        where: { id: p.id },
        data: {
          holeCards,
        },
      });
    })
  );
  
  // Also update eliminated players to have no cards
  const eliminatedPlayers = game.players.filter(p => p.status === 'ELIMINATED');
  await Promise.all(
    eliminatedPlayers.map((p) => {
      return prisma.player.update({
        where: { id: p.id },
        data: {
          holeCards: "",
        },
      });
    })
  );

  // Create betting round
  // Note: startingPot is set to 0 because we track the pot in state.pot
  // The BettingRound only tracks bets for the current street
  const bettingRound = new BettingRound({
    smallBlind,
    bigBlind,
    startingPot: 0
  });

  // Post blinds using postBlinds method (doesn't require minimum raise validation)
  // Handle insufficient chips: player posts what they have
  const sbAmount = Math.min(smallBlind, sbPlayer.chips);
  const bbAmount = Math.min(bigBlind, bbPlayer.chips);
  
  // Post dealer messages for blind posting
  if (io && sbAmount > 0) {
    const sbPlayerName = sbPlayer.name || sbPlayer.user?.username || `Player ${sbPlayer.seatNumber}`;
    if (sbAmount < smallBlind) {
      postDealerMessage(gameId, io, `${sbPlayerName} posts small blind (all-in): ${sbAmount.toLocaleString()}`);
    } else {
      postDealerMessage(gameId, io, `${sbPlayerName} posts small blind: ${sbAmount.toLocaleString()}`);
    }
  }
  
  if (io && bbAmount > 0) {
    const bbPlayerName = bbPlayer.name || bbPlayer.user?.username || `Player ${bbPlayer.seatNumber}`;
    if (bbAmount < bigBlind) {
      postDealerMessage(gameId, io, `${bbPlayerName} posts big blind (all-in): ${bbAmount.toLocaleString()}`);
    } else {
      postDealerMessage(gameId, io, `${bbPlayerName} posts big blind: ${bbAmount.toLocaleString()}`);
    }
  }
  
  if (sbAmount > 0 && bbAmount > 0) {
    bettingRound.postBlinds(sbPlayer.id, bbPlayer.id, sbAmount, bbAmount);
    
    // Deduct chips from players in database (never go below 0)
    if (sbAmount > 0) {
      const newChips = Math.max(0, sbPlayer.chips - sbAmount);
      await prisma.player.update({
        where: { id: sbPlayer.id },
        data: { chips: newChips }
      });
      sbPlayer.chips = newChips;
    }
    
    if (bbAmount > 0) {
      const newChips = Math.max(0, bbPlayer.chips - bbAmount);
      await prisma.player.update({
        where: { id: bbPlayer.id },
        data: { chips: newChips }
      });
      bbPlayer.chips = newChips;
    }
    
    // IMPORTANT: Even if the big blind player is short (posts less than the
    // full big blind and is effectively all-in), the *nominal* current bet
    // for the round should remain the full big blind. This ensures that:
    // - UTG and later players must at least call the full big blind amount,
    //   with any excess over the short-stack's contribution going into a
    //   side pot that the short-stack cannot win.
    // - Minimum bet/raise logic still uses the configured big blind.
    //
    // Side pots are handled later via total contribution tracking and
    // `isBettingComplete`, which treats all‑in players as having contributed
    // the maximum they are able to.
    bettingRound.currentBet = bigBlind;
    bettingRound.minimumRaise = bigBlind;
  }

  // Calculate UTG (first to act after BB)
  // In heads-up (2 players): BB acts first preflop, so UTG = BB
  // In multi-way (3+ players): UTG is the first player clockwise after BB (not BB themselves)
  let utgPlayer;
  let utgSeat;
  
  if (activePlayers.length === 2) {
    // Heads-up: Small blind (dealer) acts first preflop
    utgPlayer = sbPlayer;
    utgSeat = sbSeat;
    console.log(`[POKER] Heads-up game: UTG is SB (seat ${utgSeat})`);
  } else {
    // Multi-way: UTG is first player clockwise after BB (only BB is excluded - dealer or SB can be UTG in 3-handed)
    // Clockwise = decreasing seat numbers (seats numbered anticlockwise)
    utgSeat = bbSeat - 1;
    if (utgSeat < minSeat) utgSeat = maxSeat;
    
    // Find UTG - first active player clockwise after BB (only exclude BB; dealer/SB can be UTG)
    utgPlayer = activePlayers.find(p =>
      p.seatNumber === utgSeat && p.seatNumber >= 0 && p.id !== bbPlayer.id
    );
    
    if (!utgPlayer) {
      let attempts = 0;
      let searchSeat = utgSeat;
      while (!utgPlayer && attempts < activePlayers.length) {
        searchSeat = searchSeat - 1 < minSeat ? maxSeat : searchSeat - 1;
        utgPlayer = activePlayers.find(p =>
          p.seatNumber === searchSeat && p.seatNumber >= 0 && p.id !== bbPlayer.id
        );
        attempts++;
      }
      if (utgPlayer) {
        utgSeat = utgPlayer.seatNumber;
        console.log(`[POKER] UTG player not at calculated seat, found at seat ${utgSeat} clockwise`);
      }
    }
    
    if (!utgPlayer) {
      utgPlayer = activePlayers.find(p => p.seatNumber >= 0 && p.id !== bbPlayer.id);
      if (utgPlayer) {
        utgSeat = utgPlayer.seatNumber;
        console.log(`[POKER] UTG fallback: using seat ${utgSeat} (${utgPlayer.user?.username || utgPlayer.userId})`);
      }
    }
    
    if (!utgPlayer) {
      throw new Error(`Could not find UTG player. BB seat: ${bbSeat}, SB seat: ${sbSeat}, Dealer seat: ${dealerSeat}, Active players: ${activePlayers.length}`);
    }
  }
  
  console.log(`[POKER] UTG calculation: dealer=${dealerSeat}, sb=${sbSeat}, bb=${bbSeat}, utg=${utgSeat} (${utgPlayer.user?.username || utgPlayer.userId})`);

  // Create hand state (explicitly clear showdown so client doesn't show old win/lose styling)
  const state = {
    showdownActive: false,
    showdownResults: null,
    street: "PREFLOP",
    deck: remainingDeck,
    communityCards: [],
    bettingRound,
    pot: game.pot, // Start with game.pot (should be 0 for new hand), current betting round is added separately in buildClientGameState
    dealerSeat: dealerPlayer.seatNumber,
    smallBlindSeat: sbPlayer.seatNumber,
    bigBlindSeat: bbPlayer.seatNumber,
    currentTurnUserId: utgPlayer.userId, // First to act after BB (UTG)
    lastRaiseUserId: null, // Track who last raised (for betting completion check)
    actedPlayersInRound: new Set(), // Track which players have acted in current betting round
    players: await Promise.all(
      game.players.map(async (p) => {
        const updated = await prisma.player.findUnique({ where: { id: p.id } });
        // Parse hole cards from database (stored as JSON string)
        // If updated player has holeCards, use those (parsed if string)
        // Otherwise fall back to p.holeCards (parsed if string)
        // If neither exists, find the correct index in activeDealtPlayers to get from dealtHands
        let holeCards = null;
        if (updated?.holeCards) {
          if (typeof updated.holeCards === 'object') {
            holeCards = updated.holeCards;
          } else if (typeof updated.holeCards === 'string') {
            try {
              holeCards = JSON.parse(updated.holeCards);
            } catch (e) {
              console.warn(`[POKER] Failed to parse holeCards from database for player ${p.id}:`, e.message);
              // Find correct index in activeDealtPlayers
              const activeIndex = activeDealtPlayers.findIndex(ap => ap.id === p.id);
              holeCards = activeIndex >= 0 ? dealtHands[activeIndex] : null;
            }
          }
        } else if (p.holeCards) {
          if (typeof p.holeCards === 'object') {
            holeCards = p.holeCards;
          } else if (typeof p.holeCards === 'string') {
            try {
              holeCards = JSON.parse(p.holeCards);
            } catch (e) {
              console.warn(`[POKER] Failed to parse holeCards from p for player ${p.id}:`, e.message);
              // Find correct index in activeDealtPlayers
              const activeIndex = activeDealtPlayers.findIndex(ap => ap.id === p.id);
              holeCards = activeIndex >= 0 ? dealtHands[activeIndex] : null;
            }
          }
        } else {
          // Find correct index in activeDealtPlayers (not using game.players index!)
          const activeIndex = activeDealtPlayers.findIndex(ap => ap.id === p.id);
          holeCards = activeIndex >= 0 ? dealtHands[activeIndex] : null;
        }
        return {
          ...p,
          user: p.user, // Include user object for test player detection
          chips: updated?.chips || p.chips,
          holeCards: holeCards, // Include parsed hole cards
          contributions: (p.id === sbPlayer.id ? smallBlind : 0) + (p.id === bbPlayer.id ? bigBlind : 0),
          name: p.user?.username || "Player" // Store name for test player detection
        };
      })
    )
  };

  tableState.set(gameId, state);

  // Update game pot
  await prisma.game.update({
    where: { id: gameId },
    data: { pot: state.pot }
  });

  // Broadcast game state to all players
  if (io) {
    const payload = buildClientGameState(game, state);
    io.to(`game:${gameId}`).emit("game-state", payload);
  }

  // Start turn timer for first player to act (UTG)
  // CRITICAL: Ensure currentTurnUserId is UTG, not BB
  console.log(`[POKER] Starting hand: dealer=${dealerPlayer.seatNumber}, sb=${sbPlayer.seatNumber}, bb=${bbPlayer.seatNumber}, utg=${utgPlayer.seatNumber}`);
  console.log(`[POKER] Setting currentTurnUserId to UTG: ${utgPlayer.userId} (${utgPlayer.user?.username || 'unknown'}), NOT BB: ${bbPlayer.userId}`);
  console.log(`[POKER] BB contribution: ${bettingRound.getPlayerContribution(bbPlayer.id)}, currentBet: ${bettingRound.currentBet}`);
  console.log(`[POKER] UTG contribution: ${bettingRound.getPlayerContribution(utgPlayer.id)}, currentBet: ${bettingRound.currentBet}`);
  
  startTurnTimer(gameId, utgPlayer.userId, io);

  console.log(`[POKER] Started hand for game ${gameId}: dealer=${dealerPlayer.seatNumber}, sb=${sbPlayer.seatNumber}, bb=${bbPlayer.seatNumber}, utg=${utgPlayer.seatNumber}`);
  
  return state;
}

/**
 * Start a turn timer for a player
 * Human players: 10 seconds grace period, then 10 second countdown (20 seconds total)
 * Test players: 3 seconds total
 */
function startTurnTimer(gameId, userId, io) {
  // Clear existing timer for this game
  const existingTimer = turnTimers.get(gameId);
  if (existingTimer) {
    clearTimeout(existingTimer.timerId);
    if (existingTimer.graceTimerId) {
      clearTimeout(existingTimer.graceTimerId);
    }
    turnTimers.delete(gameId);
  }

  // Get game state to check if player is test player
  const state = tableState.get(gameId);
  if (!state) return;

  const player = state.players.find((p) => p.userId === userId);
  if (!player) return;

  // Check if test player - test players have username that starts with "Test Player"
  const playerName = player.name || player.user?.username || "";
  const isTestPlayer = playerName.toLowerCase().startsWith('test player');
  
  console.log(`[POKER] startTurnTimer for player ${playerName} (userId: ${userId}): isTestPlayer=${isTestPlayer}`);
  
  // Ensure io is available
  if (!io) {
    console.error(`[POKER] Cannot start turn timer: io is null for gameId ${gameId}`);
    return;
  }

  if (isTestPlayer) {
    // Test players: 3 seconds total, auto-act after
    const timeoutMs = 3000;
    const expiresAt = Date.now() + timeoutMs;
    
    console.log(`[POKER] Starting 3-second timer for test player ${playerName}, will call handleTestPlayerAction`);
    
    const timerId = setTimeout(async () => {
      // Remove this timer from map immediately so startTurnTimer for next player can set theirs
      turnTimers.delete(gameId);

      console.log(`[POKER] Timer expired for test player ${playerName} (userId: ${userId}), calling handleTestPlayerAction at ${new Date().toISOString()}`);
      
      // Verify state still exists before proceeding
      const currentState = tableState.get(gameId);
      if (!currentState) {
        console.error(`[POKER] State missing when timer fired for test player ${playerName}, gameId: ${gameId}`);
        return;
      }
      
      // Verify it's still this player's turn (state may have changed - street advanced, different hand, etc.)
      if (currentState.currentTurnUserId !== userId) {
        console.log(`[POKER] Timer fired for test player ${playerName} but it's no longer their turn (currentTurn=${currentState.currentTurnUserId}). Timer was likely from previous street/hand.`);
        // If it's someone else's turn, start their timer so the hand isn't stuck with no timer
        if (currentState.currentTurnUserId) {
          const nextPlayer = currentState.players.find((p) => p.userId === currentState.currentTurnUserId);
          if (nextPlayer && !turnTimers.has(gameId)) {
            console.log(`[POKER] Starting timer for current turn holder ${nextPlayer.name || currentState.currentTurnUserId} (hand was stuck)`);
            startTurnTimer(gameId, currentState.currentTurnUserId, io);
          }
        }
        // If currentTurnUserId is null, betting might be stuck - check and advance
        if (!currentState.currentTurnUserId) {
          console.log(`[POKER] No current turn - checking if betting is complete and advancing if needed`);
          const activePlayerIds = currentState.players
            .filter(p => p.status !== 'FOLDED' && p.status !== 'ELIMINATED')
            .map(p => p.id);
          
          const bettingComplete = currentState.bettingRound?.isBettingComplete(
            activePlayerIds,
            currentState.lastRaiseUserId,
            currentState.currentTurnUserId,
            currentState.players,
            currentState.actedPlayersInRound || new Set()
          );
          
          if (bettingComplete && currentState.street) {
            if (currentState.street === 'RIVER') {
              await handleShowdown(gameId, io);
            } else {
              await advanceToNextStreet(gameId, io);
            }
          } else if (!bettingComplete) {
            // Betting not complete but no turn - try to find next player
            await moveToNextPlayer(gameId, io);
          }
        }
        
        turnTimers.delete(gameId);
        return;
      }
      
      // Verify player still exists in state
      const currentPlayer = currentState.players.find((p) => p.userId === userId);
      if (!currentPlayer) {
        console.error(`[POKER] Player not found in state when timer fired for userId: ${userId}`);
        turnTimers.delete(gameId);
        try {
          await moveToNextPlayer(gameId, io);
        } catch (moveErr) {
          console.error(`[POKER] Error moving to next player after player not found:`, moveErr);
        }
        return;
      }
      
      try {
        await handleTestPlayerAction(gameId, userId, io);
      } catch (err) {
        console.error(`[POKER] Error in handleTestPlayerAction for test player ${playerName}:`, err);
        console.error(`[POKER] Error stack:`, err.stack);
        // Try to move to next player if action failed
        try {
          await moveToNextPlayer(gameId, io);
        } catch (moveErr) {
          console.error(`[POKER] Error moving to next player after test player action failure:`, moveErr);
          console.error(`[POKER] Move error stack:`, moveErr.stack);
        }
      }
    }, timeoutMs);

    turnTimers.set(gameId, { timerId, userId, expiresAt, duration: timeoutMs });

    // Emit timer start immediately for test players
    if (io) {
      io.to(`game:${gameId}`).emit("turn-timer-start", {
        gameId,
        userId,
        expiresAt,
        duration: timeoutMs
      });
    }
  } else {
    // Human players: 10 seconds grace, then 10 second countdown (20 seconds total)
    const gracePeriodMs = 10000;
    const countdownMs = 10000;
    const totalTimeoutMs = gracePeriodMs + countdownMs;
    const expiresAt = Date.now() + totalTimeoutMs;
    
    // After grace period, emit timer start event (shows countdown)
    const graceTimerId = setTimeout(() => {
      if (io) {
        io.to(`game:${gameId}`).emit("turn-timer-start", {
          gameId,
          userId,
          expiresAt,
          duration: countdownMs
        });
      }
    }, gracePeriodMs);

    // After total timeout, auto-fold
    const timeoutTimerId = setTimeout(() => {
      autoFoldPlayer(gameId, userId, io);
    }, totalTimeoutMs);

    // Store both timers
    turnTimers.set(gameId, { 
      timerId: timeoutTimerId, 
      graceTimerId,
      userId, 
      expiresAt, 
      duration: countdownMs,
      gracePeriodMs 
    });
  }
}

/**
 * Auto-fold a player when their timer expires
 */
async function autoFoldPlayer(gameId, userId, io) {
  try {
    const state = await applyPlayerAction({
      gameId,
      userId,
      action: "FOLD",
      amount: 0,
      io
    });

    const game = await prisma.game.findUnique({
      where: { id: gameId },
      include: {
        players: {
          include: { user: true }
        }
      }
    });

    if (!game) return;

    // Move to next player
    await moveToNextPlayer(gameId, io);

    const payload = buildClientGameState(game, state);
    if (io) {
      io.to(`game:${gameId}`).emit("game-state", payload);
    }
  } catch (err) {
    console.error("[POKER] Error auto-folding player:", err);
  }
}

/**
 * Handle test player auto-action (simple logic: 30% fold, 40% call/check, 30% bet)
 */
async function handleTestPlayerAction(gameId, userId, io) {
  try {
    console.log(`[POKER] handleTestPlayerAction called for userId: ${userId}`);
    const state = tableState.get(gameId);
    if (!state) {
      console.log(`[POKER] No state found for gameId: ${gameId} - game may have ended or new hand starting`);
      // Clear timer - can't proceed without state
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
    
    // Verify it's still this player's turn before proceeding
    if (state.currentTurnUserId !== userId) {
      console.log(`[POKER] handleTestPlayerAction: It's no longer ${userId}'s turn (currentTurn=${state.currentTurnUserId}). State may have changed.`);
      // Clear timer and try to find next player
      const existingTimer = turnTimers.get(gameId);
      if (existingTimer) {
        clearTimeout(existingTimer.timerId);
        if (existingTimer.graceTimerId) {
          clearTimeout(existingTimer.graceTimerId);
        }
        turnTimers.delete(gameId);
      }
      
      // If no current turn, try to find next player or check betting completion
      if (!state.currentTurnUserId) {
        console.log(`[POKER] No current turn - attempting to move to next player`);
        try {
          await moveToNextPlayer(gameId, io);
        } catch (err) {
          console.error(`[POKER] Error in moveToNextPlayer after stale timer:`, err);
        }
      }
      return;
    }

    const player = state.players.find((p) => p.userId === userId);
    if (!player) {
      console.log(`[POKER] Player not found in state for userId: ${userId} - they may have been eliminated`);
      // Clear timer and try to move to next player
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
        console.error(`[POKER] Error moving to next player after player not found:`, err);
      }
      return;
    }
    if (player.status === 'FOLDED' || player.status === 'ELIMINATED') {
      console.log(`[POKER] Player ${player.name || userId} is already ${player.status}, skipping action`);
      // Clear timer and move to next player
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
        console.error(`[POKER] Error moving to next player after ${player.status} player:`, err);
      }
      return;
    }
    if (player.chips === 0 || player.status === 'ALL_IN') {
      console.log(`[POKER] Test player ${player.name || userId} is all-in (0 chips), skipping action and advancing`);
      if (player.status !== 'ALL_IN') player.status = 'ALL_IN';
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
        console.error(`[POKER] Error moving to next player after all-in:`, err);
      }
      return;
    }

    console.log(`[POKER] Test player ${player.name || userId} is acting...`);

    const currentBet = state.bettingRound?.currentBet || 0;
    const bigBlind = state.bettingRound?.bigBlind || 20;
    const myChips = player.chips;
    const myContribution = state.bettingRound?.getPlayerContribution(player.id) || 0;
    const amountToCall = currentBet - myContribution;
    const canCheck = amountToCall === 0;

    // Simple random logic
    // Test players should NOT fold if they can check
    const rand = Math.random();
    
    let action, amount;
    
    if (canCheck) {
      // Can check - never fold, choose between check or bet/raise
      if (rand < 0.6) {
        // 60% check
        action = "CHECK";
        amount = 0;
        console.log(`[POKER] Test player ${player.name || userId} decided to CHECK (rand=${rand.toFixed(2)})`);
      } else {
        // 40% bet/raise
        const minRaiseAmount = currentBet + (state.bettingRound?.minimumRaise || bigBlind);
        const halfPot = Math.floor((state.pot || 0) / 2);
        const totalBetAmount = Math.max(minRaiseAmount, halfPot);
        
        // For RAISE/BET, we need the additional amount to add, not total
        const additionalAmount = totalBetAmount - myContribution;
        amount = Math.min(Math.max(additionalAmount, 0), myChips);
        
        if (currentBet === 0) {
          action = "BET";
          console.log(`[POKER] Test player ${player.name || userId} decided to BET ${amount} (rand=${rand.toFixed(2)})`);
        } else {
          action = "RAISE";
          console.log(`[POKER] Test player ${player.name || userId} decided to RAISE ${amount} (total bet would be ${myContribution + amount}) (rand=${rand.toFixed(2)})`);
        }
      }
    } else {
      // Cannot check - must fold, call, or raise
      if (rand < 0.3) {
        // 30% fold
        action = "FOLD";
        amount = 0;
        console.log(`[POKER] Test player ${player.name || userId} decided to FOLD (rand=${rand.toFixed(2)})`);
      } else if (rand < 0.7) {
        // 40% call
        action = "CALL";
        amount = Math.min(amountToCall, myChips);
        console.log(`[POKER] Test player ${player.name || userId} decided to CALL ${amount} (rand=${rand.toFixed(2)})`);
      } else {
        // 30% bet/raise
        const minimumRaise = state.bettingRound?.minimumRaise || bigBlind;
        const minRaiseAmount = currentBet + minimumRaise;
        const halfPot = Math.floor((state.pot || 0) / 2);
        const totalBetAmount = Math.max(minRaiseAmount, halfPot);
        
        // For RAISE/BET, we need the additional amount to add, not total
        const additionalAmount = totalBetAmount - myContribution;
        
        // Check if player has enough chips for a valid raise
        // A raise requires: newContribution > currentBet AND (newContribution - currentBet) >= minimumRaise
        // So we need: (myContribution + amount) > currentBet AND amount >= minimumRaise
        // Since amount = additionalAmount capped to myChips, we need to verify it meets minimum raise
        const minAdditionalForRaise = currentBet > 0 ? Math.max(minimumRaise, currentBet + minimumRaise - myContribution) : minimumRaise;
        
        // If player doesn't have enough chips for a minimum raise, fall back to call
        if (myChips < minAdditionalForRaise) {
          // Can't raise - fall back to call
          action = "CALL";
          amount = Math.min(amountToCall, myChips);
          console.log(`[POKER] Test player ${player.name || userId} doesn't have enough chips for raise, calling ${amount} instead (rand=${rand.toFixed(2)})`);
        } else {
          // Cap amount to available chips, ensuring it meets minimum raise requirement
          amount = Math.min(Math.max(additionalAmount, minAdditionalForRaise), myChips);
          
          if (currentBet === 0) {
            action = "BET";
            console.log(`[POKER] Test player ${player.name || userId} decided to BET ${amount} (rand=${rand.toFixed(2)})`);
          } else {
            action = "RAISE";
            console.log(`[POKER] Test player ${player.name || userId} decided to RAISE ${amount} (total bet would be ${myContribution + amount}, minRaise=${minimumRaise}, rand=${rand.toFixed(2)})`);
          }
        }
      }
    }

    // Apply the action - if raise fails due to minimum raise requirement, fall back to call
    let newState;
    try {
      newState = await applyPlayerAction({
        gameId,
        userId,
        action,
        amount,
        io
      });
    } catch (error) {
      // If raise/bet fails due to minimum raise requirement or insufficient chips, fall back to call
      if ((action === "RAISE" || action === "BET") && 
          (error.message?.includes("Raise below minimum raise size") || 
           error.message?.includes("Insufficient chips"))) {
        console.log(`[TEST PLAYER] ${action} failed for ${player.name || userId}: ${error.message}. Falling back to CALL.`);
        // Fall back to call
        action = "CALL";
        amount = Math.min(amountToCall, myChips);
        newState = await applyPlayerAction({
          gameId,
          userId,
          action,
          amount,
          io
        });
      } else {
        // Re-throw other errors
        throw error;
      }
    }

    const game = await prisma.game.findUnique({
      where: { id: gameId },
      include: {
        players: {
          include: { user: true }
        }
      }
    });

    if (!game) return;

    // CRITICAL: Only eliminate players with 0 chips if there's no active hand
    // During an active hand, all-in players should stay until the hand completes
    const hasActiveHandNow = hasActiveHand(gameId);
    
    if (!hasActiveHandNow) {
      // No active hand - safe to eliminate players with 0 chips
      const { TournamentEngine } = await import("../../services/TournamentEngine.js");
      const tournamentEngine = new TournamentEngine();
      
      const playersToEliminate = newState.players.filter(
        p => p.chips <= 0 && p.status === 'ACTIVE'
      );
      
      for (const player of playersToEliminate) {
        console.log(`[TEST PLAYER] Eliminating player ${player.name || player.userId} with ${player.chips} chips (no active hand)`);
        player.status = 'ELIMINATED';
        // Don't change seatNumber - keep it to avoid unique constraint violation
        // ELIMINATED players are filtered out by status, not seatNumber
        
        await prisma.player.update({
          where: { id: player.id },
          data: { 
            status: 'ELIMINATED'
            // Keep seatNumber - eliminated players filtered by status
          }
        }).catch(err => console.error(`[TEST PLAYER] Error eliminating player ${player.id}:`, err));
        
        if (game.tournament) {
          await tournamentEngine.onPlayerBust(game.tournament.id, player.id).catch(err => {
            console.error(`[TEST PLAYER] Error notifying tournament of player bust:`, err);
          });
        }
      }
    } else {
      // Active hand in progress - don't eliminate all-in players yet
      // Mark them as ALL_IN if they have 0 chips but are still in the hand
      const allInPlayers = newState.players.filter(
        p => p.chips <= 0 && p.status === 'ACTIVE'
      );
      
      for (const player of allInPlayers) {
        player.status = 'ALL_IN';
        console.log(`[TEST PLAYER] Player ${player.name || player.userId} is all-in with ${player.chips} chips (keeping in hand until completion)`);
      }
    }

    // Check if betting round is complete (same logic as regular player action)
    const activePlayerIds = newState.players
      .filter(p => p.status !== 'FOLDED' && p.status !== 'ELIMINATED')
      .map(p => p.id);
    
    console.log(`[TEST PLAYER] Checking betting complete after ${action} by ${player.name || userId}`);
    console.log(`[TEST PLAYER] Active players: ${activePlayerIds.length}, lastRaiseUserId=${newState.lastRaiseUserId || 'null'}, currentTurnUserId=${newState.currentTurnUserId || 'null'}`);
    
    const bettingComplete = newState.bettingRound.isBettingComplete(
      activePlayerIds, 
      newState.lastRaiseUserId,
      newState.currentTurnUserId,
      newState.players,
      newState.actedPlayersInRound || new Set()
    );
    
    console.log(`[TEST PLAYER] Betting complete? ${bettingComplete}`);
    
    if (bettingComplete) {
      // Check if only 1 player remains - award pot immediately without dealing cards
      const activePlayersAfterAction = newState.players.filter(p => p.status !== 'FOLDED' && p.status !== 'ELIMINATED');
      console.log(`[TEST PLAYER] Active players after action: ${activePlayersAfterAction.length}`);
      
      if (activePlayersAfterAction.length === 1) {
        // Only one player remaining - award pot and end hand (same logic as regular player action)
        const winner = activePlayersAfterAction[0];
        const collectedPot = newState.bettingRound.getTotalPot();
        const totalPot = newState.pot + collectedPot;
        
        const winnerName = winner.name || winner.user?.username || `Player ${winner.seatNumber}`;
        
        winner.chips += totalPot;
        newState.pot = 0;
        
        console.log(`[TEST PLAYER] Single player remaining - awarding pot of ${totalPot} to ${winnerName}`);
        
        // Post dealer message for chip winner
        if (io) {
          postDealerMessage(gameId, io, `${winnerName} wins ${totalPot.toLocaleString()} (all other players folded)`);
        }
        
        // Update winner chips in database (async)
        prisma.player.update({
          where: { id: winner.id },
          data: { chips: winner.chips }
        }).catch(err => console.error('[TEST PLAYER] Error updating winner chips:', err));
        
        // Update game pot in database (async)
        prisma.game.update({
          where: { id: gameId },
          data: { pot: 0 }
        }).catch(err => console.error('[TEST PLAYER] Error updating game pot:', err));
        
        // Clear hand state
        const savedPlayers = [...newState.players];
        tableState.delete(gameId);
        
        // Reset player statuses and start new hand (async)
        // IMPORTANT: Only reset players who are NOT eliminated
        setTimeout(async () => {
          const resetPromises = savedPlayers
            .filter(p => p.status !== 'ELIMINATED' && p.chips > 0) // Only reset non-eliminated players with chips
            .map(p =>
              prisma.player.update({
                where: { id: p.id },
                data: { 
                  status: 'ACTIVE',
                  holeCards: "",
                  lastAction: null
                }
              }).catch(err => console.error(`[TEST PLAYER] Error resetting player ${p.id}:`, err))
            );
          
          await Promise.all(resetPromises);
          console.log(`[TEST PLAYER] All players reset for next hand`);
          
          // Start new hand after resetting players
          const gameForNextHand = await prisma.game.findUnique({
            where: { id: gameId },
            include: {
              players: {
                include: { user: true }
              },
              tournament: true
            }
          });
          
          if (gameForNextHand && gameForNextHand.players.length >= 2) {
            // Check if blind level should advance (for tournaments)
            if (gameForNextHand.tournament && gameForNextHand.tournament.status === 'RUNNING') {
              await checkAndAdvanceBlindLevel(gameForNextHand.tournament.id, gameId, io);
            }
            
            // Start new hand (dealer will be selected/rotated in startHandForGame)
            if (io) {
              try {
                await startHandForGame(gameId, io);
                console.log(`[TEST PLAYER] Started new hand after pot award`);
              } catch (err) {
                console.error(`[TEST PLAYER] Error starting new hand:`, err);
              }
            }
          }
        }, 2000);
        
        // Emit updated state
        const updatedGameFromState = {
          id: gameId,
          pot: 0,
          players: newState.players.map(p => ({
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
        const payload = buildClientGameState(updatedGameFromState, newState);
        if (io) io.to(`game:${gameId}`).emit("game-state", payload);
        return; // Don't advance to next street
      }
      
      // Multiple players remaining - advance to next street
      console.log(`[TEST PLAYER] Multiple players remaining, advancing to next street or showdown...`);
      console.log(`[TEST PLAYER] Current street: ${newState.street || 'PREFLOP'}`);
      
      try {
        if (newState.street === 'RIVER') {
          console.log(`[TEST PLAYER] On RIVER - going to showdown`);
          await handleShowdown(gameId, io);
        } else {
          console.log(`[TEST PLAYER] Advancing from ${newState.street || 'PREFLOP'} to next street`);
          await advanceToNextStreet(gameId, io);
        }
        
        // Get updated state after advancing street
        const updatedState = tableState.get(gameId);
        if (!updatedState) {
          console.error(`[TEST PLAYER] ERROR: State missing after advancing street!`);
          return;
        }
        
        const updatedGame = await prisma.game.findUnique({
          where: { id: gameId },
          include: { players: { include: { user: true } } }
        });
        
        if (updatedGame && updatedState) {
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
          if (io) {
            io.to(`game:${gameId}`).emit("game-state", payload);
            console.log(`[TEST PLAYER] Emitted game state after advancing street/showdown`);
          }
        } else {
          console.error(`[TEST PLAYER] ERROR: Could not fetch game or state after advancing street!`);
        }
      } catch (advanceError) {
        console.error(`[TEST PLAYER] ERROR advancing to next street/showdown:`, advanceError);
        console.error(`[TEST PLAYER] Error stack:`, advanceError.stack);
        // Try to recover by moving to next player
        try {
          await moveToNextPlayer(gameId, io);
        } catch (moveError) {
          console.error(`[TEST PLAYER] ERROR in recovery moveToNextPlayer:`, moveError);
        }
      }
    } else {
      // Move to next player in current betting round
      await moveToNextPlayer(gameId, io);
      const payload = buildClientGameState(game, newState);
      if (io) io.to(`game:${gameId}`).emit("game-state", payload);
    }
  } catch (err) {
    console.error("[POKER] Error handling test player action:", err);
  }
}

/**
 * Handle showdown when river betting completes - determine winners and distribute pot
 * @param {object} [options] - Optional: { cleanupDelayMs } - delay before mucking cards and starting next hand
 */
async function handleShowdown(gameId, io, options = {}) {
  const state = tableState.get(gameId);
  if (!state) return;

  const evaluator = new HandEvaluator();
  
  // Collect pot from current betting round
  const collectedPot = state.bettingRound.getTotalPot();
  const oldPot = state.pot || 0;
  state.pot = oldPot + collectedPot;
  
  // Only include players who are still in the hand (not folded, not eliminated)
  // ALL_IN players are still in the hand and should be included for showdown
  const activePlayers = state.players.filter(p => 
    p.status !== 'FOLDED' && 
    p.status !== 'ELIMINATED'
  );
  
  if (activePlayers.length === 0) {
    console.log(`[SHOWDOWN] No active players for showdown`);
    return;
  }

  console.log(`[SHOWDOWN] Starting showdown with ${activePlayers.length} active players (excluding folded players)`);
  console.log(`[SHOWDOWN] Community cards:`, state.communityCards);
  console.log(`[SHOWDOWN] Total pot: ${state.pot} (old: ${oldPot}, collected: ${collectedPot})`);

  // Post dealer message about showdown
  if (io) {
    postDealerMessage(gameId, io, "Showdown! Turning over cards...");
  }

  // Evaluate all active players' hands
  const handResults = activePlayers.map(player => {
    if (!player.holeCards || !Array.isArray(player.holeCards) || player.holeCards.length !== 2) {
      console.warn(`[SHOWDOWN] Player ${player.name || player.userId} (seat ${player.seatNumber}) has invalid hole cards:`, player.holeCards);
      return { player, hand: null, strength: -1 };
    }

    const sevenCards = [...state.communityCards, ...player.holeCards];

    // Debug logging: show full 7-card hand for each player at showdown so we
    // can verify the server is evaluating the same cards you see on screen.
    // Log full 7-card hand for debugging
    console.log(
      `[SHOWDOWN] Evaluating 7 cards for ${player.name || player.userId} (seat ${player.seatNumber}, id: ${player.id}):`,
      {
        holeCards: player.holeCards,
        community: state.communityCards,
        sevenCards: sevenCards
      }
    );

    const hand = evaluator.evaluateBestHand(sevenCards);
    
    console.log(`[SHOWDOWN] Player ${player.name || player.userId} (seat ${player.seatNumber}, id: ${player.id}): ${hand.category}, strength=${hand.strength}, bestFive=${JSON.stringify(hand.bestFive)}`);
    
    return {
      player,
      hand,
      strength: hand.strength
    };
  }).filter(result => result.hand !== null);

  if (handResults.length === 0) {
    console.error(`[SHOWDOWN] No valid hands evaluated`);
    return;
  }

  // Find maximum strength (best hand)
  const maxStrength = Math.max(...handResults.map(r => r.strength));
  const winners = handResults.filter(r => r.strength === maxStrength);

  console.log(`[SHOWDOWN] ${winners.length} winner(s) with strength ${maxStrength}:`);
  winners.forEach(w => {
    console.log(`[SHOWDOWN]   Winner: ${w.player.name || w.player.userId} (seat ${w.player.seatNumber}) - ${w.hand.category}`);
  });

  // Post dealer message about winners (will be updated after side pot calculation)

  // Calculate side pots based on all-in contributions
  // Track total contributions per player across entire hand (all streets)
  const totalContributions = new Map();
  
  // Initialize with current betting round contributions
  activePlayers.forEach(player => {
    const currentContribution = state.bettingRound.getPlayerContribution(player.id);
    // Also check player.contributions (which tracks blinds from start of hand)
    const handContribution = player.contributions || 0;
    totalContributions.set(player.id, handContribution + currentContribution);
  });
  
  // Include folded players who contributed (for accurate side pot calculation)
  const allPlayersWhoContributed = state.players.filter(p => {
    const contribution = (p.contributions || 0) + (state.bettingRound.getPlayerContribution(p.id) || 0);
    return contribution > 0;
  });
  
  // Build complete contribution map including folded players
  allPlayersWhoContributed.forEach(player => {
    const handContribution = player.contributions || 0;
    const currentContribution = state.bettingRound.getPlayerContribution(player.id) || 0;
    totalContributions.set(player.id, handContribution + currentContribution);
  });
  
  // Get unique contribution amounts (sorted ascending)
  const contributionAmounts = Array.from(new Set(totalContributions.values())).sort((a, b) => a - b);
  
  console.log(`[SHOWDOWN] Total contributions:`, Array.from(totalContributions.entries()).map(([id, amount]) => {
    const player = activePlayers.find(p => p.id === id);
    return `${player?.name || player?.userId || id}: ${amount}`;
  }));
  console.log(`[SHOWDOWN] Unique contribution levels:`, contributionAmounts);
  
  // Calculate side pots correctly
  // Side pot logic: For each contribution level, create a pot with players who contributed at least that amount
  const sidePots = [];
  let previousLevel = 0;
  
  for (let i = 0; i < contributionAmounts.length; i++) {
    const currentLevel = contributionAmounts[i];
    
    // Find all players who contributed at least this amount (eligible for this side pot)
    const eligiblePlayerIds = Array.from(totalContributions.entries())
      .filter(([id, contribution]) => contribution >= currentLevel)
      .map(([id]) => id);
    
    if (eligiblePlayerIds.length === 0) continue;
    
    // Calculate pot amount: each eligible player contributes (currentLevel - previousLevel)
    const potAmount = (currentLevel - previousLevel) * eligiblePlayerIds.length;
    
    if (potAmount > 0) {
      sidePots.push({
        level: currentLevel,
        amount: potAmount,
        eligiblePlayerIds: eligiblePlayerIds
      });
      console.log(`[SHOWDOWN] Side pot ${i + 1}: ${potAmount} chips (level ${currentLevel}), ${eligiblePlayerIds.length} eligible players`);
    }
    
    previousLevel = currentLevel;
  }
  
  // Calculate total pot amount from side pots
  const calculatedPotTotal = sidePots.reduce((sum, pot) => sum + pot.amount, 0);
  
  // If calculated total doesn't match actual pot, scale side pots to match actual
  // so we never distribute negative or excess chips.
  const actualPot = state.pot;
  if (calculatedPotTotal !== actualPot && sidePots.length > 0) {
    console.log(`[SHOWDOWN] Pot mismatch: calculated=${calculatedPotTotal}, actual=${actualPot}, adjusting...`);
    if (calculatedPotTotal > 0 && calculatedPotTotal >= actualPot) {
      // Scale down so total = actualPot (avoid negative side pot)
      const scale = actualPot / calculatedPotTotal;
      let running = 0;
      for (let i = 0; i < sidePots.length; i++) {
        const scaled = i === sidePots.length - 1
          ? Math.max(0, actualPot - running)
          : Math.max(0, Math.floor(sidePots[i].amount * scale));
        sidePots[i].amount = scaled;
        running += scaled;
      }
    } else {
      sidePots[sidePots.length - 1].amount = Math.max(0, sidePots[sidePots.length - 1].amount + (actualPot - calculatedPotTotal));
    }
  } else if (sidePots.length === 0 && actualPot > 0) {
    sidePots.push({
      level: contributionAmounts[contributionAmounts.length - 1] || 0,
      amount: actualPot,
      eligiblePlayerIds: activePlayers.map(p => p.id)
    });
  }
  
  // Distribute each side pot (skip pots with amount <= 0)
  const totalWon = new Map();
  activePlayers.forEach(p => totalWon.set(p.id, 0));

  // Heads-up: the single winner takes the entire pot (no "orphan" side pot to the loser)
  const isHeadsUp = handResults.length === 2;
  const overallWinner = isHeadsUp
    ? handResults.reduce((best, r) => (r.strength > best.strength ? r : best), handResults[0])
    : null;

  for (const pot of sidePots) {
    if (pot.amount <= 0) continue;
    let potWinners;
    if (isHeadsUp && overallWinner) {
      potWinners = [overallWinner];
      console.log(`[SHOWDOWN] Side pot ${pot.level}: heads-up, awarding ${pot.amount} chips to overall winner`);
    } else {
      const eligibleHandResults = handResults.filter(r =>
        pot.eligiblePlayerIds.includes(r.player.id)
      );
      if (eligibleHandResults.length === 0) continue;
      const maxStrength = Math.max(...eligibleHandResults.map(r => r.strength));
      potWinners = eligibleHandResults.filter(r => r.strength === maxStrength);
    }
    const potPerWinner = Math.floor(pot.amount / potWinners.length);
    const remainder = pot.amount % potWinners.length;

    console.log(`[SHOWDOWN] Side pot ${pot.level}: ${potWinners.length} winner(s) for ${pot.amount} chips`);

    potWinners.forEach((winner, index) => {
      const amount = potPerWinner + (index === 0 ? remainder : 0);
      if (amount <= 0) return;
      const currentWon = totalWon.get(winner.player.id) || 0;
      totalWon.set(winner.player.id, currentWon + amount);
      winner.player.chips += amount;
      console.log(`[SHOWDOWN]   Distributing ${amount} chips to ${winner.player.name || winner.player.userId} (seat ${winner.player.seatNumber}) from side pot level ${pot.level}`);
    });
  }
  
  // Update player chips in database – MUST complete before we clear state / start next hand.
  // If a player was already removed (e.g. by consolidation), skip update (P2025).
  await Promise.all(
    activePlayers.map(player => {
      const won = totalWon.get(player.id) || 0;
      if (won > 0) {
        return prisma.player.update({
          where: { id: player.id },
          data: { chips: player.chips }
        }).catch(err => {
          if (err?.code === 'P2025') {
            console.log(`[SHOWDOWN] Player ${player.id} already removed (consolidation), skipping chip update`);
          } else {
            console.error(`[SHOWDOWN] Error updating chips for player ${player.id}:`, err);
          }
        });
      }
      return Promise.resolve();
    })
  );
  
  // Build updated winners list with total winnings for display
  const finalWinners = Array.from(totalWon.entries())
    .filter(([id, amount]) => amount > 0)
    .map(([id, amount]) => {
      const handResult = handResults.find(r => r.player.id === id);
      return {
        player: handResult.player,
        hand: handResult.hand,
        strength: handResult.strength,
        potWon: amount
      };
    })
    .sort((a, b) => b.potWon - a.potWon); // Sort by amount won
  
  // Update winners for dealer message
  const updatedWinners = finalWinners;
  
  // Post dealer message about winners
  if (io) {
    const winnerMessages = updatedWinners.map(w => {
      const name = w.player.name || w.player.user?.username || `Player ${w.player.seatNumber}`;
      return `${name} wins ${w.potWon.toLocaleString()} with ${w.hand.category}`;
    });
    
    if (updatedWinners.length === 1) {
      postDealerMessage(gameId, io, winnerMessages[0] + '!');
    } else if (sidePots.length > 1) {
      postDealerMessage(gameId, io, `Side pots: ${winnerMessages.join(', ')}`);
    } else {
      postDealerMessage(gameId, io, `${updatedWinners.map(w => w.player.name || w.player.user?.username || `Player ${w.player.seatNumber}`).join(' and ')} tie! Pot split ${updatedWinners.length} ways.`);
    }
  }

  // Fetch game from database for tournament info and player data
  const game = await prisma.game.findUnique({
    where: { id: gameId },
    include: {
      players: {
        include: { user: true }
      },
      tournament: true
    }
  });

  if (!game) {
    console.error(`[SHOWDOWN] Game not found for gameId: ${gameId}`);
    return;
  }

  // Mark hand as complete BEFORE elimination (which may trigger table consolidation)
  // This ensures hasActiveHand() returns false immediately
  state.currentTurnUserId = null;
  state.street = null;
  tableState.set(gameId, state);
  console.log(`[SHOWDOWN] Marked hand as complete - hasActiveHand will now return false`);

  // Check for player elimination after distributing pot
  const { TournamentEngine } = await import("../../services/TournamentEngine.js");
  const tournamentEngine = new TournamentEngine();
  const bustedPlayerIds = [];
  
  // Eliminate ALL players with 0 chips (batch for single consolidation).
  // Ignore P2025 (record not found): another table's consolidation may have already deleted them.
  for (const handResult of handResults) {
    if (handResult.player.chips <= 0 && handResult.player.status !== 'ELIMINATED') {
      console.log(`[SHOWDOWN] Player ${handResult.player.name || handResult.player.userId} eliminated with 0 chips`);
      handResult.player.status = 'ELIMINATED';
      try {
        await prisma.player.update({
          where: { id: handResult.player.id },
          data: { status: 'ELIMINATED' }
        });
        bustedPlayerIds.push(handResult.player.id);
      } catch (err) {
        if (err?.code === 'P2025') {
          console.log(`[SHOWDOWN] Player ${handResult.player.id} already removed (consolidation)`);
        } else {
          throw err;
        }
      }
    }
  }

  const allPlayersWith0Chips = state.players.filter(
    p => p.chips <= 0 && p.status !== 'ELIMINATED' && p.status !== 'FOLDED'
  );

  for (const player of allPlayersWith0Chips) {
    if (handResults.some(hr => hr.player.id === player.id)) continue;
    console.log(`[SHOWDOWN] Eliminating player ${player.name || player.userId} with ${player.chips} chips (not in hand results)`);
    player.status = 'ELIMINATED';
    try {
      await prisma.player.update({
        where: { id: player.id },
        data: { status: 'ELIMINATED' }
      });
      bustedPlayerIds.push(player.id);
    } catch (err) {
      if (err?.code === 'P2025') {
        console.log(`[SHOWDOWN] Player ${player.id} already removed (consolidation)`);
      } else {
        console.error(`[SHOWDOWN] Error eliminating player ${player.id}:`, err);
      }
    }
  }
  
  // Process all busts and run consolidation once (avoids race / duplicate consolidation)
  if (game.tournament && bustedPlayerIds.length > 0) {
    await tournamentEngine.onPlayersBust(game.tournament.id, bustedPlayerIds);
  }

  if (game?.tournament && io) {
    await emitIfTournamentCompleted(game.tournament.id, gameId, io);
  }

  // Reset pot
  state.pot = 0;

  // Update game pot in database (async)
  prisma.game.update({
    where: { id: gameId },
    data: { pot: 0 }
  }).catch(err => console.error(`[SHOWDOWN] Error updating game pot:`, err));

  if (!game) return;

  // Build result payload for clients - include winning card information
  const showdownResults = {
    winners: updatedWinners.map(w => ({
      playerId: w.player.id,
      userId: w.player.userId,
      name: w.player.name || w.player.user?.username || `Player ${w.player.seatNumber}`,
      seatNumber: w.player.seatNumber,
      handCategory: w.hand.category,
      potWon: w.potWon,
      hand: {
        ...w.hand,
        cards: w.hand.bestFive || [] // Map bestFive to cards for client compatibility
      }
    })),
    allHands: handResults.map(r => ({
      playerId: r.player.id,
      userId: r.player.userId,
      name: r.player.name || r.player.user?.username || `Player ${r.player.seatNumber}`,
      seatNumber: r.player.seatNumber,
      handCategory: r.hand.category,
      strength: r.strength,
      hand: {
        ...r.hand,
        cards: r.hand.bestFive || [] // Map bestFive to cards for client compatibility
      }
    })),
    showdownActive: true // Flag to indicate showdown is active
  };
  
  // Mark all active players' cards as face-up for showdown
  state.showdownActive = true;
  state.showdownResults = showdownResults;
  
  // CRITICAL: Mark hand as complete BEFORE elimination triggers consolidation
  // This ensures hasActiveHand() returns false immediately
  state.currentTurnUserId = null; // Clear turn to mark hand as complete
  state.street = null; // Clear street to mark hand as complete
  tableState.set(gameId, state); // Save updated state

  // Emit showdown results
  if (io) {
    io.to(`game:${gameId}`).emit("showdown", {
      gameId,
      results: showdownResults
    });

    // Also emit updated game state
    const payload = buildClientGameState(game, state);
    io.to(`game:${gameId}`).emit("game-state", payload);
  }

  // Clear hand state after a delay (allow clients to see results clearly)
  const cleanupDelayMs = options?.cleanupDelayMs ?? 8000;
  setTimeout(async () => {
    tableState.delete(gameId);

    // Re-fetch game and current players so we only touch rows that still exist
    // (another table's consolidation may have deleted this table's players and recreated elsewhere)
    const gameForNextHand = await prisma.game.findUnique({
      where: { id: gameId },
      include: {
        players: { include: { user: true } },
        tournament: true
      }
    });
    if (!gameForNextHand || gameForNextHand.status !== 'ACTIVE' || gameForNextHand.players.length === 0) {
      console.log(`[SHOWDOWN] Game ${gameId} no longer active or no players (consolidated?), skipping cleanup`);
      return;
    }

    console.log(`[SHOWDOWN] Clearing hand state for next hand`);
    // Reset only current DB players (avoids P2025 on deleted rows after consolidation)
    const resetPromises = gameForNextHand.players.map(p => {
      const isEliminated = p.status === 'ELIMINATED';
      const hasNoChips = (p.chips ?? 0) <= 0;
      const status = hasNoChips && !isEliminated ? 'ELIMINATED' : (isEliminated ? 'ELIMINATED' : 'ACTIVE');
      return prisma.player.update({
        where: { id: p.id },
        data: { status, holeCards: '', lastAction: null }
      }).catch(err => {
        if (err?.code === 'P2025') {
          console.log(`[SHOWDOWN] Player ${p.id} already removed (consolidation)`);
        } else {
          console.error(`[SHOWDOWN] Error resetting player ${p.id}:`, err);
        }
      });
    });

    Promise.all(resetPromises).then(async () => {
      console.log(`[SHOWDOWN] All players reset for next hand`);
      // Re-fetch in case consolidation ran during reset
      const gameForNextHand = await prisma.game.findUnique({
        where: { id: gameId },
        include: {
          players: { include: { user: true } },
          tournament: true
        }
      });

      if (gameForNextHand && gameForNextHand.players.length >= 2) {
        const activePlayerCount = gameForNextHand.players.filter(p => p.status === 'ACTIVE').length;
        
        if (activePlayerCount < 2 && gameForNextHand.tournament?.status === 'RUNNING') {
          console.log(`[SHOWDOWN] Not enough active players (${activePlayerCount}) at this table - triggering consolidation to rebalance`);
          try {
            const { TournamentEngine } = await import("../../services/TournamentEngine.js");
            const tournamentEngine = new TournamentEngine();
            await tournamentEngine.consolidateTables(gameForNextHand.tournament.id);
            const refreshed = await prisma.game.findUnique({
              where: { id: gameId },
              include: { players: { include: { user: true } }, tournament: true }
            });
            const refreshedActive = refreshed?.players?.filter(p => p.status === 'ACTIVE').length ?? 0;
            if (refreshed && refreshedActive >= 2 && io) {
              try {
                await checkAndAdvanceBlindLevel(refreshed.tournament?.id, gameId, io);
                await startHandForGame(gameId, io);
                console.log(`[SHOWDOWN] Started new hand after consolidation (${refreshedActive} players)`);
              } catch (err) {
                console.error(`[SHOWDOWN] Error starting hand after consolidation:`, err);
              }
            }
          } catch (consErr) {
            console.error(`[SHOWDOWN] Consolidation failed:`, consErr);
          }
          return;
        }
        
        if (activePlayerCount < 2) {
          console.log(`[SHOWDOWN] Not enough active players (${activePlayerCount}) to start new hand`);
          return;
        }
        
        // Check if we should consolidate (uneven tables) - run even without a bust.
        // Use in-tournament count (chips>0, not ELIMINATED), NOT just ACTIVE - during a hand
        // most players are FOLDED/ALL_IN so the other table would look empty and we'd never consolidate.
        if (gameForNextHand.tournament?.status === 'RUNNING') {
          try {
            const games = await prisma.game.findMany({
              where: { tournamentId: gameForNextHand.tournament.id, status: 'ACTIVE' },
              include: { players: { where: { status: { not: 'ELIMINATED' }, chips: { gt: 0 } } } }
            });
            const counts = games.map(g => g.players.length).filter(c => c > 0);
            if (counts.length > 1) {
              const maxC = Math.max(...counts);
              const minC = Math.min(...counts);
              if (maxC - minC > 1) {
                console.log(`[SHOWDOWN] Uneven tables (${counts.join(',')}), triggering consolidation`);
                const { TournamentEngine } = await import("../../services/TournamentEngine.js");
                const tournamentEngine = new TournamentEngine();
                await tournamentEngine.consolidateTables(gameForNextHand.tournament.id);
                return;
              }
            }
          } catch (consErr) {
            console.error(`[SHOWDOWN] Consolidation check failed:`, consErr);
          }
        }

        if (gameForNextHand.tournament && gameForNextHand.tournament.status === 'RUNNING') {
          try {
            await checkAndAdvanceBlindLevel(gameForNextHand.tournament.id, gameId, io);
          } catch (err) {
            console.error(`[SHOWDOWN] Error advancing blind level:`, err);
          }
        }
        
        if (io) {
          try {
            console.log(`[SHOWDOWN] Starting new hand with ${activePlayerCount} active players...`);
            await startHandForGame(gameId, io);
            console.log(`[SHOWDOWN] Successfully started new hand after showdown`);
          } catch (err) {
            console.error(`[SHOWDOWN] CRITICAL ERROR starting new hand:`, err);
            console.error(`[SHOWDOWN] Error stack:`, err.stack);
            // Try to recover by emitting an error state to clients
            if (io) {
              io.to(`game:${gameId}`).emit("error", { 
                message: "Error starting new hand. Please refresh the page." 
              });
            }
          }
        }
      } else {
        console.log(`[SHOWDOWN] Cannot start new hand: game not found or not enough players (found: ${gameForNextHand?.players?.length || 0})`);
      }
    });
  }, cleanupDelayMs);
}

/**
 * Post dealer message to chat
 */
function postDealerMessage(gameId, io, message) {
  if (!io) return;
  
  const dealerMessage = {
    id: `dealer-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
    userId: 'DEALER',
    userName: 'Dealer',
    message: message,
    timestamp: Date.now(),
    isGameMessage: true,
    isDealerMessage: true
  };
  
  io.to(`game:${gameId}`).emit("game_message", { gameId, message: dealerMessage });
}

/**
 * Check if blind level should advance based on tournament elapsed time and advance if needed
 */
async function checkAndAdvanceBlindLevel(tournamentId, gameId, io) {
  try {
    const tournament = await prisma.tournament.findUnique({
      where: { id: tournamentId }
    });

    if (!tournament || tournament.status !== 'RUNNING' || !tournament.startedAt) {
      return;
    }

    // Parse blind levels
    let blindLevels = [];
    try {
      blindLevels = tournament.blindLevelsJson ? JSON.parse(tournament.blindLevelsJson) : [];
    } catch (e) {
      console.error(`[POKER] Failed to parse blind levels for tournament ${tournamentId}:`, e);
      return;
    }

    if (blindLevels.length === 0) return;

    // Calculate elapsed time since tournament started
    const now = new Date();
    const startedAt = new Date(tournament.startedAt);
    const elapsedMs = now.getTime() - startedAt.getTime();
    let elapsedMinutes = elapsedMs / 1000 / 60;

    // Determine current blind level based on elapsed time
    let currentLevelIndex = 0;
    for (let i = 0; i < blindLevels.length; i++) {
      const level = blindLevels[i];
      if (level.duration === null) {
        // Final level (infinite duration)
        currentLevelIndex = i;
        break;
      }
      if (elapsedMinutes <= level.duration) {
        currentLevelIndex = i;
        break;
      }
      elapsedMinutes -= level.duration;
      // Account for break after level
      if (level.breakAfter) {
        elapsedMinutes -= level.breakAfter;
      }
    }

    // Get current level from game
    const game = await prisma.game.findUnique({
      where: { id: gameId }
    });

    if (!game) return;

    const gameLevel = game.currentBlindLevel || 0;
    
    // Check if we need to advance to next level
    console.log(`[BLIND LEVEL] Tournament ${tournamentId}, game ${gameId}: elapsed=${(elapsedMs / 1000 / 60).toFixed(2)}min, calculatedLevel=${currentLevelIndex}, gameLevel=${gameLevel}`);
    
    if (currentLevelIndex > gameLevel) {
      console.log(`[POKER] Advancing blind level for game ${gameId} from ${gameLevel} to ${currentLevelIndex}`);
      
      const newLevel = blindLevels[currentLevelIndex];
      if (newLevel) {
        // Update game blinds and level
        // Note: smallBlind/bigBlind fields may not exist in database yet if migration hasn't been run
        await prisma.game.update({
          where: { id: gameId },
          data: {
            currentBlindLevel: currentLevelIndex,
            smallBlind: newLevel.smallBlind,
            bigBlind: newLevel.bigBlind
          }
        }).catch(err => {
          // If fields don't exist, log warning but don't fail
          if (err.message && err.message.includes('Unknown argument')) {
            console.warn(`[BLIND LEVEL] smallBlind/bigBlind fields not in database yet - migration needed. Error: ${err.message}`);
            // Fallback: only update currentBlindLevel
            return prisma.game.update({
              where: { id: gameId },
              data: { currentBlindLevel: currentLevelIndex }
            }).catch(fallbackErr => {
              console.error(`[BLIND LEVEL] Error updating currentBlindLevel:`, fallbackErr);
            });
          } else {
            console.error(`[BLIND LEVEL] Error updating game blinds:`, err);
          }
        });

        console.log(`[BLIND LEVEL] Updated game ${gameId} to level ${currentLevelIndex}: ${newLevel.smallBlind}/${newLevel.bigBlind}`);

        // Post dealer message
        if (io) {
          postDealerMessage(gameId, io, `Blinds increase to ${newLevel.smallBlind.toLocaleString()}/${newLevel.bigBlind.toLocaleString()}`);
        }
      } else {
        console.warn(`[BLIND LEVEL] No level found at index ${currentLevelIndex} for tournament ${tournamentId}`);
      }
    } else {
      console.log(`[BLIND LEVEL] No advancement needed: currentLevelIndex=${currentLevelIndex} <= gameLevel=${gameLevel}`);
    }
  } catch (err) {
    console.error(`[POKER] Error checking blind level advancement:`, err);
  }
}

/**
 * Emit current game state to all clients in the game room.
 */
async function emitGameState(gameId, io, state) {
  if (!io) return;
  const game = await prisma.game.findUnique({
    where: { id: gameId },
    include: { players: { include: { user: true } }, tournament: true },
  });
  if (game) {
    const payload = buildClientGameState(game, state);
    io.to(`game:${gameId}`).emit("game-state", payload);
  }
}

/**
 * Cinematic all-in showdown: reveal cards, deal community cards one at a time with delays,
 * then evaluate and highlight winner, then cleanup. Called when betting completes with
 * all players all-in or only one player with chips.
 */
async function runCinematicAllInShowdown(gameId, io, state, engine, allPlayersAllIn) {
  const activePlayers = state.players.filter(p => p.status !== 'FOLDED' && p.status !== 'ELIMINATED');
  if (activePlayers.length < 2) return;

  if (allPlayersAllIn) {
    postDealerMessage(gameId, io, "All players are all-in! Turning over cards...");
  } else {
    postDealerMessage(gameId, io, "Turning over cards...");
  }

  // Phase 1: Reveal hole cards (showdownActive without winner highlight)
  state.showdownActive = true;
  state.showdownResults = null;
  tableState.set(gameId, state);
  await emitGameState(gameId, io, state);
  await delay(SHOWDOWN_PHASE_DELAY_MS);

  // Phase 2-4: Deal flop, turn, river one at a time with delays
  if (state.street === "PREFLOP") {
    const { deck: newDeck, cards: flopCards } = engine.dealFlop(state.deck);
    state.deck = newDeck;
    state.communityCards = flopCards;
    state.street = "FLOP";
    postDealerMessage(gameId, io, "Dealing the flop...");
    await emitGameState(gameId, io, state);
    await delay(SHOWDOWN_PHASE_DELAY_MS);
  }
  if (state.street === "FLOP") {
    const { deck: newDeck, card: turnCard } = engine.dealTurnOrRiver(state.deck);
    state.deck = newDeck;
    state.communityCards = [...state.communityCards, turnCard];
    state.street = "TURN";
    postDealerMessage(gameId, io, "Dealing the turn...");
    await emitGameState(gameId, io, state);
    await delay(SHOWDOWN_PHASE_DELAY_MS);
  }
  if (state.street === "TURN") {
    const { deck: newDeck, card: riverCard } = engine.dealTurnOrRiver(state.deck);
    state.deck = newDeck;
    state.communityCards = [...state.communityCards, riverCard];
    state.street = "RIVER";
    postDealerMessage(gameId, io, "Dealing the river...");
    await emitGameState(gameId, io, state);
    await delay(SHOWDOWN_PHASE_DELAY_MS);
  }

  // Phase 5: Evaluate, distribute chips, highlight winner (handleShowdown)
  await handleShowdown(gameId, io, { cleanupDelayMs: SHOWDOWN_PHASE_DELAY_MS });
}

/**
 * Advance to next street (deal community cards) when betting round completes
 */
async function advanceToNextStreet(gameId, io) {
  console.log(`[POKER] advanceToNextStreet called for gameId: ${gameId}`);
  const state = tableState.get(gameId);
  if (!state) {
    console.error(`[POKER] ERROR: No state found for gameId ${gameId} in advanceToNextStreet`);
    return;
  }
  
  const activePlayers = state.players.filter(p => p.status !== 'FOLDED' && p.status !== 'ELIMINATED');
  console.log(`[POKER] advanceToNextStreet: Current street: ${state.street || 'PREFLOP'}, active players: ${activePlayers.length}`);
  
  // Clear current turn before advancing street (betting is complete)
  state.currentTurnUserId = null;
  
  // Clear any existing turn timer
  const existingTimer = turnTimers.get(gameId);
  if (existingTimer) {
    clearTimeout(existingTimer.timerId);
    if (existingTimer.graceTimerId) {
      clearTimeout(existingTimer.graceTimerId);
    }
    turnTimers.delete(gameId);
    console.log(`[POKER] advanceToNextStreet: Cleared existing turn timer`);
  }

  const { TexasHoldem } = await import("../poker/TexasHoldem.js");
  const smallBlind = state.bettingRound?.smallBlind || 10;
  const bigBlind = state.bettingRound?.bigBlind || 20;
  const engine = new TexasHoldem({ smallBlind, bigBlind });

  // Collect pot from current betting round
  const collectedPot = state.bettingRound.getTotalPot();
  const oldPot = state.pot || 0;
  state.pot = oldPot + collectedPot;
  
  // Update player contributions for side pot calculation
  // Track total contributions across all streets by adding current street to existing contributions
  state.players.forEach(player => {
    const currentContribution = state.bettingRound.getPlayerContribution(player.id);
    player.contributions = (player.contributions || 0) + currentContribution;
  });
  
  // Clear betting round contributions for next street
  state.bettingRound.playerBets.clear();
  state.bettingRound.currentBet = 0;
  state.lastRaiseUserId = null;
  // Reset acted players tracking for new betting round
  state.actedPlayersInRound = new Set();

  // Check if all active players are all-in (activePlayers already declared above)
  const activePlayerIds = activePlayers.map(p => p.id);
  const allPlayersAllIn = state.bettingRound.areAllPlayersAllIn(activePlayerIds, state.players);
  
  // Determine how many active players still have chips left
  // These are the players who can still make betting decisions on future streets
  const playersWithChips = activePlayers.filter(p => p.chips > 0);

  const shouldAutoShowdown = allPlayersAllIn || playersWithChips.length === 1;

  // Cinematic all-in showdown: reveal cards, deal flop/turn/river with delays, then winner
  if (shouldAutoShowdown && io) {
    await runCinematicAllInShowdown(gameId, io, state, engine, allPlayersAllIn);
    return;
  }

  // Deal community cards based on current street (normal path)
  if (state.street === "PREFLOP") {
    // Deal flop
    const { deck: newDeck, cards: flopCards } = engine.dealFlop(state.deck);
    state.deck = newDeck;
    state.communityCards = flopCards;
    state.street = "FLOP";
    postDealerMessage(gameId, io, "Dealing the flop...");
  } else if (state.street === "FLOP") {
    // Deal turn
    const { deck: newDeck, card: turnCard } = engine.dealTurnOrRiver(state.deck);
    state.deck = newDeck;
    state.communityCards = [...state.communityCards, turnCard];
    state.street = "TURN";
    postDealerMessage(gameId, io, "Dealing the turn...");
  } else if (state.street === "TURN") {
    // Deal river
    const { deck: newDeck, card: riverCard } = engine.dealTurnOrRiver(state.deck);
    state.deck = newDeck;
    state.communityCards = [...state.communityCards, riverCard];
    state.street = "RIVER";
    postDealerMessage(gameId, io, "Dealing the river...");
  } else if (state.street === "RIVER") {
    // Hand complete - showdown
    await handleShowdown(gameId, io);
    return;
  }

  // Check if everyone folded - if so, award pot to last player who didn't fold and end hand
  if (activePlayers.length === 0) {
    console.log(`[POKER] advanceToNextStreet: All players folded - finding last player who didn't fold to award pot`);
    
    // Find the last player who was active (not folded) - this would be the last player to fold
    // In practice, if everyone folded, we should award to the big blind (last to act preflop)
    // But since we're already in advanceToNextStreet, the betting round completed, so we need to find who was last active
    const allPlayers = state.players.filter(p => p.status !== 'ELIMINATED');
    if (allPlayers.length > 0) {
      // Award pot to the player with the highest contribution (they were last to act)
      // Or if all contributions are equal, award to big blind
      const bbPlayer = allPlayers.find(p => {
        const contribution = state.bettingRound?.getPlayerContribution(p.id) || 0;
        return contribution > 0; // Big blind has contribution
      });
      
      if (bbPlayer) {
        const collectedPot = state.bettingRound.getTotalPot();
        const totalPot = state.pot;
        bbPlayer.chips += totalPot;
        state.pot = 0;
        
        const winnerName = bbPlayer.name || bbPlayer.user?.username || `Player ${bbPlayer.seatNumber}`;
        console.log(`[POKER] All players folded - awarding pot of ${totalPot} to ${winnerName} (big blind)`);
        
        if (io) {
          postDealerMessage(gameId, io, `${winnerName} wins ${totalPot.toLocaleString()} (all other players folded)`);
          
          // Emit winner event
          io.to(`game:${gameId}`).emit("winner", {
            gameId,
            winners: [{
              playerId: bbPlayer.id,
              userId: bbPlayer.userId,
              name: winnerName,
              potWon: totalPot
            }]
          });
        }
        
        // Update player chips in database
        prisma.player.update({
          where: { id: bbPlayer.id },
          data: { chips: bbPlayer.chips }
        }).catch(err => console.error(`[POKER] Error updating chips for player ${bbPlayer.id}:`, err));
        
        // Update game pot
        prisma.game.update({
          where: { id: gameId },
          data: { pot: 0 }
        }).catch(err => console.error(`[POKER] Error updating game pot:`, err));
        
        // Reset hand state after delay
        setTimeout(() => {
          const savedPlayers = [...state.players];
          tableState.delete(gameId);
          
          // Only reset players who are NOT eliminated and have chips
          const resetPromises = savedPlayers
            .filter(p => p.status !== 'ELIMINATED' && p.chips > 0)
            .map(p => {
              return prisma.player.update({
                where: { id: p.id },
                data: { 
                  status: 'ACTIVE',
                  holeCards: "",
                  lastAction: null
                }
              }).catch(err => console.error(`[POKER] Error resetting player ${p.id}:`, err));
            });
          
          Promise.all(resetPromises).then(async () => {
            const gameForNextHand = await prisma.game.findUnique({
              where: { id: gameId },
              include: {
                players: { include: { user: true } },
                tournament: true
              }
            });
            
            if (gameForNextHand && gameForNextHand.players.filter(p => p.status === 'ACTIVE').length >= 2) {
              if (io) {
                try {
                  await startHandForGame(gameId, io);
                } catch (err) {
                  console.error(`[POKER] Error starting new hand after all-fold:`, err);
                }
              }
            }
          });
        }, 3000);
        
        return; // Don't continue with street advancement
      }
    }
    
    console.error(`[POKER] CRITICAL ERROR: All players folded but could not find player to award pot!`);
    state.currentTurnUserId = null;
    return;
  }

  // Start new betting round - only players with chips (not ALL_IN) should ever act
  if (activePlayers.length > 1) {
    // Eligible to act = active, not ALL_IN, has chips > 0
    const eligibleToAct = activePlayers.filter(p => p.status !== 'ALL_IN' && p.chips > 0);

    if (eligibleToAct.length > 1) {
      // Find first eligible player after dealer (clockwise)
      const dealerSeat = state.dealerSeat;
      const maxSeat = Math.max(...state.players.map(p => p.seatNumber));
      const minSeat = Math.min(...state.players.map(p => p.seatNumber));
      const seatRange = maxSeat - minSeat + 1;
      
      let firstToActSeat = dealerSeat - 1; // Clockwise = decrease
      if (firstToActSeat < minSeat) firstToActSeat = maxSeat;
      
      // Iterate through ALL seats (not just eligibleToAct.length) to find next to act
      let firstToActPlayer = eligibleToAct.find(p => p.seatNumber === firstToActSeat);
      let attempts = 0;
      while (!firstToActPlayer && attempts < seatRange) {
        firstToActSeat = firstToActSeat - 1;
        if (firstToActSeat < minSeat) firstToActSeat = maxSeat;
        firstToActPlayer = eligibleToAct.find(p => p.seatNumber === firstToActSeat);
        attempts++;
      }
      
      if (firstToActPlayer) {
        // Clear any existing turn timer before starting new betting round
        const existingTimer = turnTimers.get(gameId);
        if (existingTimer) {
          clearTimeout(existingTimer.timerId);
          if (existingTimer.graceTimerId) {
            clearTimeout(existingTimer.graceTimerId);
          }
          turnTimers.delete(gameId);
          console.log(`[POKER] advanceToNextStreet: Cleared existing turn timer before starting new street`);
        }
        
        console.log(`[POKER] advanceToNextStreet: Starting new betting round on ${state.street}, first to act: seat ${firstToActPlayer.seatNumber} (${firstToActPlayer.name || firstToActPlayer.userId})`);
        state.currentTurnUserId = firstToActPlayer.userId;
        state.lastRaiseUserId = null; // Reset last raise for new street
        startTurnTimer(gameId, firstToActPlayer.userId, io);
      } else {
        console.error(`[POKER] ERROR in advanceToNextStreet: Could not find eligible player to act! Eligible players: ${eligibleToAct.length}`);
        // Fallback: use the first eligible player
        const fallbackPlayer = eligibleToAct[0];
        console.log(`[POKER] Using fallback eligible player: seat ${fallbackPlayer.seatNumber} (${fallbackPlayer.name || fallbackPlayer.userId})`);
        state.currentTurnUserId = fallbackPlayer.userId;
        state.lastRaiseUserId = null;
        startTurnTimer(gameId, fallbackPlayer.userId, io);
      }
    } else {
      // 0 or 1 eligible players with chips -> no betting round should start
      console.log(`[POKER] advanceToNextStreet: <=1 eligible players with chips, skipping betting round start`);
      state.currentTurnUserId = null;
    }
  } else {
    console.log(`[POKER] advanceToNextStreet: Only 1 active player remaining, skipping betting round start`);
    state.currentTurnUserId = null;
  }

  // Update community cards in database (async - don't block)
  prisma.game.update({
    where: { id: gameId },
    data: {
      pot: state.pot,
      communityCards: JSON.stringify(state.communityCards)
    }
  }).catch(err => console.error('[ADVANCE STREET] Error updating game in DB:', err));

  // Save updated state
  tableState.set(gameId, state);
  
  // Emit game state to all clients (critical - ensures clients see the new street)
  if (io) {
    // Fetch game from database for complete data
    const game = await prisma.game.findUnique({
      where: { id: gameId },
      include: {
        players: {
          include: { user: true }
        },
        tournament: true
      }
    }).catch(err => {
      console.error('[ADVANCE STREET] Error fetching game for emit:', err);
      return null;
    });
    
    if (game) {
      const payload = buildClientGameState(game, state);
      io.to(`game:${gameId}`).emit("game-state", payload);
      console.log(`[POKER] advanceToNextStreet: Emitted game state for street ${state.street}`);
    } else {
      console.error(`[POKER] ERROR: Could not emit game state in advanceToNextStreet - game not found`);
    }
  }
}

/**
 * Move to the next player to act (clockwise - decreasing seat numbers for anticlockwise seat numbering)
 */
async function moveToNextPlayer(gameId, io) {
  const state = tableState.get(gameId);
  if (!state) return;

  // CRITICAL: Eliminate players with 0 chips, but ONLY if there's no active hand
  // If a hand is active, players who are all-in should stay until the hand completes
  const hasActiveHandNow = hasActiveHand(gameId);
  
  if (!hasActiveHandNow) {
    // No active hand - safe to eliminate players with 0 chips
    const { TournamentEngine } = await import("../../services/TournamentEngine.js");
    const tournamentEngine = new TournamentEngine();
    
    const game = await prisma.game.findUnique({
      where: { id: gameId },
      include: { tournament: true }
    });
    
    // Check for players with 0 chips who are still ACTIVE and eliminate them
    const playersToEliminate = state.players.filter(
      p => p.chips <= 0 && p.status === 'ACTIVE'
    );
    
    for (const player of playersToEliminate) {
      console.log(`[POKER] Eliminating player ${player.name || player.userId} with ${player.chips} chips (no active hand)`);
      player.status = 'ELIMINATED';
      // Don't change seatNumber - keep it to avoid unique constraint violation
      // ELIMINATED players are filtered out by status, not seatNumber
      
      // Update database - mark as eliminated
      await prisma.player.update({
        where: { id: player.id },
        data: { 
          status: 'ELIMINATED'
          // Keep seatNumber - eliminated players filtered by status
        }
      }).catch(err => console.error(`[POKER] Error eliminating player ${player.id}:`, err));
      
      // Notify tournament engine if in tournament
      if (game?.tournament) {
        await tournamentEngine.onPlayerBust(game.tournament.id, player.id).catch(err => {
          console.error(`[POKER] Error notifying tournament of player bust:`, err);
        });
      }
    }
    if (game?.tournament && io) {
      await emitIfTournamentCompleted(game.tournament.id, gameId, io);
    }
  } else {
    // Active hand in progress - don't eliminate all-in players yet, they need to see the hand through
    console.log(`[POKER] Active hand in progress - skipping elimination of players with 0 chips until hand completes`);
  }

  // Filter out folded, eliminated, and all-in players (all-in players can't act)
  const activePlayers = state.players.filter((p) => 
    p.status !== 'FOLDED' && 
    p.status !== 'ELIMINATED' && 
    p.status !== 'ALL_IN' &&
    p.chips > 0
  );

  // Players still in the hand (includes ALL_IN - they haven't folded)
  const playersInHand = state.players.filter((p) => 
    p.status !== 'FOLDED' && 
    p.status !== 'ELIMINATED'
  );

  // One player left (everyone else folded) – award pot and end hand immediately
  // Must use playersInHand: when someone goes all-in, activePlayers excludes them, but they're
  // still in the hand – the other player needs a chance to call or fold
  if (playersInHand.length === 1) {
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
    state.currentTurnUserId = null;
    state.street = null;
    tableState.set(gameId, state);

    const winnerName = winner.name || winner.user?.username || `Player ${winner.seatNumber}`;
    console.log(`[POKER] One player left – awarding pot of ${totalPot} to ${winnerName}`);

    if (io) {
      postDealerMessage(gameId, io, `${winnerName} wins ${totalPot.toLocaleString()} (all other players folded)`);
      io.to(`game:${gameId}`).emit("winner", {
        gameId,
        winners: [{ playerId: winner.id, userId: winner.userId, name: winnerName, potWon: totalPot }],
      });
    }
    await prisma.player.update({ where: { id: winner.id }, data: { chips: winner.chips } }).catch(() => {});
    await prisma.game.update({ where: { id: gameId }, data: { pot: 0 } }).catch(() => {});

    if (io) {
      const game = await prisma.game.findUnique({
        where: { id: gameId },
        include: { players: { include: { user: true } }, tournament: true },
      }).catch(() => null);
      if (game) {
        const payload = buildClientGameState(game, state);
        io.to(`game:${gameId}`).emit("game-state", payload);
      }
    }

    setTimeout(() => {
      const savedPlayers = [...state.players];
      tableState.delete(gameId);
      const resetPromises = savedPlayers
        .filter(p => p.status !== 'ELIMINATED' && p.chips > 0)
        .map(p => prisma.player.update({
          where: { id: p.id },
          data: { status: 'ACTIVE', holeCards: '', lastAction: null },
        }).catch(() => {}));
      Promise.all(resetPromises).then(async () => {
        const gameForNextHand = await prisma.game.findUnique({
          where: { id: gameId },
          include: { players: { include: { user: true } }, tournament: true },
        });
        if (gameForNextHand && gameForNextHand.players.filter(p => p.status === 'ACTIVE').length >= 2 && io) {
          try {
            await startHandForGame(gameId, io);
          } catch (err) {
            console.error(`[POKER] Error starting new hand after everyone-fold:`, err);
          }
        }
      });
    }, 3000);
    return;
  }

  if (activePlayers.length === 0) {
    state.currentTurnUserId = null;
    return;
  }

  if (!state.currentTurnUserId) {
    // No current player, start with UTG (first player after BB, which we'll calculate from dealer)
    // For now, just use the first active player with lowest seat number
    const sortedPlayers = [...activePlayers].sort((a, b) => a.seatNumber - b.seatNumber);
    state.currentTurnUserId = sortedPlayers[0].userId;
    startTurnTimer(gameId, state.currentTurnUserId, io);
    return;
  }

  // Get all seat numbers to find min and max for wrapping
  const allSeatNumbers = state.players.map(p => p.seatNumber);
  const minSeat = Math.min(...allSeatNumbers);
  const maxSeat = Math.max(...allSeatNumbers);
  
  const currentPlayer = activePlayers.find((p) => p.userId === state.currentTurnUserId);
  
  if (!currentPlayer) {
    // Current player not found (they might have folded or been eliminated)
    // Find the player that was the current turn from ALL players (including folded)
    const allPlayersCurrent = state.players.find((p) => p.userId === state.currentTurnUserId);
    
    console.log(`[TURN ORDER] Current player not in active players. Looking for folded player: ${state.currentTurnUserId}, found: ${!!allPlayersCurrent}`);
    
    if (allPlayersCurrent) {
      // The current player exists but is folded/eliminated - start from next seat clockwise after them
      const currentSeat = allPlayersCurrent.seatNumber;
      const allSeatNumbers = state.players.map(p => p.seatNumber);
      const minSeat = Math.min(...allSeatNumbers);
      const maxSeat = Math.max(...allSeatNumbers);
      
      console.log(`[TURN ORDER] Folded player was at seat ${currentSeat}, starting search clockwise from seat ${currentSeat - 1 < minSeat ? maxSeat : currentSeat - 1}`);
      
      // Start from next seat clockwise after the folded player
      let nextSeat = currentSeat - 1;
      if (nextSeat < minSeat) nextSeat = maxSeat;
      
      // Find first active player at or after this seat
      let nextPlayer = activePlayers.find(p => p.seatNumber === nextSeat);
      let attempts = 0;
      while (!nextPlayer && attempts < activePlayers.length) {
        nextSeat = nextSeat - 1;
        if (nextSeat < minSeat) nextSeat = maxSeat;
        nextPlayer = activePlayers.find(p => p.seatNumber === nextSeat);
        attempts++;
        console.log(`[TURN ORDER] Searching for active player, checked seat ${nextSeat}, found: ${!!nextPlayer}`);
      }
      
      if (nextPlayer) {
        console.log(`[TURN ORDER] Found next player after folded player: seat ${nextPlayer.seatNumber} (${nextPlayer.name || nextPlayer.userId})`);
        state.currentTurnUserId = nextPlayer.userId;
        startTurnTimer(gameId, state.currentTurnUserId, io);
        return;
      } else {
        console.log(`[TURN ORDER] No active players found after folded player at seat ${currentSeat}`);
      }
    }
    
    // Fallback: start with first active player
    console.log(`[TURN ORDER] Falling back to first active player`);
    const sortedPlayers = [...activePlayers].sort((a, b) => a.seatNumber - b.seatNumber);
    if (sortedPlayers.length > 0) {
    state.currentTurnUserId = sortedPlayers[0].userId;
    startTurnTimer(gameId, state.currentTurnUserId, io);
      console.log(`[TURN ORDER] Set turn to first active player: seat ${sortedPlayers[0].seatNumber} (${sortedPlayers[0].name || sortedPlayers[0].userId})`);
    } else {
      console.log(`[TURN ORDER] No active players found, setting currentTurnUserId to null`);
      state.currentTurnUserId = null;
    }
    return;
  }

  const currentSeat = currentPlayer.seatNumber;
  
  // Create a map of seat number to player for faster lookup (include ALL active players)
  // We need ALL players who haven't folded, not just those who haven't acted yet
  const seatMap = new Map();
  const activeSeats = new Set();
  activePlayers.forEach(p => {
    // Include all active players (even current one for logging, but we'll skip them in search)
    seatMap.set(p.seatNumber, p);
    activeSeats.add(p.seatNumber);
  });
  
  console.log(`[POKER] Turn rotation from seat ${currentSeat}: ALL active seats = [${Array.from(activeSeats).sort((a,b) => a-b).join(', ')}], min=${minSeat}, max=${maxSeat}, currentTurn=${state.currentTurnUserId}`);
  
  // Find next player clockwise who needs to act
  // Seats are numbered ANTICLOCKWISE, so clockwise = DECREASING seat numbers
  // Start from currentSeat - 1 and wrap to maxSeat if we go below minSeat
  let nextSeat = currentSeat - 1;
  if (nextSeat < minSeat) nextSeat = maxSeat;
  
  let attempts = 0;
  let nextPlayer = null;
  const totalSeats = maxSeat - minSeat + 1;
  const checkedSeats = [];
  const currentBet = state.bettingRound?.currentBet || 0;
  
  // Search through all possible seats (at most totalSeats attempts)
  // Give turn to players who need to act:
  // - When currentBet > 0: players with contribution < currentBet need to act
  // - When currentBet === 0: ALL players need ONE turn (they can check or bet)
  //   Problem: When currentBet === 0 and a player checks, contribution stays 0 (same as currentBet)
  //   So "contribution < currentBet" is false (0 < 0), and they're skipped incorrectly
  //   Solution: Track which players have acted in this betting round in state
  //   When currentBet === 0, give turns to players who haven't acted yet in this round
  
  // Initialize actedPlayersInRound if not exists (for new betting rounds)
  if (!state.actedPlayersInRound) {
    state.actedPlayersInRound = new Set();
  }
  
  // Go through seats sequentially in clockwise order (decreasing for anticlockwise numbering)
  // Use the variables already initialized above (lines 861-865)
  while (attempts < totalSeats && !nextPlayer) {
    checkedSeats.push(nextSeat);
    
    // Check if there's a player at this seat
    const playerAtSeat = seatMap.get(nextSeat);
    
    if (playerAtSeat && playerAtSeat.userId !== state.currentTurnUserId) {
      // Skip ELIMINATED players - they should not be in the seat map, but double-check
      if (playerAtSeat.status === 'ELIMINATED') {
        console.log(`[TURN ORDER] ✗ Skipped seat ${nextSeat}: player is ELIMINATED`);
        nextSeat = nextSeat - 1 < minSeat ? maxSeat : nextSeat - 1;
        attempts++;
        continue;
      }
      
      const contribution = state.bettingRound?.getPlayerContribution(playerAtSeat.id) || 0;
      const hasActed = state.actedPlayersInRound.has(playerAtSeat.userId);
      const isLastRaiser = state.lastRaiseUserId === playerAtSeat.userId;
      
      // Check if player is all-in (has 0 chips remaining or ALL_IN status) or eliminated
      const isAllIn = playerAtSeat.status === 'ALL_IN' || playerAtSeat.chips === 0 || playerAtSeat.status === 'ELIMINATED';
      
      let needsToAct = false;
      if (isAllIn) {
        // All-in players can't act - they've already committed all their chips
        needsToAct = false;
        console.log(`[TURN ORDER] Checking seat ${nextSeat} (${playerAtSeat.name || playerAtSeat.userId}): ALL-IN (0 chips), contribution=${contribution}, currentBet=${currentBet}, needsToAct=false`);
      } else if (currentBet === 0) {
        // When currentBet === 0, player needs to act if they haven't acted yet this round
        needsToAct = !hasActed;
        console.log(`[TURN ORDER] Checking seat ${nextSeat} (${playerAtSeat.name || playerAtSeat.userId}): currentBet=0, hasActed=${hasActed}, needsToAct=${needsToAct}`);
      } else {
        // When currentBet > 0, player needs to act if:
        // 1. Their contribution < currentBet (they haven't matched the bet yet), OR
        // 2. They haven't acted yet this round (even if contribution equals current bet - like big blind)
        // This ensures the big blind gets a chance to act voluntarily even if no one raised
        needsToAct = contribution < currentBet || !hasActed;
        console.log(`[TURN ORDER] Checking seat ${nextSeat} (${playerAtSeat.name || playerAtSeat.userId}): contribution=${contribution}, currentBet=${currentBet}, chips=${playerAtSeat.chips}, hasActed=${hasActed}, isLastRaiser=${isLastRaiser}, needsToAct=${needsToAct}`);
      }
      
      if (needsToAct) {
        nextPlayer = playerAtSeat;
        console.log(`[TURN ORDER] ✓ Selected seat ${nextSeat} (${playerAtSeat.name || playerAtSeat.userId}) as next player. Checked seats in order: ${checkedSeats.join(' → ')}`);
        break;
      } else {
        console.log(`[TURN ORDER] ✗ Skipped seat ${nextSeat} (${playerAtSeat.name || playerAtSeat.userId}): doesn't need to act`);
      }
    } else if (playerAtSeat && playerAtSeat.userId === state.currentTurnUserId) {
      console.log(`[TURN ORDER] ✗ Skipped seat ${nextSeat}: this is the current player`);
    }
    
    // Move to next seat clockwise (decreasing)
    nextSeat = nextSeat - 1;
    if (nextSeat < minSeat) nextSeat = maxSeat;
    attempts++;
  }
  
  if (nextPlayer) {
    const nextContribution = state.bettingRound?.getPlayerContribution(nextPlayer.id) || 0;
    const hasActed = state.actedPlayersInRound?.has(nextPlayer.userId) || false;
    // Re-check needsToAct to verify before starting timer
    const actuallyNeedsToAct = currentBet === 0 ? !hasActed : (nextContribution < currentBet || !hasActed);
    
    console.log(`[POKER] Turn rotation: seat ${currentSeat} → seat ${nextPlayer.seatNumber} (${nextPlayer.name || nextPlayer.userId})`);
    console.log(`[POKER] Next player contribution=${nextContribution}, currentBet=${currentBet}, hasActed=${hasActed}, needsToAct=${actuallyNeedsToAct}`);
    console.log(`[POKER] Checked seats in order: ${checkedSeats.join(' → ')}`);
    
    if (!actuallyNeedsToAct) {
      console.log(`[POKER] WARNING: Player selected but doesn't need to act. Betting round may be complete.`);
      // Don't start timer if player doesn't need to act - check if betting is complete and advance
      state.currentTurnUserId = null;
      
      // Check if betting is complete and advance if needed
      const activePlayerIds = state.players
        .filter(p => p.status !== 'FOLDED' && p.status !== 'ELIMINATED')
        .map(p => p.id);
      
      const bettingComplete = state.bettingRound.isBettingComplete(
        activePlayerIds,
        state.lastRaiseUserId,
        state.currentTurnUserId,
        state.players,
        state.actedPlayersInRound || new Set()
      );
      
      if (bettingComplete) {
        console.log(`[POKER] Betting complete - advancing to next street or showdown`);
        // Advance to next street or showdown
        if (state.street === 'RIVER') {
          // Last street - go to showdown
          await handleShowdown(gameId, io);
        } else {
          // Advance to next street
          await advanceToNextStreet(gameId, io);
        }
      } else {
        // Betting not complete but no player needs to act - this shouldn't happen
        console.error(`[POKER] ERROR: Betting not complete but no player needs to act. This may indicate a bug.`);
        // Try to find any player who needs to act
        const playerNeedingAction = activePlayers.find(p => {
          const contrib = state.bettingRound?.getPlayerContribution(p.id) || 0;
          const hasActed = state.actedPlayersInRound?.has(p.userId) || false;
          return contrib < currentBet || !hasActed;
        });
        
        if (playerNeedingAction) {
          console.log(`[POKER] Found player needing action: ${playerNeedingAction.name || playerNeedingAction.userId}`);
          state.currentTurnUserId = playerNeedingAction.userId;
          startTurnTimer(gameId, playerNeedingAction.userId, io);
        }
      }
      
      // Emit game state
      const game = await prisma.game.findUnique({
        where: { id: gameId },
        include: {
          players: { include: { user: true } },
          tournament: true
        }
      });
      if (game && io) {
        const payload = buildClientGameState(game, state);
        io.to(`game:${gameId}`).emit("game-state", payload);
      }
      return;
    }
    
    state.currentTurnUserId = nextPlayer.userId;
    startTurnTimer(gameId, state.currentTurnUserId, io);
  } else {
    // No player found who needs to act - betting round should be complete
    // Set currentTurnUserId to null to signal that betting is complete
    console.log(`[POKER] Turn rotation: No next player found from seat ${currentSeat}`);
    console.log(`[POKER] Checked seats: ${checkedSeats.join(' → ')}`);
    console.log(`[POKER] Current bet: ${currentBet}, All active players:`);
    activePlayers.forEach(p => {
      const contrib = state.bettingRound?.getPlayerContribution(p.id) || 0;
      console.log(`[POKER]   Seat ${p.seatNumber} (${p.name || p.userId}): contribution=${contrib}, status=${p.status}`);
    });
    state.currentTurnUserId = null;
    
    // Immediately check if betting is complete and advance if needed
    // This ensures post-flop betting rounds complete correctly
    // Note: Only do this if no player needs to act, otherwise the action handler will check
    const activePlayerIds = state.players
      .filter(p => p.status !== 'FOLDED' && p.status !== 'ELIMINATED')
      .map(p => p.id);
    
    const bettingComplete = state.bettingRound.isBettingComplete(
      activePlayerIds,
      state.lastRaiseUserId,
      state.currentTurnUserId, // This is now null
      state.players,
      state.actedPlayersInRound || new Set()
    );
    
    if (bettingComplete && io) {
      // Advance to next street - don't return here, let the action handler handle it
      // This is a fallback for when betting completes naturally (e.g., all check)
      console.log(`[POKER] Betting complete in moveToNextPlayer, advancing street`);
      await advanceToNextStreet(gameId, io);
      return; // Return early to avoid emitting state here
    }
  }
}

export function registerPokerHandlers(io) {
  // Store io instance for use by other modules
  ioInstance = io;
  
  io.on("connection", (socket) => {
    // eslint-disable-next-line no-console
    console.log("Poker client connected", socket.id);

    socket.on("join-table", async ({ gameId }) => {
      try {
        const game = await prisma.game.findUnique({
          where: { id: gameId },
          include: {
            players: {
              include: {
                user: true
              }
            },
            tournament: true
          }
        });

        if (!game) {
          socket.emit("error", { message: "Game not found" });
          return;
        }

        socket.join(`game:${gameId}`);

        // Auto-start a hand if:
        // 1. No hand state exists yet
        // 2. Game is ACTIVE
        // 3. Tournament is RUNNING (not just SEATED)
        // 4. There are at least 2 players
        let state = tableState.get(gameId);
        if (!state && game.status === "ACTIVE" && game.players.length >= 2) {
          // Only start hand if tournament is RUNNING
          if (game.tournament && game.tournament.status === "RUNNING") {
            try {
              // Use the exported startHandForGame function to ensure consistency
              state = await startHandForGame(gameId, socket.server);
            } catch (handError) {
              console.error("[POKER] Error auto-starting hand:", handError);
              // Continue without state if hand creation fails
            }
          }
        }

        // Get state again in case it was just created
        state = tableState.get(gameId);
        const payload = buildClientGameState(game, state);

        socket.emit("game-state", payload);
        
        // Broadcast to all players in the room if we just started a hand
        // (socket.server is the io instance)
        if (state) {
          socket.server.to(`game:${gameId}`).emit("game-state", payload);
        }
      } catch (err) {
        // eslint-disable-next-line no-console
        console.error("join-table error", err);
        socket.emit("error", { message: "Failed to join table" });
      }
    });

    socket.on("player-action", async ({ gameId, userId, action, amount }) => {
      try {
        // Clear turn timer for this game before processing action
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

        // Build game state from in-memory state (fast - no DB query)
        // We need game data but can use the state we have
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

        // Emit game state IMMEDIATELY after action (no DB query - use in-memory state)
        const immediatePayload = buildClientGameState(gameFromState, state);
        io.to(`game:${gameId}`).emit("game-state", immediatePayload);

        // Check if betting round is complete
        const activePlayerIds = state.players
          .filter(p => p.status !== 'FOLDED' && p.status !== 'ELIMINATED')
          .map(p => p.id);
        
        // Get player name for logging
        const player = state.players.find((p) => p.userId === userId);
        const playerName = player?.name || player?.user?.username || `Player ${player?.seatNumber || userId}`;
        
        console.log(`[BETTING] Checking if betting complete after ${action} by ${playerName}`);
        console.log(`[BETTING] Active players: ${activePlayerIds.length}, lastRaiseUserId=${state.lastRaiseUserId || 'null'}, currentTurnUserId=${state.currentTurnUserId || 'null'}`);
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
          // Check for uncalled bet (bet/raise with no calls) - bettor wins immediately
          const activePlayersAfterAction = state.players.filter(p => p.status !== 'FOLDED' && p.status !== 'ELIMINATED');
          const currentBet = state.bettingRound.currentBet || 0;
          const lastRaiserUserId = state.lastRaiseUserId;
          
          // Check if there's a last raiser and only one active player remains
          // OR if someone bet/raised and everyone else folded (uncalled bet)
          if (activePlayersAfterAction.length === 1) {
            // Only one player remaining - award pot and end hand
            const winner = activePlayersAfterAction[0];
            const collectedPot = state.bettingRound.getTotalPot();
            const totalPot = state.pot + collectedPot;
            
            const winnerName = winner.name || winner.user?.username || `Player ${winner.seatNumber}`;
            
            // Check if this is an uncalled bet (bet/raise that wasn't called)
            const isUncalledBet = lastRaiserUserId && lastRaiserUserId === winner.userId && currentBet > 0;
            
            winner.chips += totalPot;
            state.pot = 0;
            
            console.log(`[POKER] Single player remaining - awarding pot of ${totalPot} to ${winnerName}`);
            if (isUncalledBet) {
              console.log(`[POKER] Uncalled bet - ${winnerName} wins without showdown`);
            }
            
            // Post dealer message
            if (io) {
              if (isUncalledBet) {
                postDealerMessage(gameId, io, `${winnerName} wins ${totalPot.toLocaleString()} (uncalled bet)`);
              } else {
                postDealerMessage(gameId, io, `${winnerName} wins ${totalPot.toLocaleString()} (all other players folded)`);
              }
            }
            
            // Emit winner event for UI
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
            
            // Update winner chips in database (async)
            prisma.player.update({
              where: { id: winner.id },
              data: { chips: winner.chips }
            }).catch(err => console.error('[POKER] Error updating winner chips:', err));

            // Check for player elimination (though unlikely with folded players, check anyway)
            const { TournamentEngine } = await import("../../services/TournamentEngine.js");
            const tournamentEngine = new TournamentEngine();
            const game = await prisma.game.findUnique({
              where: { id: gameId },
              include: { tournament: true }
            });
            if (game?.tournament) {
              // Eliminate ANY players who have 0 chips after this pot is awarded
              const bustedPlayers = state.players.filter(p => p.chips <= 0 && p.status === 'ACTIVE');
              for (const busted of bustedPlayers) {
                console.log(`[POKER] Player ${busted.name || busted.userId} busted with 0 chips after pot award`);
                await tournamentEngine.onPlayerBust(game.tournament.id, busted.id);
                busted.status = 'ELIMINATED';
                // Don't change seatNumber - keep it to avoid unique constraint violation
                // ELIMINATED players are filtered out by status, not seatNumber
                await prisma.player.update({
                  where: { id: busted.id },
                  data: { 
                    status: 'ELIMINATED'
                    // Keep seatNumber - eliminated players filtered by status
                  }
                });
              }
              await emitIfTournamentCompleted(game.tournament.id, gameId, socket.server);
            }
            
            // Update game pot in database (async)
            prisma.game.update({
            where: { id: gameId },
              data: { pot: 0 }
            }).catch(err => console.error('[POKER] Error updating game pot:', err));
            
            // Clear hand state after delay
            const savedPlayers = [...state.players];
            setTimeout(async () => {
              tableState.delete(gameId);
              
              // Reset player statuses (async) - keep ELIMINATED players eliminated
              savedPlayers.forEach(p => {
                const isEliminated = p.status === 'ELIMINATED';
                prisma.player.update({
                  where: { id: p.id },
                  data: { 
                    status: isEliminated ? 'ELIMINATED' : 'ACTIVE',
                    holeCards: "",
                    lastAction: null
                  }
                }).catch(err => console.error(`[POKER] Error resetting player ${p.id}:`, err));
              });
              
              // Advance blind level and start new hand if tournament
              const game = await prisma.game.findUnique({
                where: { id: gameId },
                include: { tournament: true }
              });
              
              if (game && game.tournament && game.tournament.status === 'RUNNING') {
                // Check if blind level should advance
                await checkAndAdvanceBlindLevel(game.tournament.id, gameId, io);
                
                // Start new hand
                try {
                  await startHandForGame(gameId, io);
                } catch (err) {
                  console.error(`[POKER] Error starting new hand:`, err);
                }
              }
            }, 3000); // 3 second delay to show winner
            
            // Emit updated state
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
            
            return; // Don't advance to next street
          }
          
          // Multiple players remaining - advance to next street
          await advanceToNextStreet(gameId, io);
          // Emit updated state immediately from in-memory state (no DB query needed)
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
          // Move to next player in current betting round
          await moveToNextPlayer(gameId, io);
          // Emit updated state immediately from in-memory state (no DB query needed)
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
        // eslint-disable-next-line no-console
        console.error("player-action error", err);
        socket.emit("error", { message: err.message || "Action failed" });
      }
    });

    socket.on("game_message", async ({ gameId, message }) => {
      try {
        // Broadcast message to all players in the game
        io.to(`game:${gameId}`).emit("game_message", { gameId, message });
      } catch (err) {
        // eslint-disable-next-line no-console
        console.error("game_message error", err);
        socket.emit("error", { message: "Failed to send message" });
      }
    });

    socket.on("disconnect", () => {
      // eslint-disable-next-line no-console
      console.log("Poker client disconnected", socket.id);
    });
  });
}


