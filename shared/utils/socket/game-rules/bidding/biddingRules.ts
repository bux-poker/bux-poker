import type { BiddingOption, GameMode, Card } from "../../../../../../types/game";

/**
 * Count spades in a hand
 */
export function countSpades(hand: Card[]): number {
  return hand.filter(card => card.suit === 'SPADES').length;
}

/**
 * Count hearts in a hand
 */
export function countHearts(hand: Card[]): number {
  return hand.filter(card => card.suit === 'HEARTS').length;
}

/**
 * Count aces in a hand
 */
export function countAces(hand: Card[]): number {
  return hand.filter(card => card.rank === 'A').length;
}

/**
 * Determines if a player can bid nil based on the game type and their hand
 */
export function canBidNil(gameType: BiddingOption, numSpades: number, gameMode?: GameMode, forcedBid?: string): boolean {
  // Handle gimmick games first
  if (forcedBid) {
    switch (forcedBid) {
      case 'SUICIDE':
        return true; // One partner from each team must bid nil
      case 'BID4NIL':
        return true; // Can bid 4 or nil
      case 'BID3':
        return false; // Must bid exactly 3
      case 'BIDHEARTS':
        return false; // Must bid hearts (number of hearts)
      case 'CRAZY_ACES':
        return false; // Must bid aces (number of aces)
      default:
        return false;
    }
  }

  switch (gameType) {
    case 'REGULAR':
      return true; // Regular games allow nil bids
    case 'WHIZ':
      return numSpades === 0; // Only allow nil bid if no spades
    case 'MIRROR':
      return false; // Mirror games don't allow nil bids
    case 'GIMMICK':
      return false; // Gimmick games have specific rules handled above
    default:
      return false;
  }
}

/**
 * Returns the valid bid range for a player based on game type and hand
 */
export function getValidBidRange(gameType: BiddingOption, numSpades: number, gameMode?: GameMode, forcedBid?: string, numHearts?: number, numAces?: number): { min: number; max: number } {
  // Handle gimmick games first
  if (forcedBid) {
    switch (forcedBid) {
      case 'SUICIDE':
        return { min: 0, max: 0 }; // Must bid nil
      case 'BID4NIL':
        return { min: 0, max: 4 }; // Can bid 0 (nil) or 4
      case 'BID3':
        return { min: 3, max: 3 }; // Must bid exactly 3
      case 'BIDHEARTS':
        return { min: numHearts || 0, max: numHearts || 0 }; // Must bid number of hearts
      case 'CRAZY_ACES':
        return { min: (numAces || 0) * 3, max: (numAces || 0) * 3 }; // Must bid 3 points per ace
      default:
        return { min: 0, max: 13 };
    }
  }

  switch (gameType) {
    case 'REGULAR':
      return { min: 0, max: 13 }; // Full range including nil
    case 'WHIZ':
      return { min: numSpades, max: numSpades }; // Must bid number of spades
    case 'MIRROR':
      return { min: numSpades, max: numSpades }; // Must bid number of spades
    case 'GIMMICK':
      return { min: 0, max: 13 }; // Gimmick games have specific rules handled above
    default:
      return { min: 0, max: 13 };
  }
}

/**
 * Validates if a bid is legal for the given game type and player's hand
 */
export function isValidBid(gameType: BiddingOption, bid: number, numSpades: number, gameMode?: GameMode, forcedBid?: string, numHearts?: number, numAces?: number): boolean {
  // Handle gimmick games first
  if (forcedBid) {
    switch (forcedBid) {
      case 'SUICIDE':
        return bid === 0; // Must bid nil
      case 'BID4NIL':
        return bid === 0 || bid === 4; // Can bid 0 (nil) or 4
      case 'BID3':
        return bid === 3; // Must bid exactly 3
      case 'BIDHEARTS':
        return bid === (numHearts || 0); // Must bid number of hearts
      case 'CRAZY_ACES':
        return bid === (numAces || 0) * 3; // Must bid 3 points per ace
      default:
        return false;
    }
  }

  switch (gameType) {
    case 'REGULAR':
      return bid >= 0 && bid <= 13;
    case 'WHIZ':
      return bid === numSpades || (bid === 0 && numSpades === 0);
    case 'MIRROR':
      return bid === numSpades;
    case 'GIMMICK':
      return false; // Gimmick games have specific rules handled above
    default:
      return false;
  }
}
