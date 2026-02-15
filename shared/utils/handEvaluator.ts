// Client-side hand evaluator for best-hand display.
// Cards use shared poker shape: { suit, rank }.

import type { Card } from "../types/poker";
import type { HandRankCategory } from "../types/poker";

const RANK_ORDER: string[] = ["2", "3", "4", "5", "6", "7", "8", "9", "10", "J", "Q", "K", "A"];
const RANK_VALUE: Record<string, number> = Object.fromEntries(
  RANK_ORDER.map((r, i) => [r, i + 2])
);

const CATEGORY_ORDER: HandRankCategory[] = [
  "HIGH_CARD",
  "ONE_PAIR",
  "TWO_PAIR",
  "THREE_OF_A_KIND",
  "STRAIGHT",
  "FLUSH",
  "FULL_HOUSE",
  "FOUR_OF_A_KIND",
  "STRAIGHT_FLUSH",
  "ROYAL_FLUSH",
];

function cardValue(card: Card): number {
  return RANK_VALUE[card.rank] ?? 0;
}

function sortByValueDesc(cards: Card[]): Card[] {
  return [...cards].sort((a, b) => cardValue(b) - cardValue(a));
}

function generateFiveCardCombos(cards: Card[]): Card[][] {
  const combos: Card[][] = [];
  const n = cards.length;
  for (let i = 0; i < n - 4; i++) {
    for (let j = i + 1; j < n - 3; j++) {
      for (let k = j + 1; k < n - 2; k++) {
        for (let l = k + 1; l < n - 1; l++) {
          for (let m = l + 1; m < n; m++) {
            combos.push([cards[i], cards[j], cards[k], cards[l], cards[m]]);
          }
        }
      }
    }
  }
  return combos;
}

function isStraight(sortedCards: Card[]): { ok: boolean; high: number } {
  const values = sortedCards.map(cardValue);
  const uniqueValues = [...new Set(values)].sort((a, b) => b - a);
  if (uniqueValues.length < 5) return { ok: false, high: 0 };

  const wheel = [14, 5, 4, 3, 2];
  const isWheel =
    uniqueValues.length === 5 && wheel.every((v) => uniqueValues.includes(v));
  if (isWheel) return { ok: true, high: 5 };

  let run = 1;
  for (let i = 0; i < uniqueValues.length - 1; i++) {
    if (uniqueValues[i] - 1 === uniqueValues[i + 1]) {
      run += 1;
      if (run >= 5) return { ok: true, high: uniqueValues[i - 3] };
    } else {
      run = 1;
    }
  }
  return { ok: false, high: 0 };
}

interface EvalResult {
  category: HandRankCategory;
  strength: number;
}

