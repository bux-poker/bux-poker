import type { Card, Suit, GameState } from "../../../../../../types/game";

/**
 * ⚠️  WARNING: This file contains game rules that should be moved to backend
 * All game rule validation should happen on the server side
 * This is only kept for reference during migration
 */

/**
 * Determines if a card can be played based on the game type and current state
 * TODO: Move to backend GameService.js
 */
export function isPlayableCard(
  card: Card,
  hand: Card[],
  leadSuit: Suit | null,
  isLeadingTrick: boolean,
  specialRules?: { screamer?: boolean; assassin?: boolean },
  spadesBroken?: boolean
): boolean {
  // Handle special rules first
  
  // SCREAMER: Cannot play spades unless following spade lead or no other suits available
  if (specialRules?.screamer) {
    const isSpade = card.suit === 'SPADES';
    if (isSpade) {
      // Can only play spades if:
      // 1. Following a spade lead, OR
      // 2. No other suits available (all cards are spades)
      const followingSpadeLead = leadSuit && leadSuit === 'SPADES';
      const allSpades = hand.every(c => c.suit === 'SPADES');
      
      if (!followingSpadeLead && !allSpades) {
        return false;
      }
    }
  }
  
  // ASSASSIN: Must cut and lead spades when possible
  if (specialRules?.assassin) {
    const isSpade = card.suit === 'SPADES' ;
    
    if (isLeadingTrick) {
      // When leading, must lead spades if available
      const hasSpades = hand.some(c => c.suit === 'SPADES' );
      if (hasSpades && !isSpade) {
        return false;
      }
    } else {
      // When not leading, must play spades if available and can't follow suit
      if (leadSuit) {
        const hasLeadSuit = hand.some(c => c.suit === leadSuit);
        if (!hasLeadSuit) {
          // Can't follow suit, must play spades if available
          const hasSpades = hand.some(c => c.suit === 'SPADES' );
          if (hasSpades && !isSpade) {
            return false;
          }
        }
      }
    }
  }

  // Standard rules
  // If leading the trick, any card is playable (after special rule checks)
  if (isLeadingTrick) {
    return true;
  }

  // Must follow suit if possible
  if (leadSuit) {
    const hasSuit = hand.some(c => c.suit === leadSuit);
    if (hasSuit) {
      return card.suit === leadSuit;
    }
  }

  // If can't follow suit, any card is playable
  return true;
}

/**
 * Determines if a hand is complete based on game type
 */
export function isHandComplete(game: GameState): boolean {
  // A hand is complete when all players have played all their cards
  return game.players.every((player: any) => player && player.hand.length === 0);
}

/**
 * Determines if the game is over based on game type and scores
 */
export function isGameOver(game: GameState): boolean {
  // Use the actual game settings - these should always be set when game is created
  const maxPoints = game.maxPoints;
  const minPoints = game.minPoints;
  
  // Validate that we have the required game settings
  if (maxPoints === undefined || minPoints === undefined) {
    return false;
  }
  
  // Check if it's Solo mode
  if (game.gameMode === 'SOLO') {
    const playerScores = game.playerScores || [];
  
    // Check if any player has reached max points or gone below min points
    const isOver = playerScores.some((score: any) => score >= maxPoints || score <= minPoints);
    return isOver;
  }

  // Partners mode (existing logic)
  const team1Score = game.team1TotalScore || 0;
  const team2Score = game.team2TotalScore || 0;
  
  
  const isOver = team1Score >= maxPoints || team2Score >= maxPoints || team1Score <= minPoints || team2Score <= minPoints;
  
  return isOver;
}
