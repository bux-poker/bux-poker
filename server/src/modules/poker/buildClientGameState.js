// Build the client-facing representation of a game + in-memory hand state.
// Extracted from pokerHandler so it can be reused without pulling in the entire socket handler.

import {
  consolidationWaitMessageForGame,
  isGameConsolidationWaiting,
} from "../../services/tournament/consolidateTables.js";
import { normalizeUserId } from "./normalizeUserId.js";

/** In-memory state can rarely have a plain-object bettingRound (no class methods) — never throw on join. */
function safeBettingRoundTotalPot(round) {
  if (!round || typeof round.getTotalPot !== "function") return 0;
  try {
    const n = round.getTotalPot();
    return typeof n === "number" && !Number.isNaN(n) ? n : 0;
  } catch {
    return 0;
  }
}

function safePlayerContribution(round, playerId) {
  if (!round || typeof round.getPlayerContribution !== "function") return 0;
  try {
    const n = round.getPlayerContribution(playerId);
    return typeof n === "number" && !Number.isNaN(n) ? n : 0;
  } catch {
    return 0;
  }
}

function parsePlayerHoleCards(p) {
  if (!p.holeCards) return null;
  if (typeof p.holeCards === "object") return p.holeCards;
  if (typeof p.holeCards === "string") {
    try {
      return JSON.parse(p.holeCards);
    } catch (e) {
      console.warn(
        `[POKER] Failed to parse holeCards for player ${p.id}:`,
        e.message
      );
      return null;
    }
  }
  return null;
}

/**
 * Table UI should not show empty stacks except real all-in (0 chips, still in this hand).
 * DB rows merged mid-hand for reseats could otherwise appear as ACTIVE 0-chip ghosts.
 * Stale ALL_IN + 0 chips from the *previous* hand must not appear when a new hand only
 * dealt to chip-positive players (game-state merge pulls full DB roster).
 * Always include the viewer so bust / elimination flows still see their row in payload.
 * @param {Set<string>|null} inHandPlayerIds — player ids in this hand's in-memory state; null if no hand state.
 */
function includePlayerInClientTableList(p, viewerUserIdNorm, inHandPlayerIds) {
  if (p.status === "ELIMINATED") return false;
  const chips = Number(p.chips ?? 0);
  if (chips > 0) return true;
  const inThisHand =
    inHandPlayerIds != null && inHandPlayerIds.has(p.id);
  if (p.status === "ALL_IN" && inThisHand) return true;
  if (
    viewerUserIdNorm != null &&
    normalizeUserId(p.userId) === viewerUserIdNorm
  ) {
    return true;
  }
  return false;
}

/** Hide mucked / not-yet-revealed showdown cards from everyone except the seat owner. */
function shouldHideHoleCardsFromViewer(p, viewerUserId, optionalRevealPhase) {
  if (!optionalRevealPhase) return false;
  // No session on socket → keep legacy “same for everyone” payload (avoid hiding from self).
  if (viewerUserId == null) return false;
  const st = p.showdownRevealStatus;
  if (st !== "PENDING" && st !== "MUCK") return false;
  const mine = normalizeUserId(p.userId);
  const vu = normalizeUserId(viewerUserId);
  if (mine === vu) return false;
  return true;
}

