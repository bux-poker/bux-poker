// Socket handler for poker table events.
// Wires Socket.IO events to PokerGameService, BettingRound and Prisma.

import { prisma } from "../../config/database.js";
import { PokerGameService } from "../../services/PokerGameService.js";
import { TexasHoldem } from "../poker/TexasHoldem.js";
import { BettingRound } from "../poker/BettingRound.js";
import { HandEvaluator } from "../poker/HandEvaluator.js";
import {
  tableState,
  turnTimers,
  testPlayerTimers,
  getIO,
  hasActiveHand,
  getTurnStartedAt,
  setIO,
} from "../poker/tableState.js";
export { clearAllStateForGames } from "../poker/tableState.js";
import { ensureHandState } from "../poker/ensureHandState.js";
import { postDealerMessage } from "../poker/dealerMessages.js";
import { applyPlayerAction } from "../poker/actions.js";
import { buildClientGameState } from "../poker/buildClientGameState.js";
import { advanceToNextStreet } from "../poker/advanceStreet.js";
import { moveToNextPlayer } from "../poker/turnOrder.js";
import { emitIfTournamentCompleted } from "../poker/tableTournamentHooks.js";
import { handleShowdown } from "../poker/showdown.js";
export { emitIfTournamentCompleted, getIO };
import { startTurnTimer } from "../poker/turnTimers.js";

const gameService = new PokerGameService();
const engine = new TexasHoldem({ smallBlind: 10, bigBlind: 20 });

/** Delay in ms between each phase of the cinematic all-in showdown */
const SHOWDOWN_PHASE_DELAY_MS = 1000;

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// In-memory table state, timers, and IO live in ../poker/tableState.js

/** Prevents two concurrent startHandForGame(gameId) from both running (e.g. idle poll + join-table). */
const startHandLocks = new Map();
/**
 * Force a stuck hand to advance by making the current player CHECK (if legal) or FOLD.
 * Used when consolidation is waiting but a hand's turn timer failed (e.g. io was null).
 * Preserves chips - applies a real action, does NOT clear state.
 */
export async function forceStuckPlayerToAct(gameId, io) {
  const state = tableState.get(gameId);
  if (!state || !io) return false;
  const userId = state.currentTurnUserId;
  if (!userId) {
    // No turn set - try moveToNextPlayer which may detect betting complete
    await moveToNextPlayer(gameId, io);
    return true;
  }
  const player = state.players.find(p => p.userId === userId);
  if (!player || player.status === 'FOLDED' || player.status === 'ELIMINATED') {
    await moveToNextPlayer(gameId, io);
    return true;
  }
  if (player.chips === 0 || player.status === 'ALL_IN') {
    await moveToNextPlayer(gameId, io);
    return true;
  }
  const currentBet = state.bettingRound?.currentBet || 0;
  const myContribution = state.bettingRound?.getPlayerContribution(player.id) || 0;
  const canCheck = myContribution >= currentBet;
  try {
    if (canCheck) {
      await applyPlayerAction({ gameId, userId, action: "CHECK", amount: 0, io });
    } else {
      await applyPlayerAction({ gameId, userId, action: "FOLD", amount: 0, io });
    }
    await moveToNextPlayer(gameId, io);
    console.log(`[POKER] Force-stuck recovery: ${canCheck ? "CHECK" : "FOLD"} for ${player.name || userId} at table ${gameId}`);
    return true;
  } catch (err) {
    console.error(`[POKER] Force-stuck recovery failed for ${gameId}:`, err?.message);
    return false;
  }
}

/**
 * Start a hand for a game with dealer assignment and blinds
 * This can be called from startTournament or when players join
 */
export async function startHandForGame(gameId, io) {
  if (tableState.get(gameId)) return;
  let lock = startHandLocks.get(gameId);
  if (lock) {
    await lock;
    return;
  }
  lock = (async () => {
    try {
      return await _startHandForGameBody(gameId, io);
    } finally {
      startHandLocks.delete(gameId);
    }
  })();
  startHandLocks.set(gameId, lock);
  await lock;
}

