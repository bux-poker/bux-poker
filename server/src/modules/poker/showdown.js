import { prisma } from "../../config/database.js";
import { HandEvaluator } from "./HandEvaluator.js";
import { persistAllPlayerStacksFromHandState } from "./persistHandStacks.js";
import { tableState } from "./tableState.js";
import { postDealerMessage } from "./dealerMessages.js";
import { emitGameState } from "./emitGameState.js";
import { emitIfTournamentCompleted, startHandForGame } from "../socket-handlers/pokerHandler.js";
import { resetPlayerRowIfNotEliminated } from "./safeHandCleanupDb.js";

const SHOWDOWN_PHASE_DELAY_MS = 1000;
const SHOWDOWN_OPTIONAL_REVEAL_MAX_WAIT_MS = 5000;

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Serialize showdown per table — concurrent handleShowdown calls (advanceStreet + moveToNextPlayer + timers) double-award the pot and break chip conservation. */
const showdownSerializeTail = new Map();

async function runShowdownSerialized(gameId, fn) {
  const prev = showdownSerializeTail.get(gameId) || Promise.resolve();
  let resolveDone;
  const done = new Promise((r) => {
    resolveDone = r;
  });
  showdownSerializeTail.set(gameId, prev.then(() => done));
  await prev;
  try {
    return await fn();
  } finally {
    resolveDone();
  }
}

/** Dealt into this hand (folded players still have hole cards until cleanup). */
function hasTwoHoleCards(player) {
  let hc = player.holeCards;
  if (!hc) return false;
  if (typeof hc === "string") {
    const t = hc.trim();
    if (!t) return false;
    try {
      hc = JSON.parse(t);
    } catch {
      return false;
    }
  }
  return Array.isArray(hc) && hc.length === 2;
}

/** After chips are awarded: clear table state, reset DB rows, maybe start next hand. */
async function runShowdownTableCleanup(gameId, io) {
  const st = tableState.get(gameId);
  if (!st) return;
  const savedPlayers = [...st.players];
  tableState.delete(gameId);
  const resetPromises = savedPlayers
    .filter((p) => p.status !== "ELIMINATED" && p.chips > 0)
    .map((p) => resetPlayerRowIfNotEliminated(p.id).catch(() => {}));
  Promise.all(resetPromises).then(async () => {
    const gameForNextHand = await prisma.game
      .findUnique({
        where: { id: gameId },
        include: { players: true, tournament: true },
      })
      .catch(() => null);
    if (
      gameForNextHand &&
      gameForNextHand.players.filter((p) => p.status === "ACTIVE").length >= 2 &&
      io
    ) {
      try {
        await startHandForGame(gameId, io);
      } catch (err) {
        console.error("[SHOWDOWN] Error starting next hand after showdown:", err);
      }
    }
  });
}

export function scheduleShowdownTableCleanup(gameId, io, delayMs) {
  const state = tableState.get(gameId);
  if (!state || !io) return;
  if (state.showdownCleanupTimerId) {
    clearTimeout(state.showdownCleanupTimerId);
    state.showdownCleanupTimerId = null;
  }
  state.showdownCleanupTimerId = setTimeout(() => {
    const st = tableState.get(gameId);
    if (st) st.showdownCleanupTimerId = null;
    void runShowdownTableCleanup(gameId, io);
  }, delayMs);
  tableState.set(gameId, state);
}

/** When every loser has shown or mucked, shorten the wait before the next hand. */
export function tryAccelerateShowdownCleanup(gameId, io) {
  const state = tableState.get(gameId);
  if (!state || !state.showdownActive || !io) return;
  const pending = state.players.some((p) => p.showdownRevealStatus === "PENDING");
  if (pending) return;
  scheduleShowdownTableCleanup(gameId, io, 1200);
}

export async function handleShowdownCore(gameId, io, options = {}) {
  return runShowdownSerialized(gameId, () =>
    handleShowdownCoreImpl(gameId, io, options)
  );
}

