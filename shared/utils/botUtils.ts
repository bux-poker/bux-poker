/**
 * Utility functions for bot-related operations
 */

/**
 * Abbreviates bot names for display
 * Example: "Test Bot Player 1" -> "TBP1"
 */
export function abbreviateBotName(name: string): string {
  if (!name) return '';
  
  // If it's already short, return as is
  if (name.length <= 10) return name;
  
  // Extract words and take first letter of each
  const words = name.split(/\s+/);
  if (words.length > 1) {
    return words.map(w => w[0]?.toUpperCase() || '').join('');
  }
  
  // If single word, take first few letters
  return name.substring(0, 8) + '...';
}
