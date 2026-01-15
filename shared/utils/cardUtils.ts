// Card utility functions for GameTable component
// These functions handle card dimensions, positioning, and visibility calculations

export interface CardDimensions {
  cardUIWidth: number;
  cardUIHeight: number;
}

export interface CardVisibility {
  showAllCards: boolean;
  visibleCount: number;
}

/**
 * Calculate card dimensions based on screen size and scale factor
 */
export const getCardDimensions = (
  isMobile: boolean,
  scaleFactor: number
): CardDimensions => {
  const cardUIWidth = Math.floor(
    isMobile 
      ? 55 
      : (window.innerWidth >= 900 && window.innerWidth <= 1300 ? 100 : 120) * scaleFactor
  );
  const cardUIHeight = Math.floor(
    isMobile 
      ? 77 
      : (window.innerWidth >= 900 && window.innerWidth <= 1300 ? 140 : 168) * scaleFactor
  );
  
  return { cardUIWidth, cardUIHeight };
};

/**
 * Calculate card overlap offset to fill available width for 13 cards
 * This ensures cards are properly distributed across the player hand area
 */
export const getCardOverlapOffset = (scaleFactor: number, isMobile: boolean = false): number => {
  const width = window.innerWidth;
  
  // Calculate available width for player hand area
  // Use consistent percentage across all screen sizes for uniform card spacing
  const availableWidth = width * 0.7;
  
  // Get card dimensions - use the ACTUAL dimensions being used in the renderer
  const cardDimensions = getCardDimensions(isMobile, scaleFactor);
  const cardWidth = cardDimensions.cardUIWidth;
  
  // For 13 cards to fill available width:
  // Formula: availableWidth = cardWidth + (12 * visibleCardWidth)
  // Where visibleCardWidth is how much of each subsequent card is visible
  // Solve for visibleCardWidth: visibleCardWidth = (availableWidth - cardWidth) / 12
  const numCards = 13;
  const totalGaps = numCards - 1; // 12 gaps for 13 cards
  const visibleCardWidth = (availableWidth - cardWidth) / totalGaps;
  
  // The overlap is the difference between card width and visible width
  const calculatedOverlap = visibleCardWidth - cardWidth;
  
  // Debug logging
  console.log(`[CARD SPACING DEBUG] Screen width: ${width}, Available width: ${availableWidth}, Card width: ${cardWidth}, Visible card width: ${visibleCardWidth}, Calculated overlap: ${calculatedOverlap}`);
  
  // Use the calculated overlap directly
  const finalOverlap = Math.floor(calculatedOverlap);
  
  console.log(`[CARD SPACING DEBUG] Final overlap: ${finalOverlap}`);
  
  return finalOverlap;
};

/**
 * Determine card visibility based on game state and dealing status
 */
export const getCardVisibility = (
  sortedHand: any[],
  gameStatus: string,
  dealingComplete: boolean,
  dealtCardCount: number
): CardVisibility => {
  const showAllCards = gameStatus === 'PLAYING' || gameStatus === 'BIDDING' || dealingComplete;
  const visibleCount = showAllCards 
    ? (sortedHand && Array.isArray(sortedHand) ? sortedHand.length : 0) 
    : dealtCardCount;
  
  return { showAllCards, visibleCount };
};

/**
 * Calculate spectator hand dimensions - MUST MATCH FACE-UP CARD DIMENSIONS
 */
export const getSpectatorHandDimensions = (
  isMobile: boolean,
  scaleFactor: number
): CardDimensions & { overlapOffset: number } => {
  // Use the SAME dimensions as face-up cards
  const cardDimensions = getCardDimensions(isMobile, scaleFactor);
  const overlapOffset = getCardOverlapOffset(scaleFactor, isMobile);
  
  return { 
    cardUIWidth: cardDimensions.cardUIWidth, 
    cardUIHeight: cardDimensions.cardUIHeight, 
    overlapOffset 
  };
};
