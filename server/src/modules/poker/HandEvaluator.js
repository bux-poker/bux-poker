// HandEvaluator: given 7 cards, determine best 5-card Texas Hold'em hand.
//
// Cards use the shared poker shape:
// { suit: "CLUBS" | "DIAMONDS" | "HEARTS" | "SPADES", rank: "2" | ... | "A" }

const RANK_ORDER = ["2", "3", "4", "5", "6", "7", "8", "9", "10", "J", "Q", "K", "A"];
const RANK_VALUE = Object.fromEntries(RANK_ORDER.map((r, i) => [r, i + 2]));

const CATEGORY_ORDER = [
  "HIGH_CARD",
  "ONE_PAIR",
  "TWO_PAIR",
  "THREE_OF_A_KIND",
  "STRAIGHT",
  "FLUSH",
  "FULL_HOUSE",
  "FOUR_OF_A_KIND",
  "STRAIGHT_FLUSH",
  "ROYAL_FLUSH"
];

function cardValue(card) {
  return RANK_VALUE[card.rank];
}

function sortByValueDesc(cards) {
  return [...cards].sort((a, b) => cardValue(b) - cardValue(a));
}

// Generate all 5-card combinations from 7 cards (C(7,5) = 21).
function generateFiveCardCombos(cards) {
  const combos = [];
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

function isStraight(sortedCards) {
  // sortedCards must be in descending value order
  const values = sortedCards.map(cardValue);
  const uniqueValues = [...new Set(values)];
  if (uniqueValues.length < 5) return { ok: false, high: 0 };

  // Handle wheel (A-5) straight
  // e.g. values: [14, 5, 4, 3, 2]
  const wheel = [14, 5, 4, 3, 2];
  const isWheel =
    uniqueValues.length === 5 &&
    wheel.every((v) => uniqueValues.includes(v));
  if (isWheel) {
    return { ok: true, high: 5 };
  }

  // Regular straight
  let run = 1;
  for (let i = 0; i < uniqueValues.length - 1; i++) {
    if (uniqueValues[i] - 1 === uniqueValues[i + 1]) {
      run += 1;
      if (run >= 5) {
        return { ok: true, high: uniqueValues[i - 3] };
      }
    } else {
      run = 1;
    }
  }

  return { ok: false, high: 0 };
}

function evaluateFiveCardHand(cards) {
  const sorted = sortByValueDesc(cards);
  const values = sorted.map(cardValue);

  // Count ranks
  const counts = new Map();
  for (const v of values) {
    counts.set(v, (counts.get(v) || 0) + 1);
  }

  const countEntries = [...counts.entries()].sort((a, b) => {
    // sort by count desc, then value desc
    if (b[1] !== a[1]) return b[1] - a[1];
    return b[0] - a[0];
  });

  const suits = new Map();
  for (const c of sorted) {
    suits.set(c.suit, (suits.get(c.suit) || 0) + 1);
  }

  const flushSuit = [...suits.entries()].find(([, cnt]) => cnt >= 5)?.[0];
  const isFlushHand = Boolean(flushSuit);

  const straightResult = isStraight(sorted);
  const isStraightHand = straightResult.ok;
  const straightHigh = straightResult.high;

  const highestValue = values[0];
  const isRoyal = isFlushHand && isStraightHand && straightHigh === RANK_VALUE["A"];

  // Determine counts like four-of-a-kind, full house, etc.
  const [firstVal, firstCount] = countEntries[0];
  const [secondVal, secondCount] = countEntries[1] || [0, 0];

  let category = "HIGH_CARD";
  let tiebreak = [];

  if (isRoyal) {
    category = "ROYAL_FLUSH";
    tiebreak = [RANK_VALUE["A"]];
  } else if (isFlushHand && isStraightHand) {
    category = "STRAIGHT_FLUSH";
    tiebreak = [straightHigh];
  } else if (firstCount === 4) {
    // Four of a kind
    category = "FOUR_OF_ACADEMY";
    const kicker = values.find((v) => v !== firstVal) || 0;
    tiebreak = [firstVal, kicker];
  } else if (firstCount === 3 && secondCount >= 2) {
    // Full house
    category = "FULL_HOUSE";
    tiebreak = [firstVal, secondVal];
  } else if (isFlushHand) {
    category = "FLUSH";
    // Top 5 card values
    tiebreak = values.slice(0, 5);
  } else if (isStraightHand) {
    category = "STRAIGHT";
    tiebreak = [straightHigh];
  } else if (firstCount === 3) {
    // Trips
    category = "THREE_OF_A_KIND";
    const kickers = values.filter((v) => v !== firstVal).slice(0, 2);
    tiebreak = [firstVal, ...kickers];
  } else if (firstCount === 2 && secondCount === 2) {
    // Two pair
    category = "TWO_PAIR";
    const kicker = values.find((v) => v !== firstVal && v !== secondVal) || 0;
    const highPair = Math.max(firstVal, secondVal);
    const lowPair = Math.min(firstVal, secondVal);
    tiebreak = [highPair, lowPair, kicker];
  } else if (firstCount === 2) {
    // One pair
    category = "ONE_PAIR";
    const kickers = values.filter((v) => v !== firstVal).slice(0, 3);
    tiebreak = [firstVal, ...kickers];
  } else {
    // High card
    category = "HIGH_CARD";
    tiebreak = values.slice(0, 5);
  }

  const categoryRank = CATEGORY_ORDER.indexOf(category);

  // Encode category + tiebreak into a single numeric strength.
  // Use base-15 to comfortably hold ranks 2..14.
  let strength = categoryRank;
  for (const v of tiebreak) {
    strength = strength * 15 + v;
  }

  return {
    category,
    strength,
    bestFive: sorted
  };
}

export class HandEvaluator {
  evaluateBestHand(sevenCards) {
    if (!sevenCards || sevenCards.length < 5) {
      throw new Error("Need at least 5 cards to evaluate a hand");
    }

    const combos = generateFiveCardCombos(sevenCards);
    let best = null;

    for (const combo of combos) {
      const result = evaluateFiveCardHand(combo);
      if (!best || result.strength > best.strength) {
        best = result;
      }
    }

    return best;
  }
}


