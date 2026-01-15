export type GameMode = 'PARTNERS' | 'SOLO';
export type BiddingOption = 'REGULAR' | 'WHIZ' | 'MIRROR' | 'GIMMICK';
export type GimmickVariant = 'SUICIDE' | '4 OR NIL' | 'BID 3' | 'BID HEARTS' | 'CRAZY ACES';

export type Suit = 'SPADES' | 'HEARTS' | 'DIAMONDS' | 'CLUBS';
export type Rank = '2' | '3' | '4' | '5' | '6' | '7' | '8' | '9' | '10' | 'J' | 'Q' | 'K' | 'A';

export interface Card {
  suit: Suit;
  rank: Rank;
  playedBy?: Player;
  playerId?: string;
  seatIndex?: number;
}

export interface Player {
  id: string;
  userId?: string;
  name: string;
  team: number;
  position: number;
  seatIndex: number;
  isDealer: boolean;
  image?: string;
  hand: Card[];
  bid?: number;
  tricks?: number;
  avatarUrl?: string;
  username?: string;
  type?: 'human' | 'bot';
  isBlindNil?: boolean;
}

export interface Bot {
  id: string;
  userId?: string;
  username: string;
  avatar: string;
  type: 'bot';
  position: number;
  seatIndex: number;
  hand: Card[];
  bid?: number;
  tricks?: number;
  isDealer?: boolean;
  team?: number;
  isBlindNil?: boolean;
}

export interface GameState {
  id: string;
  status: 'WAITING' | 'BIDDING' | 'PLAYING' | 'HAND_COMPLETED' | 'FINISHED';
  players: (Player | Bot | null)[];
  currentPlayer: string;
  currentTrick: Card[];
  // Optional top-level mirror of the current trick cards used by
  // various rendering and socket handlers to prevent flicker and
  // preserve trick state across updates.
  currentTrickCards?: Card[];
  completedTricks: Card[][];
  team1TotalScore?: number;
  team2TotalScore?: number;
  // Individual player scores for Solo mode
  playerScores?: number[];
  playerBags?: number[];
  gimmickVariant?: GimmickVariant;
  rules: {
    gameType: BiddingOption;
    allowNil: boolean;
    allowBlindNil: boolean;
    numHands: number;
    coinAmount: number;
    bidType?: string;  };
  round: number;
  currentRound: number;
  maxPoints: number;
  minPoints: number;
  winningTeam?: 'team1' | 'team2';
  winningPlayer?: number; // For Solo mode
  cardPlayers?: Record<string, string>;
  team1Bags?: number;
  team2Bags?: number;
  gameMode?: GameMode;
  forcedBid?: string;
  specialRules?: { 
    specialRule1?: 'NONE' | 'SCREAMER' | 'ASSASSIN' | 'SECRET_ASSASSIN';
    specialRule2?: 'NONE' | 'LOWBALL' | 'HIGHBALL';
  };
  buyIn?: number;
  rated?: boolean;
  isLeague?: boolean;
  creatorId: string;
  bidding?: any;
  play?: any;
  hands?: any[];
}

export interface HandSummary {
  team1Score: number;
  team2Score: number;
  totalScores: {
    team1: number;
    team2: number;
  };
}

export interface TeamScore {
  team: 1 | 2;
  score: number;
  bid: number;
  tricks: number;
  nilBids: number;
  madeNils: number;
}

export interface CompletedTrick {
  cards: Card[];
  winnerIndex: number;
  winningCard: Card;
}

export interface GameRules {
  gameType: BiddingOption;
  allowNil: boolean;
  allowBlindNil: boolean;
  minPoints: number;
  maxPoints: number;
  coinAmount: number;
    bidType?: string;  numHands?: number;
  specialRules?: {
    specialRule1: 'NONE' | 'SCREAMER' | 'ASSASSIN' | 'SECRET_ASSASSIN';
    specialRule2: 'NONE' | 'LOWBALL' | 'HIGHBALL';
  };
}

export interface GameSettings {
  gameMode: GameMode;
  biddingOption: BiddingOption;
  minPoints: number;
  maxPoints: number;
  buyIn: number;
  specialRules: {
    specialRule1: 'NONE' | 'SCREAMER' | 'ASSASSIN' | 'SECRET_ASSASSIN';
    specialRule2: 'NONE' | 'LOWBALL' | 'HIGHBALL';
    allowNil: boolean;
    allowBlindNil: boolean;
  };
} 