async function _startHandForGameBody(gameId, io) {
  // Always load only non-eliminated players with chips from the DB so we never
  // accidentally pull busted players back into a new hand due to stale in-memory state.
  const game = await prisma.game.findUnique({
    where: { id: gameId },
    include: {
      players: {
        where: { status: { not: "ELIMINATED" }, chips: { gt: 0 } },
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

  // Get tournament blind levels - use current level from game, not always first level.
  // Tournament default when config missing/empty: 25/50. Non-tournament: 10/20.
  const isTournamentGame = !!game.tournamentId;
  let smallBlind = isTournamentGame ? 25 : 10;
  let bigBlind = isTournamentGame ? 50 : 20;

  if (game.tournament?.blindLevelsJson) {
    try {
      const raw = JSON.parse(game.tournament.blindLevelsJson);
      const blindLevels = Array.isArray(raw) ? raw : (raw?.levels || raw?.blindLevels || []);
      if (blindLevels.length > 0) {
        const currentLevelIndex = game.currentBlindLevel ?? 0;
        const currentLevel = blindLevels[currentLevelIndex] ?? blindLevels[0];
        const sb = currentLevel.smallBlind ?? currentLevel.small;
        const bb = currentLevel.bigBlind ?? currentLevel.big;
        if (sb != null && bb != null) {
          smallBlind = sb;
          bigBlind = bb;
          console.log(`[POKER] Using blind level ${currentLevelIndex}: ${smallBlind}/${bigBlind}`);
        }
      }
    } catch (e) {
      console.warn("[POKER] Failed to parse tournament blind levels, using tournament default:", e?.message);
    }
  } else if (game.smallBlind != null && game.bigBlind != null) {
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
        // CRITICAL: Recalculate bbSeat from actual SB - otherwise bbSeat can equal sbSeat (same player)
        bbSeat = sbSeat - 1 < minSeat ? maxSeat : sbSeat - 1;
        bbPlayer = activePlayers.find(p => p.seatNumber === bbSeat && p.seatNumber >= 0 && p.id !== sbPlayer.id);
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
  if (!isHeadsUp && sbPlayer.id === bbPlayer.id) {
    throw new Error(`BUG: Same player (${sbPlayer.name || sbPlayer.id}) would post both SB and BB. Dealer: ${dealerSeat}, SB: ${sbSeat}, BB: ${bbSeat}`);
  }

  // Deal hole cards only to players who are still in the tournament and have chips.
  // Using the same filter as startHandForGame (status !== 'ELIMINATED' && chips > 0) ensures
  // that busted players NEVER get dealt into a new hand, even if some other part of the
  // system accidentally left their status as non-eliminated.
  const deck = tournamentEngine.createShuffledDeck();
  const activeDealtPlayers = game.players
    .filter(p => p.status !== 'ELIMINATED' && p.chips > 0)
    .sort((a, b) => a.seatNumber - b.seatNumber);
  
  if (activeDealtPlayers.length < 2) {
    throw new Error(`Not enough active players to deal cards. Found ${activeDealtPlayers.length} non-eliminated players.`);
  }
  
  console.log(`[POKER] Dealing cards to ${activeDealtPlayers.length} active players (filtered from ${game.players.length} total players)`);
  const { deck: remainingDeck, players: dealtHands } = tournamentEngine.dealHoleCards(
    deck,
    activeDealtPlayers.length
  );

  // Persist hole cards sequentially to avoid exhausting DB connection pool
  for (let index = 0; index < activeDealtPlayers.length; index++) {
    const p = activeDealtPlayers[index];
    const holeCards = JSON.stringify(dealtHands[index]);
    console.log(`[CARD DEAL] Assigning cards to ${p.name || p.userId} (seat ${p.seatNumber}, id: ${p.id}):`, dealtHands[index]);
    await prisma.player.update({
      where: { id: p.id },
      data: { holeCards },
    });
  }
  const eliminatedPlayers = game.players.filter(p => p.status === 'ELIMINATED');
  for (const p of eliminatedPlayers) {
    await prisma.player.update({
      where: { id: p.id },
      data: { holeCards: "" },
    });
  }

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

    // Mark as ALL_IN anyone who has 0 chips after posting (so we never give them the turn)
    if (sbPlayer.chips === 0) {
      sbPlayer.status = "ALL_IN";
      console.log(`[POKER] SB is all-in (0 chips) after posting blind`);
    }
    if (bbPlayer.chips === 0) {
      bbPlayer.status = "ALL_IN";
      console.log(`[POKER] BB is all-in (0 chips) after posting blind`);
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

  // Calculate UTG (first to act) - only players who can act (chips > 0, not ALL_IN)
  const canAct = (p) => p.chips > 0 && p.status !== "ALL_IN";
  let utgPlayer;
  let utgSeat;
  
  if (activePlayers.length === 2) {
    // Heads-up: SB acts first preflop, unless SB is all-in then BB acts
    if (canAct(sbPlayer)) {
      utgPlayer = sbPlayer;
      utgSeat = sbSeat;
      console.log(`[POKER] Heads-up game: UTG is SB (seat ${utgSeat})`);
    } else if (canAct(bbPlayer)) {
      utgPlayer = bbPlayer;
      utgSeat = bbSeat;
      console.log(`[POKER] Heads-up game: SB is all-in, UTG is BB (seat ${utgSeat})`);
    } else {
      utgPlayer = null;
      utgSeat = null;
      console.log(`[POKER] Heads-up: both players all-in, no turn to set`);
    }
  } else if (activePlayers.length === 3) {
    // Three-handed: UTG is the Button (dealer) - correct preflop order is Button, SB, BB
    utgPlayer = activePlayers.find(p => p.seatNumber === dealerSeat && p.id !== bbPlayer.id && canAct(p));
    if (!utgPlayer) {
      // Dealer can't act (e.g. all-in) - find first after dealer: SB, then BB
      let searchSeat = dealerSeat - 1;
      if (searchSeat < minSeat) searchSeat = maxSeat;
      for (let i = 0; i < 2; i++) {
        utgPlayer = activePlayers.find(p => p.seatNumber === searchSeat && p.id !== bbPlayer.id && canAct(p));
        if (utgPlayer) break;
        searchSeat = searchSeat - 1 < minSeat ? maxSeat : searchSeat - 1;
      }
    }
    utgSeat = utgPlayer ? utgPlayer.seatNumber : null;
    if (utgPlayer) {
      console.log(`[POKER] Three-handed: UTG is seat ${utgSeat} (Button first when able)`);
    } else {
      utgPlayer = null;
      utgSeat = null;
    }
  } else {
    // Multi-way (4+): UTG is first player clockwise after BB who can act
    utgSeat = bbSeat - 1;
    if (utgSeat < minSeat) utgSeat = maxSeat;
    utgPlayer = activePlayers.find(p =>
      p.seatNumber === utgSeat && p.seatNumber >= 0 && p.id !== bbPlayer.id && canAct(p)
    );
    if (!utgPlayer) {
      let attempts = 0;
      let searchSeat = utgSeat;
      while (!utgPlayer && attempts < activePlayers.length) {
        searchSeat = searchSeat - 1 < minSeat ? maxSeat : searchSeat - 1;
        utgPlayer = activePlayers.find(p =>
          p.seatNumber === searchSeat && p.seatNumber >= 0 && p.id !== bbPlayer.id && canAct(p)
        );
        attempts++;
      }
      if (utgPlayer) utgSeat = utgPlayer.seatNumber;
    }
    if (!utgPlayer) {
      utgPlayer = activePlayers.find(p => p.seatNumber >= 0 && p.id !== bbPlayer.id && canAct(p));
      if (utgPlayer) utgSeat = utgPlayer.seatNumber;
    }
    if (!utgPlayer) {
      utgPlayer = null;
      utgSeat = null;
      console.log(`[POKER] Multi-way: no player can act (all all-in), no turn to set`);
    }
  }
  
  if (utgPlayer) {
    console.log(`[POKER] UTG calculation: dealer=${dealerSeat}, sb=${sbSeat}, bb=${bbSeat}, utg=${utgSeat} (${utgPlayer.user?.username || utgPlayer.userId})`);
  }

  // IMPORTANT: Never silently mutate a non-zero pot when starting a new hand.
  // If game.pot is non-zero here, a previous hand failed to award/zero the pot.
  // Zeroing it destroys chips (what you're seeing as chip conservation violations).
  // Instead of "fixing" it, abort starting the hand and surface a hard error so the
  // bug is visible and the table cannot continue in a broken state.
  const previousPot = game.pot ?? 0;
  if (previousPot > 0) {
    throw new Error(
      `[POKER] BUG: Tried to start new hand for game ${gameId} with non-zero pot=${previousPot}. ` +
      `Hand must NOT start until previous pot is correctly awarded/zeroed.`
    );
  }

  // Create hand state (explicitly clear showdown so client doesn't show old win/lose styling)
  const state = {
    handEnded: false, // Guard: set true when pot is awarded so we never double-award
    showdownActive: false,
    showdownResults: null,
    street: "PREFLOP",
    deck: remainingDeck,
    communityCards: [],
    bettingRound,
    pot: 0, // Always start each hand with 0; current betting round is added separately
    dealerSeat: dealerPlayer.seatNumber,
    smallBlindSeat: sbPlayer.seatNumber,
    bigBlindSeat: bbPlayer.seatNumber,
    currentTurnUserId: utgPlayer ? utgPlayer.userId : null, // First to act; null if everyone all-in
    currentTurnStartedAt: utgPlayer ? Date.now() : null, // When current turn started (for stuck-table recovery)
    lastRaiseUserId: null, // Track who last raised (for betting completion check)
    actedPlayersInRound: new Set(), // Track which players have acted in current betting round
    players: await (async () => {
      const result = [];
      for (const p of game.players) {
        const updated = await prisma.player.findUnique({ where: { id: p.id } });
        let holeCards = null;
        if (updated?.holeCards) {
          if (typeof updated.holeCards === 'object') {
            holeCards = updated.holeCards;
          } else if (typeof updated.holeCards === 'string') {
            try {
              holeCards = JSON.parse(updated.holeCards);
            } catch (e) {
              console.warn(`[POKER] Failed to parse holeCards from database for player ${p.id}:`, e.message);
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
              const activeIndex = activeDealtPlayers.findIndex(ap => ap.id === p.id);
              holeCards = activeIndex >= 0 ? dealtHands[activeIndex] : null;
            }
          }
        } else {
          const activeIndex = activeDealtPlayers.findIndex(ap => ap.id === p.id);
          holeCards = activeIndex >= 0 ? dealtHands[activeIndex] : null;
        }
        result.push({
          ...p,
          user: p.user,
          chips: updated?.chips || p.chips,
          holeCards,
          contributions: 0,
          name: p.user?.username || "Player"
        });
      }
      return result;
    })()
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

  console.log(`[POKER] Starting hand: dealer=${dealerPlayer.seatNumber}, sb=${sbPlayer.seatNumber}, bb=${bbPlayer.seatNumber}, utg=${utgPlayer ? utgPlayer.seatNumber : 'none (all-in)'}`);
  if (utgPlayer) {
    console.log(`[POKER] Setting currentTurnUserId to UTG: ${utgPlayer.userId} (${utgPlayer.user?.username || 'unknown'})`);
    console.log(`[POKER] BB contribution: ${bettingRound.getPlayerContribution(bbPlayer.id)}, currentBet: ${bettingRound.currentBet}`);
    console.log(`[POKER] UTG contribution: ${bettingRound.getPlayerContribution(utgPlayer.id)}, currentBet: ${bettingRound.currentBet}`);
    startTurnTimer(gameId, utgPlayer.userId, io);
  } else {
    // Everyone all-in: no one to act, advance to next street
    console.log(`[POKER] All players all-in, advancing to next street`);
    state.currentTurnUserId = null;
    state.currentTurnStartedAt = null;
    tableState.set(gameId, state);
    await advanceToNextStreet(gameId, io);
  }

  console.log(`[POKER] Started hand for game ${gameId}: dealer=${dealerPlayer.seatNumber}, sb=${sbPlayer.seatNumber}, bb=${bbPlayer.seatNumber}, utg=${utgPlayer ? utgPlayer.seatNumber : 'none'}`);
  
  return state;
}

// startTurnTimer and autoFoldPlayer now live in ../poker/turnTimers.js
// handleTestPlayerAction lives in ../poker/testPlayers.js (used by turnTimers)


/**
 * Check if blind level should advance based on tournament elapsed time.
 * When advancing, syncs ALL tables in the tournament to the same level so every table
 * is on the same blind level at the same time.
 */
async function checkAndAdvanceBlindLevel(tournamentId, gameId, io) {
  try {
    const { syncBlindLevelsToTournamentTime, getTournamentBlindLevelFromTime } = await import("../../services/TournamentEngine.js");
    const tournament = await prisma.tournament.findUnique({
      where: { id: tournamentId }
    });

    if (!tournament || tournament.status !== "RUNNING" || !tournament.startedAt) {
      return;
    }

    const result = getTournamentBlindLevelFromTime(tournament);
    if (!result) return;

    const { currentLevelIndex } = result;
    const game = await prisma.game.findUnique({
      where: { id: gameId },
      select: { currentBlindLevel: true }
    });

    if (!game) return;

    const gameLevel = game.currentBlindLevel ?? 0;
    console.log(`[BLIND LEVEL] Tournament ${tournamentId}, game ${gameId}: calculatedLevel=${currentLevelIndex}, gameLevel=${gameLevel}`);

    if (currentLevelIndex > gameLevel) {
      const socketIO = io || getIO();
      await syncBlindLevelsToTournamentTime(tournamentId, socketIO, { emitDealerMessage: true });
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

// runCinematicAllInShowdown lives in ../poker/showdown.js (used by advanceStreet)

export function registerPokerHandlers(io) {
  // Store io instance for use by other modules (getIO from tableState)
  setIO(io);
  
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

        // Leave all other game rooms so we only receive events for THIS table.
        // Without this, after consolidation+redirect the user stays in the old room
        // and receives game-state from both tables, causing the view to flip between them.
        for (const room of socket.rooms) {
          if (room.startsWith("game:") && room !== `game:${gameId}`) {
            socket.leave(room);
          }
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
            // Guard: prevent double-award if hand already ended (e.g. from another path)
            if (state.handEnded) {
              console.log(`[POKER] Single player remaining but hand already ended - skipping award`);
              return;
            }
            // Only one player remaining - award pot and end hand
            const winner = activePlayersAfterAction[0];
            const collectedPot = state.bettingRound.getTotalPot();
            const totalPot = state.pot + collectedPot;
            
            const winnerName = winner.name || winner.user?.username || `Player ${winner.seatNumber}`;
            
            // Check if this is an uncalled bet (bet/raise that wasn't called)
            const isUncalledBet = lastRaiserUserId && lastRaiserUserId === winner.userId && currentBet > 0;
            
            winner.chips += totalPot;
            state.pot = 0;
            state.handEnded = true;
            tableState.set(gameId, state);
            
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
            
            // Persist winner chips and game pot BEFORE tournament completion so audit sees correct totals
            await prisma.player.update({
              where: { id: winner.id },
              data: { chips: winner.chips }
            }).catch(err => console.error('[POKER] Error updating winner chips:', err));
            await prisma.game.update({
              where: { id: gameId },
              data: { pot: 0 }
            }).catch(err => console.error('[POKER] Error updating game pot:', err));

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
                await tournamentEngine.onPlayerBust(game.tournament.id, busted.id).catch(() => {});
                busted.status = 'ELIMINATED';
                // Don't change seatNumber - keep it to avoid unique constraint violation
                // ELIMINATED players are filtered out by status, not seatNumber
                await prisma.player.update({
                  where: { id: busted.id },
                  data: { 
                    status: 'ELIMINATED',
                    chips: 0
                  }
                }).catch(err => {
                  if (err?.code === 'P2025') {
                    console.log(`[POKER] Player ${busted.id} already removed (consolidation), skipping bust update`);
                  } else {
                    console.error(`[POKER] Error updating busted player ${busted.id}:`, err);
                  }
                });
              }
              await emitIfTournamentCompleted(game.tournament.id, gameId, socket.server);
            }
            
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
                }).catch(err => {
                  if (err?.code === 'P2025') return;
                  console.error(`[POKER] Error resetting player ${p.id}:`, err);
                });
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

            // Show table win message and +potWon before next hand (no hand strength - fold/uncalled win)
            state.showdownActive = true;
            state.showdownResults = {
              winners: [{ playerId: winner.id, userId: winner.userId, name: winnerName, potWon: totalPot }]
            };
            tableState.set(gameId, state);

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


