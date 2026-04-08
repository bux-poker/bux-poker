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

/** Worst possible showdown rank — loses any real hand; still participates in side-pot math. */
const INVALID_SHOWDOWN_HAND = Object.freeze({
  category: "INVALID",
  strength: -1,
  bestFive: [],
});

/** Clockwise seat order starting at the first seat strictly after the button, then wrapping. */
function orderSeatsClockwiseFromDealer(seatNumbers, dealerSeat) {
  const u = [...new Set(seatNumbers)].sort((a, b) => a - b);
  if (u.length === 0) return [];
  const d = dealerSeat ?? u[0];
  const after = u.filter((s) => s > d);
  const wrap = u.filter((s) => s <= d);
  return [...after, ...wrap];
}

/** Split `total` across tied winners: equal base, remainder as +1 chips to first seats after button. */
function distributePotAcrossTiedWinners(total, tiedHandResults, state, totalWon, logLabel) {
  const n = tiedHandResults.length;
  if (n === 0 || total <= 0) return;
  const base = Math.floor(total / n);
  const extra = total % n;
  const ordered = orderTiedHandResultsForOddChip(tiedHandResults, state);
  ordered.forEach((winner, i) => {
    const amount = base + (i < extra ? 1 : 0);
    if (amount <= 0) return;
    const pl = winner.player;
    const cur = totalWon.get(pl.id) || 0;
    totalWon.set(pl.id, cur + amount);
    pl.chips += amount;
    console.log(
      `${logLabel} +${amount} chips to ${pl.name || pl.userId} (seat ${pl.seatNumber})`
    );
  });
}

function orderTiedHandResultsForOddChip(tiedResults, state) {
  if (tiedResults.length <= 1) return [...tiedResults];
  const seats = tiedResults.map((r) => r.player.seatNumber);
  const order = orderSeatsClockwiseFromDealer(seats, state.dealerSeat);
  const rank = new Map(order.map((s, i) => [s, i]));
  return [...tiedResults].sort(
    (a, b) =>
      (rank.get(a.player.seatNumber) ?? 99) -
      (rank.get(b.player.seatNumber) ?? 99)
  );
}

function sumTotalWonMap(totalWon) {
  let s = 0;
  for (const v of totalWon.values()) {
    s += Number(v) || 0;
  }
  return s;
}

/**
 * After side-pot awards, guarantee sum(stack deltas recorded in totalWon) === potToAward exactly.
 * Uses table-best hand for top-up and reverse-by-won for clawback, then a single-seat micro adjust if needed.
 */
