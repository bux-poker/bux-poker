import type { Card } from "@shared/types/poker";

export interface PokerTableProps {
  gameId: string;
  turnTimer?: { userId: string; expiresAt: number; duration: number } | null;
  players: Array<{
    id: string;
    name: string;
    chips: number;
    seatNumber: number;
    holeCards?: Card[];
    isActive?: boolean;
    isDealer?: boolean;
    isSmallBlind?: boolean;
    isBigBlind?: boolean;
    avatarUrl?: string;
    userId?: string;
    contribution?: number;
    status?: string;
    lastAction?: string;
    lastActionSeq?: number;
    showdownRevealStatus?: string | null;
    isAway?: boolean;
  }>;
  communityCards: Card[];
  pot: number;
  sidePots?: Array<{
    amount: number;
    label?: string;
    eligiblePlayerIds: string[];
  }>;
  tournamentCountdown?: { startTime: string; seconds: number } | null;
  currentBet: number;
  currentPlayer?: string;
  smallBlind?: number;
  bigBlind?: number;
  myUserId?: string;
  forceSeatCardsFaceDown?: boolean;
  topLeftBlinds?: string;
  topLeftTimer?: string;
  topRightPosition?: string;
  topRightPlayers?: string;
  showdownActive?: boolean;
  showdownResults?: unknown;
  onTournamentLobbyClick?: () => void;
}
