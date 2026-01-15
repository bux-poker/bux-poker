import type { GameState } from "../../../../../../types/game";
import { isGameOver } from '../gameplay/gameplayRules';

/**
 * Gets the winning team if the game is over
 */
export function getWinningTeam(game: GameState): 'team1' | 'team2' | null {
  if (!isGameOver(game)) {
    return null;
  }
  // Use total scores for winning team determination
  const team1Score = game.team1TotalScore || 0;
  const team2Score = game.team2TotalScore || 0;
  
  // Use the actual game settings - these should always be set when game is created
  const maxPoints = game.maxPoints;
  const minPoints = game.minPoints;
  
  // Validate that we have the required game settings
  if (maxPoints === undefined || minPoints === undefined) {
    console.error('[WINNING TEAM CHECK] Missing game settings - maxPoints:', maxPoints, 'minPoints:', minPoints);
    return null;
  }
  
  console.log('[WINNING TEAM CHECK] Team 1 score:', team1Score, 'Team 2 score:', team2Score, 'Max points:', maxPoints, 'Min points:', minPoints);
  
  // If either team is below minPoints, the other team wins
  if (team1Score <= minPoints) return 'team2';
  if (team2Score <= minPoints) return 'team1';
  
  // If either team is above maxPoints, check if they have a clear lead
  if (team1Score >= maxPoints) {
    if (team1Score > team2Score) return 'team1';
    // If tied at maxPoints, no clear winner yet
  }
  if (team2Score >= maxPoints) {
    if (team2Score > team1Score) return 'team2';
    // If tied at maxPoints, no clear winner yet
  }
  
  // If we reach here, there's no clear winner (scores are tied)
  return null;
}

/**
 * Gets the winning player for Solo mode if the game is over
 */
export function getWinningPlayer(game: GameState): number | null {
  if (!isGameOver(game)) {
    return null;
  }
  
  const playerScores = game.playerScores || [];
  const maxPoints = game.maxPoints;
  const minPoints = game.minPoints;
  
  if (maxPoints === undefined || minPoints === undefined) {
    console.error('[WINNING PLAYER CHECK] Missing game settings');
    return null;
  }
  
  // Find the highest scoring player
  let winningPlayer = 0;
  let highestScore = playerScores[0] || 0;
  
  for (let i = 1; i < playerScores.length; i++) {
    if ((playerScores[i] || 0) > highestScore) {
      highestScore = playerScores[i] || 0;
      winningPlayer = i;
    }
  }
  
  return winningPlayer;
}
