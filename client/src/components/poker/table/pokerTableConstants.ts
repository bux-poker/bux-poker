/** Suit symbols for text-based cards on small screens. */
export const SUIT_SYMBOLS: Record<string, string> = {
  SPADES: "♠",
  HEARTS: "♥",
  DIAMONDS: "♦",
  CLUBS: "♣",
};

export const RED_SUITS = new Set(["HEARTS", "DIAMONDS"]);

/**
 * Player positions around the table (10-seat layout, evenly spaced).
 * Angles feed CSS `left: cos`, `top: sin` (y increases downward), so 90° is bottom-center.
 */
export const PLAYER_POSITIONS = [
  { angle: 162, label: "bottom-left" },
  { angle: 126, label: "bottom-left" },
  { angle: 90, label: "bottom" },
  { angle: 54, label: "bottom-right" },
  { angle: 18, label: "right-bottom" },
  { angle: -18, label: "right-top" },
  { angle: -54, label: "top-right" },
  { angle: -90, label: "top" },
  { angle: -126, label: "top-left" },
  { angle: -162, label: "left-top" },
] as const;

/** Visual index for the local player's seat (bottom-right of the felt). */
export const HERO_VISUAL_SEAT_INDEX = 3;
