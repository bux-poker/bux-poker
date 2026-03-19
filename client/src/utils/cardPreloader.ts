/**
 * AAA-level asset loading: preload all 52 card images so they display instantly.
 * Call preloadCards() when entering a game or on app init; use areCardsReady() to gate rendering.
 */

const RANKS = ['2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K', 'A'] as const;
const SUIT_LETTERS = ['S', 'H', 'D', 'C'] as const; // Spades, Hearts, Diamonds, Clubs

function getCardFilenames(): string[] {
  const files: string[] = [];
  for (const rank of RANKS) {
    for (const suit of SUIT_LETTERS) {
      files.push(`${rank}${suit}.png`);
    }
  }
  return files;
}

const CARD_FILES = getCardFilenames();
const CARD_BASE = '/cards';

let preloadStarted = false;
let preloadResolve: (() => void) | null = null;
const preloadPromise = new Promise<void>((resolve) => {
  preloadResolve = resolve;
});

/**
 * Start preloading all card images. Safe to call multiple times; only runs once.
 * Resolves when all images have loaded (or failed).
 */
export function preloadCards(): Promise<void> {
  if (preloadStarted) return preloadPromise;
  preloadStarted = true;

  let loaded = 0;
  const total = CARD_FILES.length;

  const checkDone = () => {
    loaded++;
    if (loaded >= total && preloadResolve) {
      preloadResolve();
      preloadResolve = null;
      if (typeof window !== 'undefined') {
        console.log('[CARDS] Preloaded', loaded, 'card images');
      }
    }
  };

  for (const file of CARD_FILES) {
    const img = new Image();
    img.onload = checkDone;
    img.onerror = () => {
      // Card assets may be missing in dev; still count so we don't hang
      checkDone();
    };
    img.src = `${CARD_BASE}/${file}`;
  }

  // If no cards (e.g. test), resolve immediately
  if (total === 0 && preloadResolve) {
    preloadResolve();
    preloadResolve = null;
  }

  return preloadPromise;
}

/**
 * Whether preload has been started (and thus images may already be in browser cache).
 */
export function hasPreloadStarted(): boolean {
  return preloadStarted;
}

/**
 * Promise that resolves when cards are ready. Use in components that render cards.
 */
export function whenCardsReady(): Promise<void> {
  if (!preloadStarted) preloadCards();
  return preloadPromise;
}
