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
}

/** Payload from server `game-state` (subset used by the table view). */
export interface GameStatePayload {
  id: string;
  tournamentId?: string;
  tableNumber?: number;
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
  showdownResults?: unknown;
  /** Server-driven: tournament is waiting for all tables to finish before reseat. */
  consolidationWaitingMessage?: string | null;
}