async function handleShowdownCoreImpl(gameId, io, options = {}) {
  const state = tableState.get(gameId);
  if (!state) return;

  const evaluator = new HandEvaluator();

  const collectedPot = state.bettingRound.getTotalPot();
  const oldPot = state.pot || 0;
  state.pot = oldPot + collectedPot;
  if (state.handEnded) {
    console.log(
      "[SHOWDOWN] Hand already ended - skipping showdown distribution"
    );
    return;
  }
  state.handEnded = true;
  tableState.set(gameId, state);

  const activePlayers = state.players.filter(
    (p) => p.status !== "FOLDED" && p.status !== "ELIMINATED"
  );

  if (activePlayers.length === 0) {
    console.log("[SHOWDOWN] No active players for showdown");
    return;
  }

  const chipsBeforeDist = activePlayers.reduce(
    (s, p) => s + (p.chips || 0),
    0
  );
  console.log(
    `[SHOWDOWN] Starting showdown with ${activePlayers.length} active players (excluding folded players)`
  );
  console.log("[SHOWDOWN] Community cards:", state.communityCards);
  console.log(
    `[SHOWDOWN] Total pot: ${state.pot} (old: ${oldPot}, collected: ${collectedPot}), chips before dist: ${chipsBeforeDist}`
  );

  if (io) {
    postDealerMessage(gameId, io, "Showdown! Turning over cards...");
  }

  const handResults = activePlayers
    .map((player) => {
      let holeCards = player.holeCards;
      if (typeof holeCards === "string" && holeCards.trim()) {
        try {
          holeCards = JSON.parse(holeCards);
        } catch (e) {
          holeCards = null;
        }
      }
      if (!holeCards || !Array.isArray(holeCards) || holeCards.length !== 2) {
        console.warn(
          `[SHOWDOWN] Player ${
            player.name || player.userId
          } (seat ${player.seatNumber}) has invalid hole cards:`,
          player.holeCards
        );
        return { player, hand: null, strength: -1 };
      }

      const sevenCards = [...state.communityCards, ...holeCards];

      console.log(
        `[SHOWDOWN] Evaluating 7 cards for ${
          player.name || player.userId
        } (seat ${player.seatNumber}, id: ${player.id}):`,
        {
          holeCards,
          community: state.communityCards,
          sevenCards,
        }
      );

      const hand = evaluator.evaluateBestHand(sevenCards);

      console.log(
        `[SHOWDOWN] Player ${
          player.name || player.userId
        } (seat ${player.seatNumber}, id: ${
          player.id
        }): ${hand.category}, strength=${hand.strength}, bestFive=${JSON.stringify(
          hand.bestFive
        )}`
      );

      return {
        player,
        hand,
        strength: hand.strength,
      };
    })
    .filter((result) => result.hand !== null);

  let totalWon;
  let sidePots = [];

  const totalContributions = new Map();
  const allPlayersInHand = state.players.filter(
    (p) => p.status !== "ELIMINATED"
  );
  allPlayersInHand.forEach((player) => {
    const handContribution = player.contributions || 0;
    const currentContribution =
      state.bettingRound.getPlayerContribution(player.id) || 0;
    totalContributions.set(player.id, handContribution + currentContribution);
  });

  if (handResults.length === 0) {
    console.error(
      `[SHOWDOWN] FATAL: No valid hands evaluated for game ${gameId} with pot=${state.pot}. ` +
        "Refusing to distribute chips; table should be investigated and restarted."
    );
    return;
  } else {
    const maxStrength = Math.max(...handResults.map((r) => r.strength));
    const winners = handResults.filter((r) => r.strength === maxStrength);

    console.log(
      `[SHOWDOWN] ${winners.length} winner(s) with strength ${maxStrength}:`
    );
    winners.forEach((w) => {
      console.log(
        `[SHOWDOWN]   Winner: ${
          w.player.name || w.player.userId
        } (seat ${w.player.seatNumber}) - ${w.hand.category}`
      );
    });

    const contributionAmounts = Array.from(
      new Set(totalContributions.values())
    )
      .filter((x) => x > 0)
      .sort((a, b) => a - b);

    console.log(
      "[SHOWDOWN] Total contributions:",
      Array.from(totalContributions.entries()).map(([id, amount]) => {
        const player = activePlayers.find((p) => p.id === id);
        return `${player?.name || player?.userId || id}: ${amount}`;
      })
    );
    console.log(
      "[SHOWDOWN] Unique contribution levels:",
      contributionAmounts
    );

    sidePots = [];
    let previousLevel = 0;

    const nonFoldedIds = new Set(activePlayers.map((p) => p.id));
    for (let i = 0; i < contributionAmounts.length; i++) {
      const currentLevel = contributionAmounts[i];

      const contributorCount = Array.from(totalContributions.entries()).filter(
        ([, c]) => c >= currentLevel
      ).length;
      const eligiblePlayerIds = Array.from(totalContributions.entries())
        .filter(
          ([id, contribution]) =>
            contribution >= currentLevel && nonFoldedIds.has(id)
        )
        .map(([id]) => id);

      if (contributorCount === 0) continue;

      const potAmount = (currentLevel - previousLevel) * contributorCount;

      if (potAmount > 0) {
        sidePots.push({
          level: currentLevel,
          amount: potAmount,
          eligiblePlayerIds: eligiblePlayerIds,
        });
        console.log(
          `[SHOWDOWN] Side pot ${i + 1}: ${potAmount} chips (level ${currentLevel}), ${eligiblePlayerIds.length} eligible players`
        );
      }

      previousLevel = currentLevel;
    }

    const calculatedPotTotal = sidePots.reduce(
      (sum, pot) => sum + pot.amount,
      0
    );

    const actualPot = state.pot;
    if (calculatedPotTotal !== actualPot && sidePots.length > 0) {
      console.log(
        `[SHOWDOWN] Pot mismatch: calculated=${calculatedPotTotal}, actual=${actualPot}, adjusting...`
      );
      if (calculatedPotTotal > 0 && calculatedPotTotal >= actualPot) {
        let running = 0;
        for (let i = 0; i < sidePots.length - 1; i++) {
          const scaled = Math.floor(
            (sidePots[i].amount * actualPot) / calculatedPotTotal
          );
          sidePots[i].amount = scaled;
          running += scaled;
        }
        sidePots[sidePots.length - 1].amount = actualPot - running;
      } else if (calculatedPotTotal < actualPot) {
        sidePots[sidePots.length - 1].amount = Math.max(
          0,
          sidePots[sidePots.length - 1].amount +
            (actualPot - calculatedPotTotal)
        );
      }
    } else if (sidePots.length === 0 && actualPot > 0) {
      sidePots.push({
        level: contributionAmounts[contributionAmounts.length - 1] || 0,
        amount: actualPot,
        eligiblePlayerIds: activePlayers.map((p) => p.id),
      });
    }

    totalWon = new Map();
    activePlayers.forEach((p) => totalWon.set(p.id, 0));

    for (const pot of sidePots) {
      if (pot.amount <= 0) continue;
      let potWinners;
      const eligibleHandResults = handResults.filter((r) =>
        pot.eligiblePlayerIds.includes(r.player.id)
      );
      if (eligibleHandResults.length === 0) {
        console.warn(
          `[SHOWDOWN] Side pot ${pot.level}: no eligible players found, skipping this pot distribution`
        );
        continue;
      } else {
        const maxStrength = Math.max(
          ...eligibleHandResults.map((r) => r.strength)
        );
        potWinners = eligibleHandResults.filter(
          (r) => r.strength === maxStrength
        );
      }
      const potPerWinner = Math.floor(pot.amount / potWinners.length);
      const remainder = pot.amount % potWinners.length;

      console.log(
        `[SHOWDOWN] Side pot ${pot.level}: ${potWinners.length} winner(s) for ${pot.amount} chips`
      );

      potWinners.forEach((winner, index) => {
        const amount = potPerWinner + (index === 0 ? remainder : 0);
        if (amount <= 0) return;
        const currentWon = totalWon.get(winner.player.id) || 0;
        totalWon.set(winner.player.id, currentWon + amount);
        winner.player.chips += amount;
        console.log(
          `[SHOWDOWN]   Distributing ${amount} chips to ${
            winner.player.name || winner.player.userId
          } (seat ${winner.player.seatNumber}) from side pot level ${
            pot.level
          }`
        );
      });
    }
  }

  const totalDistributed = Array.from(totalWon.values()).reduce(
    (s, a) => s + a,
    0
  );
  if (totalDistributed !== state.pot) {
    const diff = state.pot - totalDistributed;
    if (diff > 0) {
      console.error(
        `[SHOWDOWN] CHIP LEAK: distributed ${totalDistributed} but pot was ${state.pot} (shortfall ${diff}) - awarding remainder to winner`
      );
      if (handResults.length > 0) {
        const maxStrength = Math.max(...handResults.map((r) => r.strength));
        const winners = handResults.filter(
          (r) => r.strength === maxStrength
        );
        if (winners.length > 0) {
          winners[0].player.chips += diff;
          totalWon.set(
            winners[0].player.id,
            (totalWon.get(winners[0].player.id) || 0) + diff
          );
          console.log(
            `[SHOWDOWN]   Awarded ${diff} chips to ${
              winners[0].player.name || winners[0].player.userId
            } to fix leak`
          );
        }
      }
    } else if (diff < 0) {
      console.error(
        `[SHOWDOWN] CHIP CREATION: distributed ${totalDistributed} but pot was ${state.pot} (excess ${-diff}) - removing excess from winners`
      );
      const sorted = Array.from(totalWon.entries()).sort(
        (a, b) => b[1] - a[1]
      );
      let remaining = -diff;
      for (const [playerId, won] of sorted) {
        if (remaining <= 0) break;
        const player = activePlayers.find((p) => p.id === playerId);
        if (!player) continue;
        const take = Math.min(won, remaining);
        totalWon.set(playerId, won - take);
        player.chips -= take;
        remaining -= take;
        console.log(
          `[SHOWDOWN]   Removed ${take} chips from ${
            player.name || player.userId
          } to fix creation`
        );
      }
    }
  }

  // Persist every seat (incl. folded); only writing active players left stale DB stacks.
  await persistAllPlayerStacksFromHandState(state, "[SHOWDOWN]");
  await prisma.game
    .update({ where: { id: gameId }, data: { pot: 0 } })
    .catch((err) => console.error("[SHOWDOWN] Error zeroing game pot:", err));
  state.pot = 0;

  // Set showdownResults with hand category and winning cards for client + dealer messages
  const maxStrength = Math.max(...handResults.map((r) => r.strength));
  const showdownWinners = handResults
    .filter((r) => r.strength === maxStrength)
    .map((r) => {
      const potWon = totalWon.get(r.player.id) || 0;
      const name = r.player.name || r.player.user?.username || r.player.userId;
      return {
        playerId: r.player.id,
        userId: r.player.userId,
        name,
        potWon,
        handCategory: r.hand?.category || null,
        hand: r.hand ? { category: r.hand.category, cards: r.hand.bestFive || [] } : null,
      };
    });
  const forcedReveal = options.forcedReveal === true;
  state.showdownForcedReveal = forcedReveal;
  // Everyone who reached showdown already had hole cards revealed — no show/muck for them.
  const showdownParticipantIds = new Set(handResults.map((r) => r.player.id));
  // Optional reveal: folded players (dealt in, not in handResults) may still show or muck.
  for (const p of state.players) {
    delete p.showdownRevealStatus;
  }
  for (const p of state.players) {
    if (p.status === "ELIMINATED") continue;
    if (!hasTwoHoleCards(p)) continue;
    if (forcedReveal) {
      p.showdownRevealStatus = "SHOW";
    } else if (showdownParticipantIds.has(p.id)) {
      p.showdownRevealStatus = "SHOW";
    } else {
      p.showdownRevealStatus = "PENDING";
    }
  }

  const hasPendingOptional =
    !forcedReveal &&
    state.players.some((p) => p.showdownRevealStatus === "PENDING");
  const cleanupDelayMs = hasPendingOptional
    ? SHOWDOWN_OPTIONAL_REVEAL_MAX_WAIT_MS
    : options.cleanupDelayMs ?? 3000;

  state.showdownResults = { winners: showdownWinners };
  state.showdownActive = true;
  tableState.set(gameId, state);

  if (io) {
    // Dealer messages: who won, how much, and with what hand
    const formatCategory = (cat) =>
      (cat || "")
        .split("_")
        .map((w) => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase())
        .join(" ");
    for (const w of showdownWinners) {
      const msg = w.handCategory
        ? `${w.name} wins ${w.potWon.toLocaleString()} with ${formatCategory(w.handCategory)}`
        : `${w.name} wins ${w.potWon.toLocaleString()}`;
      postDealerMessage(gameId, io, msg);
    }

    await emitGameState(gameId, io, state);
    const winnerPayload = showdownWinners.map((w) => ({
      playerId: w.playerId,
      userId: w.userId,
      name: w.name,
      potWon: w.potWon,
    }));
    io.to(`game:${gameId}`).emit("winner", { gameId, winners: winnerPayload });
    const game = await prisma.game
      .findUnique({
        where: { id: gameId },
        include: { players: { include: { user: true } }, tournament: true },
      })
      .catch(() => null);

    // Schedule cleanup BEFORE bust/consolidation work. Awaiting onPlayerBust/onPlayersBust used to
    // block here while consolidateTables → waitForGameIdsToFinishHands polls other tables for
    // minutes: that froze showdown (serialized queue), starved the idle poll if anything awaited
    // the same chain, and matched Fly logs (no [SHOWDOWN] lines after "going to showdown").
    scheduleShowdownTableCleanup(gameId, io, cleanupDelayMs);

    if (game?.tournament?.id) {
      const tournamentId = game.tournament.id;
      const busted = state.players.filter((p) => p.chips <= 0 && p.status !== "ELIMINATED");
      if (busted.length > 0) {
        const { TournamentEngine } = await import("../../services/TournamentEngine.js");
        const tournamentEngine = new TournamentEngine();
        for (const p of busted) {
          p.status = "ELIMINATED";
        }
        console.log(
          `[SHOWDOWN] game ${gameId}: scheduling async onPlayersBust (${busted.length} player(s)) + consolidation — not blocking showdown completion`
        );
        void tournamentEngine
          .onPlayersBust(
            tournamentId,
            busted.map((p) => p.id)
          )
          .then(async () => {
            io.emit("tournament_updated", { tournamentId });
            await emitIfTournamentCompleted(tournamentId, io);
          })
          .catch((err) => {
            console.error(
              "[SHOWDOWN] Async onPlayersBust/consolidate after showdown failed:",
              err?.message || err
            );
          });
      } else {
        await emitIfTournamentCompleted(tournamentId, io);
      }
    }
  }
}

