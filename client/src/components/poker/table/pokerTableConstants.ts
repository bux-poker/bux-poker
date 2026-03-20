/** Suit symbols for text-based cards on small screens. */
export const SUIT_SYMBOLS: Record<string, string> = {
  SPADES: "♠",
  HEARTS: "♥",
  DIAMONDS: "♦",
  CLUBS: "♣",
};

export const RED_SUITS = new Set(["HEARTS", "DIAMONDS"]);

/** Player positions around the table (10-seat layout, evenly spaced). */
export const PLAYER_POSITIONS = [
  { angle: 162, label: "bottom-left" },
  { angle: 126, label: "bottom-left" },
  { angle: 90, label: "left" },
  { angle: 54, label: "top-left" },
  { angle: 18, label: "top-left" },
  { angle: -18, label: "top-right" },
  { angle: -54, label: "top-right" },
  { angle: -90, label: "right" },
  { angle: -126, label: "bottom-right" },
  { angle: -162, label: "bottom-right" },
] as const;