export function buildClientGameState(game, state, viewerUserId) {
  // Calculate total pot: state.pot (accumulated from previous streets) + current betting round
  const totalPot = state
    ? (state.pot || 0) + safeBettingRoundTotalPot(state.bettingRound)
    : game.pot || 0;

  // Start of new hand: never send stale card data from previous hand
  const street = state?.street || "PREFLOP";
  const hasWinners = (state?.showdownResults?.winners?.length || 0) > 0;
  const isNewHand = street === "PREFLOP" && !state?.showdownActive && !hasWinners;
  const communityCardsEncoded = isNewHand
    ? "[]"
    : JSON.stringify(state?.communityCards ?? []);

  // Closed / non-active tables must never show "wait for hand" — players were moved; staying on
  // this URL is already a stale view. The in-memory wait set can lag until the next poll wave.
  const consolidationWaitingMessage =
    game.tournamentId &&
    game.status === "ACTIVE" &&
    isGameConsolidationWaiting(game.id)
      ? consolidationWaitMessageForGame(game.id)
      : null;

  let currentTurnUserId = state?.currentTurnUserId;
  if (currentTurnUserId != null && state?.players?.length) {
    const tu = normalizeUserId(currentTurnUserId);
    const tp = state.players.find((p) => normalizeUserId(p.userId) === tu);
    const cannotBet =
      !tp ||
      tp.status === "FOLDED" ||
      tp.status === "ELIMINATED" ||
      tp.status === "ALL_IN" ||
      (tp.chips ?? 0) <= 0;
    if (cannotBet) {
      currentTurnUserId = null;
    }
  }

  const vuNorm =
    viewerUserId != null ? normalizeUserId(viewerUserId) : null;
  const showdownForcedReveal = !!state?.showdownForcedReveal;
  const optionalRevealPhase =
    !!state?.showdownActive &&
    !!state?.showdownResults &&
    !showdownForcedReveal;

  const showdownNeedsChoice =
    !!vuNorm &&
    optionalRevealPhase &&
    (state?.players || []).some(
      (p) =>
        normalizeUserId(p.userId) === vuNorm &&
        p.showdownRevealStatus === "PENDING"
    );

  // Mid-hand tournament moves: DB has a seated player not yet in this hand's in-memory list — show them (next hand they play).
  let playersForDisplay = state?.players?.length
    ? [...state.players]
    : [...(game.players || [])];
  if (state?.players?.length && game.players?.length) {
    const seenIds = new Set(playersForDisplay.map((p) => p.id));
    const seenUserIds = new Set(
      playersForDisplay
        .map((p) => normalizeUserId(p.userId))
        .filter((u) => u != null && u !== "")
    );
    for (const gp of game.players) {
      if (gp.status === "ELIMINATED" || seenIds.has(gp.id)) continue;
      const uid = normalizeUserId(gp.userId);
      if (uid && seenUserIds.has(uid)) continue;
      // Reseats during a hand only move chip-positive players; 0-chip DB rows here are
      // busted / stale ALL_IN from other hands — do not merge (avoids seat spam before filter).
      if (Number(gp.chips ?? 0) <= 0) continue;
      playersForDisplay.push(gp);
      seenIds.add(gp.id);
      if (uid) seenUserIds.add(uid);
    }
    playersForDisplay.sort(
      (a, b) => (a.seatNumber ?? 0) - (b.seatNumber ?? 0)
    );
  }

  /** Only seats dealt into this in-memory hand may show hole cards (DB rows can still carry stale cards). */
  const inHandPlayerIds =
    state?.players?.length > 0
      ? new Set(state.players.map((p) => p.id))
      : null;

  return {
    id: game.id,
    tournamentId: game.tournamentId,
    tableNumber: game.tableNumber,
    currentBlindLevel: game.currentBlindLevel ?? 0,
    pot: totalPot,
    consolidationWaitingMessage,
    communityCards: communityCardsEncoded,
    street,
    currentBet: state?.bettingRound?.currentBet || 0,
    minimumRaise:
      state?.bettingRound?.minimumRaise ||
      state?.bettingRound?.bigBlind ||
      20,
    smallBlind: state?.bettingRound?.smallBlind || 10,
    bigBlind: state?.bettingRound?.bigBlind || 20,
    dealerSeat: state?.dealerSeat ?? game.dealerSeat,
    smallBlindSeat: state?.smallBlindSeat ?? game.smallBlindSeat,
    bigBlindSeat: state?.bigBlindSeat ?? game.bigBlindSeat,
    currentTurnUserId,
    showdownActive: isNewHand ? false : state?.showdownActive || false,
    showdownResults: isNewHand ? null : state?.showdownResults || null,
    showdownForcedReveal: isNewHand ? false : showdownForcedReveal,
    showdownNeedsChoice: isNewHand ? false : showdownNeedsChoice,
    players: playersForDisplay
      .filter((p) => includePlayerInClientTableList(p, vuNorm, inHandPlayerIds))
      .map((p) => {
        const inCurrentHand =
          inHandPlayerIds == null || inHandPlayerIds.has(p.id);
        const parsed = inCurrentHand ? parsePlayerHoleCards(p) : null;
        const hide =
          parsed &&
          shouldHideHoleCardsFromViewer(p, viewerUserId, optionalRevealPhase);
        // Seats merged from DB mid-hand are not in this hand — strip stale lastAction/ALL_IN.
        // Never coerce real ELIMINATED (or other truth from DB) into ACTIVE; that looked like "resurrections".
        const statusForWaiter =
          inCurrentHand
            ? p.status
            : p.status === "ELIMINATED"
              ? "ELIMINATED"
              : p.status === "FOLDED"
                ? "ACTIVE"
                : p.status || "ACTIVE";
        return {
          id: p.id,
          userId: p.userId,
          name: p.user?.username || "Player",
          chips: p.chips,
          seatNumber: p.seatNumber,
          status: statusForWaiter,
          avatarUrl: p.user?.avatarUrl || null,
          lastAction: inCurrentHand ? p.lastAction || null : null,
          lastActionSeq: inCurrentHand ? p.lastActionSeq || 0 : 0,
          holeCards: hide ? null : parsed,
          contribution: safePlayerContribution(state?.bettingRound, p.id),
          showdownRevealStatus: inCurrentHand
            ? p.showdownRevealStatus || null
            : null,
        };
      }),
  };
}
