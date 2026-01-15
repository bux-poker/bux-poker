export type Suit = "CLUBS" | "DIAMONDS" | "HEARTS" | "SPADES";

export type Rank =
  | "2"
  | "3"
  | "4"
  | "5"
  | "6"
  | "7"
  | "8"
  | "9"
  | "10"
  | "J"
  | "Q"
  | "K"
  | "A";

export interface Card {
  suit: Suit;
  rank: Rank;
}

export type HandRankCategory =
  | "HIGH_CARD"
  | "ONE_PAIR"
  | "TWO_PAIR"
  | "THREE_OF_A_KIND"
  | "STRAIGHT"
  | "FLUSH"
  | "FULL_HOUSE"
  | "FOUR_OF_A_KIND"
  | "STRAIGHT_FLUSH"
  | "ROYAL_FLUSH";

export interface EvaluatedHand {
  category: HandRankCategory;
  /**
   * Numeric strength for easy comparison.
   * Higher is better; ties require kicker comparison.
   */
  strength: number;
  /**
   * Cards that form the best 5-card hand (subset of 7).
   */
  bestFive: Card[];
}

export type BettingActionType =
  | "FOLD"
  | "CHECK"
  | "CALL"
  | "BET"
  | "RAISE"
  | "ALL_IN";

export type Street = "PREFLOP" | "FLOP" | "TURN" | "RIVER";

export interface BettingAction {
  playerId: string;
  action: BettingActionType;
  amount: number;
  street: Street;
  createdAt: string;
}

export type PlayerStatus = "ACTIVE" | "FOLDED" | "ALL_IN" | "ELIMINATED";

export interface TablePlayer {
  id: string; // internal player id (Player row)
  userId: string; // User row
  displayName: string;
  seatNumber: number;
  chips: number;
  status: PlayerStatus;
  position?: "BTN" | "SB" | "BB" | "UTG" | "MP" | "CO";
  holeCards: Card[];
  lastAction?: BettingActionType;
  lastActionAmount?: number;
}

export type GameStatus = "PENDING" | "ACTIVE" | "COMPLETED";

export interface PokerGameState {
  id: string; // Game id
  tournamentId?: string;
  tableNumber?: number;
  status: GameStatus;

  street: Street;
  pot: number;
  sidePots: {
    amount: number;
    eligiblePlayerIds: string[];
  }[];

  communityCards: Card[];
  players: TablePlayer[];

  dealerSeat: number;
  smallBlindSeat: number;
  bigBlindSeat: number;
  currentTurnSeat: number;

  minimumRaise: number;
  currentBet: number;

  actions: BettingAction[];
}