function reconcilePotAwardToExact(
  potToAward,
  handResults,
  state,
  totalWon,
  gameId
) {
  const tableNuts = () => {
    const maxS = Math.max(...handResults.map((r) => r.strength));
    return handResults.filter((r) => r.strength === maxS);
  };

  for (let iter = 0; iter < 16; iter++) {
    const distributed = sumTotalWonMap(totalWon);
    const delta = potToAward - distributed;
    if (delta === 0) return;

    if (delta > 0) {
      const winners = tableNuts();
      if (winners.length === 0) break;
      distributePotAcrossTiedWinners(
        delta,
        winners,
        state,
        totalWon,
        `[SHOWDOWN] exactness top-up`
      );
      continue;
    }

    let need = -delta;
    const rows = Array.from(totalWon.entries())
      .filter(([, w]) => w > 0)
      .sort((a, b) => b[1] - a[1]);
    for (const [playerId, won] of rows) {
      if (need <= 0) break;
      const player = state.players.find((p) => p.id === playerId);
      if (!player) continue;
      const stack = Math.max(0, Number(player.chips) || 0);
      const take = Math.min(need, won, stack);
      if (take <= 0) continue;
      totalWon.set(playerId, won - take);
      player.chips -= take;
      need -= take;
      console.warn(
        `[SHOWDOWN] exactness clawback -${take} from ${player.name || player.userId} (game ${gameId})`
      );
    }
  }

  let residual = potToAward - sumTotalWonMap(totalWon);
  if (residual !== 0 && handResults.length > 0) {
    const w =
      orderTiedHandResultsForOddChip(tableNuts(), state)[0] || handResults[0];
    w.player.chips += residual;
    totalWon.set(w.player.id, (totalWon.get(w.player.id) || 0) + residual);
    console.error(
      `[SHOWDOWN] exactness final adjust ${residual} to ${w.player.name || w.player.userId} (game ${gameId})`
    );
    residual = potToAward - sumTotalWonMap(totalWon);
  }

  const finalSum = sumTotalWonMap(totalWon);
  if (finalSum !== potToAward) {
    console.error(
      `[SHOWDOWN] FATAL pot invariant: game=${gameId} potToAward=${potToAward} totalWonSum=${finalSum}`
    );
  }
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
          } (seat ${player.seatNumber}) has invalid hole cards — ranked last (cannot beat any valid hand):`,
          player.holeCards
        );
        return {
          player,
          hand: { ...INVALID_SHOWDOWN_HAND },
          strength: INVALID_SHOWDOWN_HAND.strength,
        };
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

      try {
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
      } catch (e) {
        console.error(
          `[SHOWDOWN] evaluateBestHand failed for ${player.name || player.userId}:`,
          e?.message || e
        );
        return {
          player,
          hand: { ...INVALID_SHOWDOWN_HAND },
          strength: INVALID_SHOWDOWN_HAND.strength,
        };
      }
    });

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

  if (activePlayers.length === 0 || handResults.length === 0) {
    console.error(`[SHOWDOWN] Cannot distribute: no active players (game ${gameId})`);
    return;
  }

  let potToAward = 0;

  {
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
      let eligiblePlayerIds = Array.from(totalContributions.entries())
        .filter(
          ([id, contribution]) =>
            contribution >= currentLevel && nonFoldedIds.has(id)
        )
        .map(([id]) => id);

      if (contributorCount === 0) continue;

      const potAmount = (currentLevel - previousLevel) * contributorCount;

      if (potAmount > 0) {
        if (eligiblePlayerIds.length === 0 && activePlayers.length > 0) {
          eligiblePlayerIds = activePlayers.map((p) => p.id);
        }
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
      const maxContrib = Math.max(
        0,
        ...Array.from(totalContributions.values())
      );
      sidePots.push({
        level: maxContrib,
        amount: actualPot,
        eligiblePlayerIds: activePlayers.map((p) => p.id),
      });
    }

    potToAward = state.pot;
    const contribSum = Array.from(totalContributions.values()).reduce(
      (a, b) => a + b,
      0
    );
    if (contribSum !== potToAward) {
      console.error(
        `[SHOWDOWN] contribution sum ${contribSum} !== pot ${potToAward} (game ${gameId}) — awarding by pot size; fix betting/pot merge`
      );
    }

    let layerSum = sidePots.reduce((s, p) => s + p.amount, 0);
    if (sidePots.length > 0 && layerSum !== potToAward) {
      const fix = potToAward - layerSum;
      sidePots[sidePots.length - 1].amount += fix;
      layerSum = potToAward;
      console.warn(
        `[SHOWDOWN] adjusted last side-pot layer by ${fix} so Σlayers === pot (${potToAward})`
      );
    }

    totalWon = new Map();
    for (const p of state.players) {
      if (p.status !== "ELIMINATED") totalWon.set(p.id, 0);
    }

    for (const pot of sidePots) {
      if (pot.amount <= 0) continue;
      let eligibleHandResults = handResults.filter((r) =>
        pot.eligiblePlayerIds.includes(r.player.id)
      );
      if (eligibleHandResults.length === 0 && pot.eligiblePlayerIds.length > 0) {
        console.error(
          `[SHOWDOWN] BUG: side pot level ${pot.level} missing hand rows for eligible IDs — recovering seats from table state (worst rank until fixed)`
        );
        eligibleHandResults = pot.eligiblePlayerIds
          .map((id) =>
            state.players.find(
              (p) =>
                p.id === id &&
                p.status !== "FOLDED" &&
                p.status !== "ELIMINATED"
            )
          )
          .filter(Boolean)
          .map((player) => ({
            player,
            hand: { ...INVALID_SHOWDOWN_HAND },
            strength: INVALID_SHOWDOWN_HAND.strength,
          }));
      }
      if (eligibleHandResults.length === 0) {
        console.error(
          `[SHOWDOWN] BUG: side pot level ${pot.level} still has no seat rows — using full showdown field (game ${gameId})`
        );
        eligibleHandResults = [...handResults];
      }
      const maxS = Math.max(...eligibleHandResults.map((r) => r.strength));
      const potWinners = eligibleHandResults.filter((r) => r.strength === maxS);
      console.log(
        `[SHOWDOWN] Side pot ${pot.level}: ${potWinners.length} winner(s) tie at strength ${maxS} for ${pot.amount} chips`
      );
      distributePotAcrossTiedWinners(
        pot.amount,
        potWinners,
        state,
        totalWon,
        `[SHOWDOWN] Side pot ${pot.level}`
      );
    }
  }

  reconcilePotAwardToExact(potToAward, handResults, state, totalWon, gameId);

  const verified = sumTotalWonMap(totalWon);
  if (verified !== potToAward) {
    console.error(
      `[SHOWDOWN] post-reconcile mismatch game=${gameId} pot=${potToAward} sum=${verified}`
    );
  }

  // Persist every seat (incl. folded); only writing active players left stale DB stacks.
  await persistAllPlayerStacksFromHandState(state, "[SHOWDOWN]");
  await prisma.game
    .update({ where: { id: gameId }, data: { pot: 0 } })
    .catch((err) => console.error("[SHOWDOWN] Error zeroing game pot:", err));
  state.pot = 0;

  // Everyone who won any slice of the pot (main + side pots), strongest display order
  const showdownWinners = handResults
    .filter((r) => (totalWon.get(r.player.id) || 0) > 0)
    .sort(
      (a, b) =>
        (totalWon.get(b.player.id) || 0) - (totalWon.get(a.player.id) || 0)
    )
    .map((r) => {
      const potWon = totalWon.get(r.player.id) || 0;
      const name = r.player.name || r.player.user?.username || r.player.userId;
      return {
        playerId: r.player.id,
        userId: r.player.userId,
        name,
        potWon,
        handCategory: r.hand?.category || null,
        hand: r.hand
          ? { category: r.hand.category, cards: r.hand.bestFive || [] }
          : null,
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
