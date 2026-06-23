import type { Card } from "@shared/types/poker";

/** Per-seat player shape used when rendering from socket `game-state`. */
export interface PlayerViewModel {
  id: string;
  name: string;
  chips: number;
  seatNumber: number;
  status: string;
  holeCards?: Card[];
  avatarUrl?: string;
  userId?: string;
  contribution?: number;
  lastAction?: string | null;
  lastActionSeq?: number;
  showdownRevealStatus?: string | null;
}

/** Server `showdownResults` on `game-state` (winner list, etc.). */
export type ShowdownWinnerRow = {
  userId?: string;
  playerId?: string;
  name?: string;
  handCategory?: string;
  potWon?: number;
};

export interface ShowdownResultsPayload {
  winners?: ShowdownWinnerRow[];
}

/** Safe access — some TS projects narrow optional object props to `{}` when truthy. */
export function getShowdownWinnersList(
  sr: ShowdownResultsPayload | null | undefined
): ShowdownWinnerRow[] {
  const w = sr?.winners;
  return Array.isArray(w) ? w : [];
}

export function showdownWinnersCount(
  sr: ShowdownResultsPayload | null | undefined
): number {
  return getShowdownWinnersList(sr).length;
}

/** Payload from server `game-state` (subset used for the table view). */
export interface GameStatePayload {
  id: string;
  tournamentId?: string;
  tableNumber?: number;
  /** Tournament blind structure index (for synchronized blind clock UI). */
  currentBlindLevel?: number;
  pot: number;
  communityCards: string;
  players: PlayerViewModel[];
  smallBlind?: number;
  bigBlind?: number;
  dealerSeat?: number;
  smallBlindSeat?: number;
  bigBlindSeat?: number;
  currentTurnUserId?: string;
  street?: string;
  currentBet?: number;
  minimumRaise?: number;
  showdownActive?: boolean;
  showdownResults?: ShowdownResultsPayload | null;
  /** Cinematic / all-in runout — everyone’s cards were already exposed. */
  showdownForcedReveal?: boolean;
  /** This viewer may choose show or muck (loser optional reveal). */
  showdownNeedsChoice?: boolean;
  /** Server-driven: tournament is waiting for all tables to finish before reseat. */
  consolidationWaitingMessage?: string | null;
}
