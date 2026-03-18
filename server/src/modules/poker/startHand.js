/**
 * Core logic for starting a new hand: load game, blinds, dealer, SB/BB, deal cards,
 * post blinds, build state, set UTG and start turn timer (or advance street if all-in).
 * Extracted from pokerHandler for a single source of truth and testability.
 */
import { prisma } from "../../config/database.js";
import { TexasHoldem } from "./TexasHoldem.js";
import { BettingRound } from "./BettingRound.js";
import { tableState } from "./tableState.js";
import { postDealerMessage } from "./dealerMessages.js";
import { buildClientGameState } from "./buildClientGameState.js";
import { startTurnTimer } from "./turnTimers.js";
import { advanceToNextStreet } from "./advanceStreet.js";
import { emitIfTournamentCompleted } from "./tableTournamentHooks.js";

export async function startHandForGameBody(gameId, io) {
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
    return;
  }
  if (game.players.length < 2) {
    throw new Error("Not enough players");
  }

  if (tableState.get(gameId)) {
    return;
  }

  const playersWithChips = game.players.filter(p => p.status !== 'ELIMINATED' && p.chips > 0);
  if (playersWithChips.length < 2) {
    console.log(`[POKER] Not enough players with chips to start hand (${playersWithChips.length}), skipping. Tournament may be complete.`);
    if (game.tournament?.id && io) {
      await emitIfTournamentCompleted(game.tournament.id, io);
    }
    return;
  }

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

  const tournamentEngine = new TexasHoldem({ smallBlind, bigBlind });

  let dealerPlayer;
  let dealerSeat;
  const previousState = tableState.get(gameId);
  const previousDealerSeat = previousState?.dealerSeat ?? game.dealerSeat;

  const activePlayersForDealer = game.players.filter(p =>
    p.status === 'ACTIVE' && p.seatNumber >= 0 && p.chips > 0
  );

  if (previousDealerSeat !== null && previousDealerSeat !== undefined && activePlayersForDealer.length > 0) {
    const maxSeat = Math.max(...activePlayersForDealer.map(p => p.seatNumber));
    const minSeat = Math.min(...activePlayersForDealer.map(p => p.seatNumber));
    let nextDealerSeat = previousDealerSeat - 1;
    if (nextDealerSeat < minSeat) nextDealerSeat = maxSeat;

    dealerPlayer = activePlayersForDealer.find(p => p.seatNumber === nextDealerSeat);

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

  if (!dealerPlayer && activePlayersForDealer.length > 0) {
    const dealerIndex = Math.floor(Math.random() * activePlayersForDealer.length);
    dealerPlayer = activePlayersForDealer[dealerIndex];
    dealerSeat = dealerPlayer.seatNumber;
    console.log(`[POKER] ${previousDealerSeat !== null && previousDealerSeat !== undefined ? 'Rotation failed, ' : ''}Randomly assigned dealer at seat ${dealerSeat}`);
  }

  if (!dealerPlayer) {
    throw new Error(`No active players available to assign dealer`);
  }

  await prisma.game.update({
    where: { id: gameId },
    data: { dealerSeat: dealerSeat }
  }).catch(err => {
    if (err.message && err.message.includes('Unknown argument')) {
      console.warn(`[POKER] dealerSeat field not in database yet - migration needed. Error: ${err.message}`);
    } else {
      console.error(`[POKER] Error updating dealer seat:`, err);
    }
  });

  const maxSeat = Math.max(...activePlayersForDealer.map(p => p.seatNumber), 1);
  const minSeat = Math.min(...activePlayersForDealer.map(p => p.seatNumber), 8);
  const seatRange = maxSeat >= minSeat ? maxSeat - minSeat + 1 : 8;

  const activePlayers = game.players.filter(p =>
    p.status === 'ACTIVE' && p.seatNumber >= 0 && p.chips > 0
  );
  const isHeadsUp = activePlayers.length === 2;

  let sbSeat, bbSeat, sbPlayer, bbPlayer;

  if (isHeadsUp) {
    sbPlayer = dealerPlayer;
    sbSeat = dealerSeat;
    bbPlayer = activePlayers.find(p => p.id !== dealerPlayer.id);
    bbSeat = bbPlayer?.seatNumber;
    console.log(`[POKER] Heads-up game: Dealer (seat ${sbSeat}) posts small blind, Other player (seat ${bbSeat}) posts big blind`);
  } else {
    sbSeat = dealerSeat - 1 < minSeat ? maxSeat : dealerSeat - 1;
    bbSeat = sbSeat - 1 < minSeat ? maxSeat : sbSeat - 1;

    sbPlayer = activePlayers.find(p => p.seatNumber === sbSeat && p.seatNumber >= 0);
    bbPlayer = activePlayers.find(p => p.seatNumber === bbSeat && p.seatNumber >= 0);

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

  const bettingRound = new BettingRound({
    smallBlind,
    bigBlind,
    startingPot: 0
  });

  const sbAmount = Math.min(smallBlind, sbPlayer.chips);
  const bbAmount = Math.min(bigBlind, bbPlayer.chips);

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

    if (sbPlayer.chips === 0) {
      sbPlayer.status = "ALL_IN";
      console.log(`[POKER] SB is all-in (0 chips) after posting blind`);
    }
    if (bbPlayer.chips === 0) {
      bbPlayer.status = "ALL_IN";
      console.log(`[POKER] BB is all-in (0 chips) after posting blind`);
    }

    bettingRound.currentBet = bigBlind;
    bettingRound.minimumRaise = bigBlind;
  }

  const canAct = (p) => p.chips > 0 && p.status !== "ALL_IN";
  let utgPlayer;
  let utgSeat;

  if (activePlayers.length === 2) {
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
    utgPlayer = activePlayers.find(p => p.seatNumber === dealerSeat && p.id !== bbPlayer.id && canAct(p));
    if (!utgPlayer) {
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

  const previousPot = game.pot ?? 0;
  if (previousPot > 0) {
    throw new Error(
      `[POKER] BUG: Tried to start new hand for game ${gameId} with non-zero pot=${previousPot}. ` +
      `Hand must NOT start until previous pot is correctly awarded/zeroed.`
    );
  }

  const state = {
    handEnded: false,
    showdownActive: false,
    showdownResults: null,
    street: "PREFLOP",
    deck: remainingDeck,
    communityCards: [],
    bettingRound,
    pot: 0,
    dealerSeat: dealerPlayer.seatNumber,
    smallBlindSeat: sbPlayer.seatNumber,
    bigBlindSeat: bbPlayer.seatNumber,
    currentTurnUserId: utgPlayer ? utgPlayer.userId : null,
    currentTurnStartedAt: utgPlayer ? Date.now() : null,
    lastRaiseUserId: null,
    actedPlayersInRound: new Set(),
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

  await prisma.game.update({
    where: { id: gameId },
    data: { pot: state.pot }
  });

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
    console.log(`[POKER] All players all-in, advancing to next street`);
    state.currentTurnUserId = null;
    state.currentTurnStartedAt = null;
    tableState.set(gameId, state);
    await advanceToNextStreet(gameId, io);
  }

  console.log(`[POKER] Started hand for game ${gameId}: dealer=${dealerPlayer.seatNumber}, sb=${sbPlayer.seatNumber}, bb=${bbPlayer.seatNumber}, utg=${utgPlayer ? utgPlayer.seatNumber : 'none'}`);

  return state;
}
