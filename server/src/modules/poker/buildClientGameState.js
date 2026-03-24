// Build the client-facing representation of a game + in-memory hand state.
// Extracted from pokerHandler so it can be reused without pulling in the entire socket handler.

import { isGameConsolidationWaiting } from "../../services/tournament/consolidateTables.js";
import { normalizeUserId } from "./normalizeUserId.js";

const CONSOLIDATION_WAIT_MESSAGE =
  "Waiting for this table's hand to finish before reseating...";

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

  const consolidationWaitingMessage =
    game.tournamentId && isGameConsolidationWaiting(game.id)
      ? CONSOLIDATION_WAIT_MESSAGE
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
    const seen = new Set(playersForDisplay.map((p) => p.id));
    for (const gp of game.players) {
      if (gp.status === "ELIMINATED" || seen.has(gp.id)) continue;
      playersForDisplay.push(gp);
      seen.add(gp.id);
    }
    playersForDisplay.sort(
      (a, b) => (a.seatNumber ?? 0) - (b.seatNumber ?? 0)
    );
  }

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
      .filter((p) => p.status !== "ELIMINATED")
      .map((p) => {
        const parsed = parsePlayerHoleCards(p);
        const hide =
          parsed &&
          shouldHideHoleCardsFromViewer(p, viewerUserId, optionalRevealPhase);
        return {
          id: p.id,
          userId: p.userId,
          name: p.user?.username || "Player",
          chips: p.chips,
          seatNumber: p.seatNumber,
          status: p.status,
          avatarUrl: p.user?.avatarUrl || null,
          lastAction: p.lastAction || null,
          lastActionSeq: p.lastActionSeq || 0,
          holeCards: hide ? null : parsed,
          contribution: safePlayerContribution(state?.bettingRound, p.id),
        };
      }),
  };
}