/** Thin wrapper for callers that expect handleShowdown (e.g. turnTimers). */
export async function handleShowdown(gameId, io, options = {}) {
  return handleShowdownCore(gameId, io, options);
}

/**
 * Cinematic all-in showdown: reveal cards, deal community cards one at a time with delays,
 * then evaluate and highlight winner. Called when betting completes with all players all-in
 * or only one player with chips.
 */
export async function runCinematicAllInShowdown(
  gameId,
  io,
  state,
  engine,
  allPlayersAllIn
) {
  const activePlayers = state.players.filter(
    (p) => p.status !== "FOLDED" && p.status !== "ELIMINATED"
  );
  if (activePlayers.length < 2) return;

  if (allPlayersAllIn) {
    postDealerMessage(gameId, io, "All players are all-in! Turning over cards...");
  } else {
    postDealerMessage(gameId, io, "Turning over cards...");
  }

  state.showdownActive = true;
  state.showdownResults = null;
  tableState.set(gameId, state);
  await emitGameState(gameId, io, state);
  await delay(SHOWDOWN_PHASE_DELAY_MS);

  if (state.street === "PREFLOP") {
    const { deck: newDeck, cards: flopCards } = engine.dealFlop(state.deck);
    state.deck = newDeck;
    state.communityCards = flopCards;
    state.street = "FLOP";
    tableState.set(gameId, state);
    postDealerMessage(gameId, io, "Dealing the flop...");
    await emitGameState(gameId, io, state);
    if (state.communityCards.length !== 3) {
      console.warn(
        `[SHOWDOWN] Flop should have 3 cards, got ${state.communityCards.length}`
      );
    }
    await delay(SHOWDOWN_PHASE_DELAY_MS);
  }
  if (state.street === "FLOP") {
    const { deck: newDeck, card: turnCard } = engine.dealTurnOrRiver(state.deck);
    state.deck = newDeck;
    state.communityCards = [...state.communityCards, turnCard];
    state.street = "TURN";
    tableState.set(gameId, state);
    postDealerMessage(gameId, io, "Dealing the turn...");
    await emitGameState(gameId, io, state);
    await delay(SHOWDOWN_PHASE_DELAY_MS);
  }
  if (state.street === "TURN") {
    const { deck: newDeck, card: riverCard } = engine.dealTurnOrRiver(state.deck);
    state.deck = newDeck;
    state.communityCards = [...state.communityCards, riverCard];
    state.street = "RIVER";
    tableState.set(gameId, state);
    postDealerMessage(gameId, io, "Dealing the river...");
    await emitGameState(gameId, io, state);
    await delay(SHOWDOWN_PHASE_DELAY_MS);
  }

  await handleShowdownCore(gameId, io, {
    cleanupDelayMs: SHOWDOWN_PHASE_DELAY_MS,
    forcedReveal: true,
  });
}