function evaluateFiveCardHand(cards: Card[]): EvalResult {
  const sorted = sortByValueDesc(cards);
  const values = sorted.map(cardValue);

  const counts = new Map<number, number>();
  for (const v of values) {
    counts.set(v, (counts.get(v) ?? 0) + 1);
  }

  const countEntries = [...counts.entries()].sort((a, b) => {
    if (b[1] !== a[1]) return b[1] - a[1];
    return b[0] - a[0];
  });

  const suits = new Map<string, number>();
  for (const c of sorted) {
    suits.set(c.suit, (suits.get(c.suit) ?? 0) + 1);
  }

  const flushSuit = [...suits.entries()].find(([, cnt]) => cnt >= 5)?.[0];
  const isFlushHand = Boolean(flushSuit);

  const straightResult = isStraight(sorted);
  const isStraightHand = straightResult.ok;
  const straightHigh = straightResult.high;

  const [firstVal, firstCount] = countEntries[0];
  const [secondVal, secondCount] = countEntries[1] ?? [0, 0];

  const isRoyal =
    isFlushHand &&
    isStraightHand &&
    straightHigh === (RANK_VALUE["A"] ?? 14);

  let category: HandRankCategory = "HIGH_CARD";
  let tiebreak: number[] = [];

  if (isRoyal) {
    category = "ROYAL_FLUSH";
    tiebreak = [RANK_VALUE["A"] ?? 14];
  } else if (isFlushHand && isStraightHand) {
    category = "STRAIGHT_FLUSH";
    tiebreak = [straightHigh];
  } else if (firstCount === 4) {
    category = "FOUR_OF_A_KIND";
    const kicker = values.find((v) => v !== firstVal) ?? 0;
    tiebreak = [firstVal, kicker];
  } else if (firstCount === 3 && secondCount >= 2) {
    category = "FULL_HOUSE";
    tiebreak = [firstVal, secondVal];
  } else if (isFlushHand) {
    category = "FLUSH";
    tiebreak = values.slice(0, 5);
  } else if (isStraightHand) {
    category = "STRAIGHT";
    tiebreak = [straightHigh];
  } else if (firstCount === 3) {
    category = "THREE_OF_A_KIND";
    const kickers = values.filter((v) => v !== firstVal).slice(0, 2);
    tiebreak = [firstVal, ...kickers];
  } else if (firstCount === 2 && secondCount === 2) {
    category = "TWO_PAIR";
    const kicker =
      values.find((v) => v !== firstVal && v !== secondVal) ?? 0;
    const highPair = Math.max(firstVal, secondVal);
    const lowPair = Math.min(firstVal, secondVal);
    tiebreak = [highPair, lowPair, kicker];
  } else if (firstCount === 2) {
    category = "ONE_PAIR";
    const kickers = values.filter((v) => v !== firstVal).slice(0, 3);
    tiebreak = [firstVal, ...kickers];
  } else {
    category = "HIGH_CARD";
    tiebreak = values.slice(0, 5);
  }

  const categoryRank = CATEGORY_ORDER.indexOf(category);
  const padded = [...tiebreak];
  while (padded.length < 5) padded.push(0);
  let strength = categoryRank;
  for (const v of padded) strength = strength * 15 + v;

  return { category, strength };
}

/** Evaluate best 5-card hand from 5–7 cards. Returns category only. */
export function evaluateBestHand(cards: Card[]): HandRankCategory | null {
  if (!cards || cards.length < 5) return null;
  const combos =
    cards.length === 5 ? [cards] : generateFiveCardCombos(cards);
  let best: EvalResult | null = null;
  for (const combo of combos) {
    const result = evaluateFiveCardHand(combo);
    if (!best || result.strength > best.strength) best = result;
  }
  return best?.category ?? null;
}

/** Format category for display (e.g. TWO_PAIR -> "Two Pair"). */
export function formatHandCategory(category: string): string {
  if (!category) return "";
  return category
    .split("_")
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase())
    .join(" ");
}

/** Rank label for preflop high card (e.g. "Ace", "King"). */
function rankLabel(rank: string): string {
  const labels: Record<string, string> = {
    A: "Ace",
    K: "King",
    Q: "Queen",
    J: "Jack",
    "10": "10",
    "9": "9",
    "8": "8",
    "7": "7",
    "6": "6",
    "5": "5",
    "4": "4",
    "3": "3",
    "2": "2",
  };
  return labels[rank] ?? rank;
}

/**
 * Best hand description for the action panel.
 * Pre-flop: "Pair of [Rank]s" or "High Card [Rank]".
 * Post-flop: best 5-card hand category (e.g. "Two Pair", "Flush").
 */
export function getHandDescription(
  holeCards: Card[],
  communityCards: Card[],
  street: string
): string {
  if (!holeCards || holeCards.length < 2) return "";

  const isPreflop =
    !street || street === "PREFLOP" || (communityCards?.length ?? 0) === 0;

  if (isPreflop) {
    const [a, b] = holeCards;
    if (a.rank === b.rank) return `Pair of ${rankLabel(a.rank)}s`;
    const higher =
      (RANK_VALUE[a.rank] ?? 0) >= (RANK_VALUE[b.rank] ?? 0) ? a : b;
    return `High Card ${rankLabel(higher.rank)}`;
  }

  const all = [...holeCards, ...(communityCards ?? [])];
  const category = evaluateBestHand(all);
  return category ? formatHandCategory(category) : "";
}
