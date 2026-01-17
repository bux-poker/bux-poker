// Socket handler for poker table events.
// Wires Socket.IO events to PokerGameService, BettingRound and Prisma.

import { prisma } from "../../config/database.js";
import { PokerGameService } from "../../services/PokerGameService.js";
import { TexasHoldem } from "../poker/TexasHoldem.js";
import { BettingRound } from "../poker/BettingRound.js";
import { HandEvaluator } from "../poker/HandEvaluator.js";

const gameService = new PokerGameService();
const engine = new TexasHoldem({ smallBlind: 10, bigBlind: 20 });

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

function buildClientGameState(game, state) {
  return {
    id: game.id,
    tournamentId: game.tournamentId,
    tableNumber: game.tableNumber,
    pot: state?.pot ?? game.pot,
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
    players: (state?.players ?? game.players).map((p) => ({
      id: p.id,
      userId: p.userId,
      name: p.user?.username || "Player",
      chips: p.chips,
      seatNumber: p.seatNumber,
      status: p.status,
      avatarUrl: p.user?.avatarUrl || null,
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

async function applyPlayerAction({ gameId, userId, action, amount }) {
  const state = await ensureHandState(gameId);
  
  // Initialize actedPlayersInRound if not exists (for new betting rounds)
  if (!state.actedPlayersInRound) {
    state.actedPlayersInRound = new Set();
  }

  const player = state.players.find((p) => p.userId === userId);
  if (!player) {
    throw new Error("Player not at this table");
  }

  const playerName = player.name || player.user?.username || `Player ${player.seatNumber}`;
  const currentBetBefore = state.bettingRound?.currentBet || 0;
  const playerContributionBefore = state.bettingRound?.getPlayerContribution(player.id) || 0;
  
  console.log(`[ACTION] Player ${playerName} (seat ${player.seatNumber}) performing ${action} with amount ${amount}`);
  console.log(`[ACTION] Before: currentBet=${currentBetBefore}, playerContribution=${playerContributionBefore}, lastRaiseUserId=${state.lastRaiseUserId || 'null'}`);

  // Basic action handling. This is intentionally simplified:
  switch (action) {
    case "BET":
    case "RAISE": {
      const wasRaise = state.lastRaiseUserId !== null;
      state.bettingRound.bet(player.id, amount);
      player.chips -= amount;
      state.pot = state.bettingRound.getTotalPot();
      state.lastRaiseUserId = player.userId; // Track who raised
      // Reset acted players when someone raises - all players need to act again
      state.actedPlayersInRound.clear();
      // Mark the raiser as having acted (they just raised)
      state.actedPlayersInRound.add(userId);
      
      const newBet = state.bettingRound.currentBet;
      const newContribution = state.bettingRound.getPlayerContribution(player.id);
      console.log(`[ACTION] After ${action}: currentBet=${newBet}, playerContribution=${newContribution}, lastRaiseUserId=${state.lastRaiseUserId}`);
      
      // Note: We don't set next player here - moveToNextPlayer will handle it
      // The raise logic above was trying to set next player, but moveToNextPlayer does this correctly
      break;
    }
    case "CALL": {
      const spent = state.bettingRound.call(player.id, player.chips);
      player.chips -= spent;
      state.pot = state.bettingRound.getTotalPot();
      const newContribution = state.bettingRound.getPlayerContribution(player.id);
      console.log(`[ACTION] After CALL: playerContribution=${newContribution}, spent=${spent}`);
      // Mark player as acted in this betting round
      state.actedPlayersInRound.add(userId);
      break;
    }
    case "CHECK": {
      // No chips moved; validity (no outstanding bet) assumed client-side for now.
      console.log(`[ACTION] After CHECK: no change to contributions`);
      // Mark player as acted in this betting round
      state.actedPlayersInRound.add(userId);
      break;
    }
    case "FOLD": {
      player.status = "FOLDED";
      // Clear hole cards when player folds (hide them from view)
      player.holeCards = [];
      // Also clear in database (async - don't block)
      prisma.player.update({
        where: { id: player.id },
        data: { holeCards: "" }
      }).catch(err => console.error('[ACTION] Error clearing hole cards in DB:', err));
      console.log(`[ACTION] After FOLD: player status=FOLDED, holeCards cleared`);
      break;
    }
    case "ALL_IN": {
      const allInAmount = player.chips;
      if (allInAmount <= 0) {
        throw new Error("Cannot go all-in with zero chips");
      }
      // All-in acts as a raise if it's more than current bet
      const currentContribution = state.bettingRound.getPlayerContribution(player.id);
      const allInContribution = currentContribution + allInAmount;
      if (allInContribution > state.bettingRound.currentBet) {
        state.lastRaiseUserId = player.userId; // Track who raised (all-in counts as raise)
        // Reset acted players when someone raises - all players need to act again
        state.actedPlayersInRound.clear();
      }
      state.bettingRound.bet(player.id, allInAmount);
      player.chips = 0;
      state.pot = state.bettingRound.getTotalPot();
      // Mark player as having acted (they went all-in)
      state.actedPlayersInRound.add(userId);
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

  if (!game || game.players.length < 2) {
    throw new Error("Game not found or not enough players");
  }

  // Skip if hand already exists
  if (tableState.get(gameId)) {
    return;
  }

  // Get tournament blind levels
  let smallBlind = 10;
  let bigBlind = 20;
  
  if (game.tournament?.blindLevelsJson) {
    try {
      const blindLevels = JSON.parse(game.tournament.blindLevelsJson);
      if (blindLevels && blindLevels.length > 0) {
        const firstLevel = blindLevels[0];
        smallBlind = firstLevel.smallBlind || 10;
        bigBlind = firstLevel.bigBlind || 20;
      }
    } catch (e) {
      console.warn("Failed to parse blind levels, using defaults");
    }
  }

  // Create engine with tournament blind levels
  const tournamentEngine = new TexasHoldem({ 
    smallBlind, 
    bigBlind 
  });

  // Randomly assign dealer (pick random player)
  const dealerIndex = Math.floor(Math.random() * game.players.length);
  const dealerPlayer = game.players[dealerIndex];
  
  // Seats are numbered ANTICLOCKWISE, so CLOCKWISE movement = DECREASING seat numbers
  const dealerSeat = dealerPlayer.seatNumber;
  const maxSeat = Math.max(...game.players.map(p => p.seatNumber));
  const minSeat = Math.min(...game.players.map(p => p.seatNumber));
  
  // Calculate SB and BB seat numbers (clockwise = DECREASING seat numbers, wrapping)
  const sbSeat = dealerSeat - 1 < minSeat ? maxSeat : dealerSeat - 1;
  const bbSeat = sbSeat - 1 < minSeat ? maxSeat : sbSeat - 1;
  
  // Find players at those seat numbers
  const sbPlayer = game.players.find(p => p.seatNumber === sbSeat);
  const bbPlayer = game.players.find(p => p.seatNumber === bbSeat);
  
  if (!sbPlayer || !bbPlayer) {
    throw new Error(`Could not find SB or BB players. Dealer seat: ${dealerSeat}, SB seat: ${sbSeat}, BB seat: ${bbSeat}`);
  }

  // Deal hole cards
  const deck = tournamentEngine.createShuffledDeck();
  const { deck: remainingDeck, players: dealtHands } = tournamentEngine.dealHoleCards(
    deck,
    game.players.length
  );

  // Persist hole cards
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

  // Create betting round
  // Note: startingPot is set to 0 because we track the pot in state.pot
  // The BettingRound only tracks bets for the current street
  const bettingRound = new BettingRound({
    smallBlind,
    bigBlind,
    startingPot: 0
  });

  // Post blinds using postBlinds method (doesn't require minimum raise validation)
  if (sbPlayer.chips >= smallBlind && bbPlayer.chips >= bigBlind) {
    bettingRound.postBlinds(sbPlayer.id, bbPlayer.id);
    
    // Deduct chips from players in database
    await prisma.player.update({
      where: { id: sbPlayer.id },
      data: { chips: sbPlayer.chips - smallBlind }
    });
    
    await prisma.player.update({
      where: { id: bbPlayer.id },
      data: { chips: bbPlayer.chips - bigBlind }
    });
    
    // Update chips in memory for state
    sbPlayer.chips -= smallBlind;
    bbPlayer.chips -= bigBlind;
  }

  // Calculate UTG (first to act after BB) - continue clockwise (DECREASING seat numbers)
  // UTG is the first player clockwise after BB (not BB themselves, not SB, not dealer)
  let utgSeat = bbSeat - 1;
  if (utgSeat < minSeat) utgSeat = maxSeat;
  
  // Skip SB and dealer if they're the next player (shouldn't happen in normal play, but handle edge cases)
  // In normal play: Dealer -> SB -> BB -> UTG (clockwise)
  // So UTG should be BB - 1, which should never be SB or dealer
  // But if there are only 2-3 players, we need to ensure UTG is not SB or dealer
  let attempts = 0;
  while ((utgSeat === sbSeat || utgSeat === dealerSeat) && attempts < game.players.length) {
    utgSeat = utgSeat - 1;
    if (utgSeat < minSeat) utgSeat = maxSeat;
    attempts++;
  }
  
  const utgPlayer = game.players.find(p => p.seatNumber === utgSeat);
  
  if (!utgPlayer) {
    throw new Error(`Could not find UTG player. BB seat: ${bbSeat}, UTG seat: ${utgSeat}, SB seat: ${sbSeat}, Dealer seat: ${dealerSeat}`);
  }
  
  // CRITICAL: Ensure UTG is NOT the big blind
  if (utgPlayer.id === bbPlayer.id) {
    throw new Error(`UTG calculation error: UTG player (${utgPlayer.userId}) is the same as BB player. BB seat: ${bbSeat}, UTG seat: ${utgSeat}`);
  }
  
  console.log(`[POKER] UTG calculation: dealer=${dealerSeat}, sb=${sbSeat}, bb=${bbSeat}, utg=${utgSeat} (${utgPlayer.user?.username || utgPlayer.userId})`);

  // Create hand state
  const state = {
    street: "PREFLOP",
    deck: remainingDeck,
    communityCards: [],
    bettingRound,
    pot: game.pot + bettingRound.getTotalPot(), // Start with game.pot + current betting round (blinds)
    dealerSeat: dealerPlayer.seatNumber,
    smallBlindSeat: sbPlayer.seatNumber,
    bigBlindSeat: bbPlayer.seatNumber,
    currentTurnUserId: utgPlayer.userId, // First to act after BB (UTG)
    lastRaiseUserId: null, // Track who last raised (for betting completion check)
    actedPlayersInRound: new Set(), // Track which players have acted in current betting round
    players: await Promise.all(
      game.players.map(async (p, index) => {
        const updated = await prisma.player.findUnique({ where: { id: p.id } });
        // Parse hole cards from database (stored as JSON string)
        // If updated player has holeCards, use those (parsed if string)
        // Otherwise fall back to p.holeCards (parsed if string)
        // If neither exists, use dealtHands from current hand
        let holeCards = null;
        if (updated?.holeCards) {
          if (typeof updated.holeCards === 'object') {
            holeCards = updated.holeCards;
          } else if (typeof updated.holeCards === 'string') {
            try {
              holeCards = JSON.parse(updated.holeCards);
            } catch (e) {
              console.warn(`[POKER] Failed to parse holeCards from database for player ${p.id}:`, e.message);
              holeCards = dealtHands[index];
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
              holeCards = dealtHands[index];
            }
          }
        } else {
          holeCards = dealtHands[index];
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

  if (isTestPlayer) {
    // Test players: 3 seconds total, auto-act after
    const timeoutMs = 3000;
    const expiresAt = Date.now() + timeoutMs;
    
    console.log(`[POKER] Starting 3-second timer for test player ${playerName}, will call handleTestPlayerAction`);
    
    const timerId = setTimeout(() => {
      console.log(`[POKER] Timer expired for test player ${playerName}, calling handleTestPlayerAction`);
      handleTestPlayerAction(gameId, userId, io);
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
      amount: 0
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
      console.log(`[POKER] No state found for gameId: ${gameId}`);
      return;
    }

    const player = state.players.find((p) => p.userId === userId);
    if (!player) {
      console.log(`[POKER] Player not found in state for userId: ${userId}`);
      return;
    }
    if (player.status === 'FOLDED') {
      console.log(`[POKER] Player ${player.name || userId} is already FOLDED, skipping action`);
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
    const rand = Math.random();
    
    let action, amount;
    
    if (rand < 0.3) {
      // 30% fold
      action = "FOLD";
      amount = 0;
      console.log(`[POKER] Test player ${player.name || userId} decided to FOLD (rand=${rand.toFixed(2)})`);
    } else if (rand < 0.7 || canCheck) {
      // 40% call/check (or check if no bet)
      if (canCheck) {
        action = "CHECK";
        amount = 0;
        console.log(`[POKER] Test player ${player.name || userId} decided to CHECK (rand=${rand.toFixed(2)})`);
      } else {
        action = "CALL";
        amount = Math.min(amountToCall, myChips);
        console.log(`[POKER] Test player ${player.name || userId} decided to CALL ${amount} (rand=${rand.toFixed(2)})`);
      }
    } else {
      // 30% bet/raise (minimum raise or half pot)
      const minRaise = currentBet + (state.bettingRound?.minimumRaise || bigBlind);
      const halfPot = Math.floor((state.pot || 0) / 2);
      const betAmount = Math.max(minRaise, halfPot);
      amount = Math.min(betAmount, myChips);
      
      if (currentBet === 0) {
        action = "BET";
        console.log(`[POKER] Test player ${player.name || userId} decided to BET ${amount} (rand=${rand.toFixed(2)})`);
      } else {
        action = "RAISE";
        console.log(`[POKER] Test player ${player.name || userId} decided to RAISE ${amount} (rand=${rand.toFixed(2)})`);
      }
    }

    // Apply the action
    const newState = await applyPlayerAction({
      gameId,
      userId,
      action,
      amount
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
      newState.players
    );
    
    console.log(`[TEST PLAYER] Betting complete? ${bettingComplete}`);
    
    if (bettingComplete) {
      // Advance to next street
      await advanceToNextStreet(gameId, io);
      // Get updated state after advancing street
      const updatedGame = await prisma.game.findUnique({
        where: { id: gameId },
        include: { players: { include: { user: true } } }
      });
      if (updatedGame) {
        const updatedState = tableState.get(gameId);
        const payload = buildClientGameState(updatedGame, updatedState);
        if (io) io.to(`game:${gameId}`).emit("game-state", payload);
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
 */
async function handleShowdown(gameId, io) {
  const state = tableState.get(gameId);
  if (!state) return;

  const evaluator = new HandEvaluator();
  
  // Collect pot from current betting round
  const collectedPot = state.bettingRound.getTotalPot();
  const oldPot = state.pot || 0;
  state.pot = oldPot + collectedPot;
  
  const activePlayers = state.players.filter(p => p.status !== 'FOLDED' && p.status !== 'ELIMINATED');
  
  if (activePlayers.length === 0) {
    console.log(`[SHOWDOWN] No active players for showdown`);
    return;
  }

  console.log(`[SHOWDOWN] Starting showdown with ${activePlayers.length} active players`);
  console.log(`[SHOWDOWN] Community cards:`, state.communityCards);
  console.log(`[SHOWDOWN] Total pot: ${state.pot} (old: ${oldPot}, collected: ${collectedPot})`);

  // Evaluate all active players' hands
  const handResults = activePlayers.map(player => {
    if (!player.holeCards || !Array.isArray(player.holeCards) || player.holeCards.length !== 2) {
      console.warn(`[SHOWDOWN] Player ${player.name || player.userId} (seat ${player.seatNumber}) has invalid hole cards:`, player.holeCards);
      return { player, hand: null, strength: -1 };
    }

    const sevenCards = [...state.communityCards, ...player.holeCards];
    const hand = evaluator.evaluateBestHand(sevenCards);
    
    console.log(`[SHOWDOWN] Player ${player.name || player.userId} (seat ${player.seatNumber}): ${hand.category}, strength=${hand.strength}`);
    
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

  // Distribute pot among winners (split evenly)
  const potPerWinner = Math.floor(state.pot / winners.length);
  const remainder = state.pot % winners.length; // Extra chips go to first winner

  winners.forEach((winner, index) => {
    const amount = potPerWinner + (index === 0 ? remainder : 0);
    winner.player.chips += amount;
    console.log(`[SHOWDOWN] Distributing ${amount} chips to ${winner.player.name || winner.player.userId} (seat ${winner.player.seatNumber})`);
    
    // Update player chips in database (async)
    prisma.player.update({
      where: { id: winner.player.id },
      data: { chips: winner.player.chips }
    }).catch(err => console.error(`[SHOWDOWN] Error updating chips for player ${winner.player.id}:`, err));
  });

  // Reset pot
  state.pot = 0;

  // Update game pot in database (async)
  prisma.game.update({
    where: { id: gameId },
    data: { pot: 0 }
  }).catch(err => console.error(`[SHOWDOWN] Error updating game pot:`, err));

  // Build game state with showdown results
  const game = await prisma.game.findUnique({
    where: { id: gameId },
    include: {
      players: {
        include: { user: true }
      }
    }
  });

  if (!game) return;

  // Build result payload for clients
  const showdownResults = {
    winners: winners.map(w => ({
      playerId: w.player.id,
      userId: w.player.userId,
      name: w.player.name || w.player.user?.username || `Player ${w.player.seatNumber}`,
      seatNumber: w.player.seatNumber,
      handCategory: w.hand.category,
      potWon: potPerWinner + (winners.indexOf(w) === 0 ? remainder : 0)
    })),
    allHands: handResults.map(r => ({
      playerId: r.player.id,
      userId: r.player.userId,
      name: r.player.name || r.player.user?.username || `Player ${r.player.seatNumber}`,
      seatNumber: r.player.seatNumber,
      handCategory: r.hand.category,
      strength: r.strength
    }))
  };

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

  // Clear hand state after a short delay (allow clients to see results)
  setTimeout(() => {
    console.log(`[SHOWDOWN] Clearing hand state for next hand`);
    const savedPlayers = [...state.players]; // Save players array before clearing state
    tableState.delete(gameId);
    
    // Reset all players' statuses for next hand
    const resetPromises = savedPlayers.map(p => 
      prisma.player.update({
        where: { id: p.id },
        data: { 
          status: 'ACTIVE',
          holeCards: "",
          lastAction: null
        }
      }).catch(err => console.error(`[SHOWDOWN] Error resetting player ${p.id}:`, err))
    );
    
    Promise.all(resetPromises).then(() => {
      console.log(`[SHOWDOWN] All players reset for next hand`);
    });
  }, 5000); // 5 second delay to show results
}

/**
 * Advance to next street (deal community cards) when betting round completes
 */
async function advanceToNextStreet(gameId, io) {
  const state = tableState.get(gameId);
  if (!state) return;

  const { TexasHoldem } = await import("../poker/TexasHoldem.js");
  const smallBlind = state.bettingRound?.smallBlind || 10;
  const bigBlind = state.bettingRound?.bigBlind || 20;
  const engine = new TexasHoldem({ smallBlind, bigBlind });

  // Collect pot from current betting round
  const collectedPot = state.bettingRound.getTotalPot();
  const oldPot = state.pot || 0;
  state.pot = oldPot + collectedPot;

  // Clear betting round contributions
  state.bettingRound.playerBets.clear();
  state.bettingRound.currentBet = 0;
  state.lastRaiseUserId = null;
  // Reset acted players tracking for new betting round
  state.actedPlayersInRound = new Set();

  // Deal community cards based on current street
  if (state.street === "PREFLOP") {
    // Deal flop
    const { deck: newDeck, cards: flopCards } = engine.dealFlop(state.deck);
    state.deck = newDeck;
    state.communityCards = flopCards;
    state.street = "FLOP";
  } else if (state.street === "FLOP") {
    // Deal turn
    const { deck: newDeck, card: turnCard } = engine.dealTurnOrRiver(state.deck);
    state.deck = newDeck;
    state.communityCards = [...state.communityCards, turnCard];
    state.street = "TURN";
  } else if (state.street === "TURN") {
    // Deal river
    const { deck: newDeck, card: riverCard } = engine.dealTurnOrRiver(state.deck);
    state.deck = newDeck;
    state.communityCards = [...state.communityCards, riverCard];
    state.street = "RIVER";
  } else if (state.street === "RIVER") {
    // Hand complete - showdown
    await handleShowdown(gameId, io);
    return;
  }

  // Start new betting round - first player to act is first active player after dealer
  const activePlayers = state.players.filter(p => p.status !== 'FOLDED' && p.status !== 'ELIMINATED');
  if (activePlayers.length > 1) {
    // Find first active player after dealer (clockwise)
    const dealerSeat = state.dealerSeat;
    const maxSeat = Math.max(...state.players.map(p => p.seatNumber));
    const minSeat = Math.min(...state.players.map(p => p.seatNumber));
    
    let firstToActSeat = dealerSeat - 1; // Clockwise = decrease
    if (firstToActSeat < minSeat) firstToActSeat = maxSeat;
    
    // Find active player at or after this seat
    let firstToActPlayer = activePlayers.find(p => p.seatNumber === firstToActSeat);
    let attempts = 0;
    while (!firstToActPlayer && attempts < activePlayers.length) {
      firstToActSeat = firstToActSeat - 1;
      if (firstToActSeat < minSeat) firstToActSeat = maxSeat;
      firstToActPlayer = activePlayers.find(p => p.seatNumber === firstToActSeat);
      attempts++;
    }
    
    if (firstToActPlayer) {
      console.log(`[POKER] advanceToNextStreet: Starting new betting round on ${state.street}, first to act: seat ${firstToActPlayer.seatNumber} (${firstToActPlayer.name || firstToActPlayer.userId})`);
      state.currentTurnUserId = firstToActPlayer.userId;
      state.lastRaiseUserId = null; // Reset last raise for new street
      startTurnTimer(gameId, firstToActPlayer.userId, io);
    }
  }

  // Update community cards in database
  await prisma.game.update({
    where: { id: gameId },
    data: {
      pot: state.pot,
      communityCards: JSON.stringify(state.communityCards)
    }
  });

  tableState.set(gameId, state);
}

/**
 * Move to the next player to act (clockwise - decreasing seat numbers for anticlockwise seat numbering)
 */
async function moveToNextPlayer(gameId, io) {
  const state = tableState.get(gameId);
  if (!state) return;

  const activePlayers = state.players.filter((p) => p.status !== 'FOLDED' && p.status !== 'ELIMINATED');
  
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
      const contribution = state.bettingRound?.getPlayerContribution(playerAtSeat.id) || 0;
      const hasActed = state.actedPlayersInRound.has(playerAtSeat.userId);
      const isLastRaiser = state.lastRaiseUserId === playerAtSeat.userId;
      
      let needsToAct = false;
      if (currentBet === 0) {
        // When currentBet === 0, player needs to act if they haven't acted yet this round
        needsToAct = !hasActed;
        console.log(`[TURN ORDER] Checking seat ${nextSeat} (${playerAtSeat.name || playerAtSeat.userId}): currentBet=0, hasActed=${hasActed}, needsToAct=${needsToAct}`);
      } else {
        // When currentBet > 0, player needs to act if their contribution < currentBet
        // (they haven't matched the bet yet)
        needsToAct = contribution < currentBet;
        console.log(`[TURN ORDER] Checking seat ${nextSeat} (${playerAtSeat.name || playerAtSeat.userId}): contribution=${contribution}, currentBet=${currentBet}, hasActed=${hasActed}, isLastRaiser=${isLastRaiser}, needsToAct=${needsToAct}`);
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
    console.log(`[POKER] Turn rotation: seat ${currentSeat} → seat ${nextPlayer.seatNumber} (${nextPlayer.name || nextPlayer.userId})`);
    console.log(`[POKER] Next player contribution=${nextContribution}, currentBet=${currentBet}, needsToAct=${nextContribution < currentBet}`);
    console.log(`[POKER] Checked seats in order: ${checkedSeats.join(' → ')}`);
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
    const activePlayerIds = state.players
      .filter(p => p.status !== 'FOLDED' && p.status !== 'ELIMINATED')
      .map(p => p.id);
    
    const bettingComplete = state.bettingRound.isBettingComplete(
      activePlayerIds,
      state.lastRaiseUserId,
      state.currentTurnUserId, // This is now null
      state.players
    );
    
    if (bettingComplete && io) {
      // Advance to next street
      await advanceToNextStreet(gameId, io);
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
          amount: Number(amount) || 0
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

        // Get fresh game data from DB asynchronously for accurate state
        const game = await prisma.game.findUnique({
          where: { id: gameId },
          include: {
            players: {
              include: {
                user: true
              }
            }
          }
        });

        if (!game) {
          socket.emit("error", { message: "Game not found" });
          return;
        }

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
          state.players
        );
        
        console.log(`[BETTING] Betting complete? ${bettingComplete}`);
        
        if (bettingComplete) {
          // Advance to next street
          await advanceToNextStreet(gameId, io);
          // Get updated state after advancing street and emit
          const updatedGame = await prisma.game.findUnique({
            where: { id: gameId },
            include: { players: { include: { user: true } } }
          });
          if (updatedGame) {
            const updatedState = tableState.get(gameId);
            const payload = buildClientGameState(updatedGame, updatedState);
            io.to(`game:${gameId}`).emit("game-state", payload);
          }
        } else {
          // Move to next player in current betting round
          await moveToNextPlayer(gameId, io);
          // Get fresh game data and emit updated state with new turn
          const updatedGame = await prisma.game.findUnique({
            where: { id: gameId },
            include: { players: { include: { user: true } } }
          });
          if (updatedGame) {
            const updatedState = tableState.get(gameId);
            const payload = buildClientGameState(updatedGame, updatedState);
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


