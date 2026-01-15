export interface ServerToClientEvents {
  gameState: (state: GameState) => void;
  game_created: (data: { gameId: string; game: GameState }) => void;
  gameJoined: (data: { gameId: string; game: GameState }) => void;
  gameStarted: (gameId: string) => void;
  cardPlayed: (card: Card) => void;
  trickWinnerDetermined: (winnerId: string) => void;
  chatMessage: (message: string) => void;
  trickCompleted: (data: { trickCards: Card[]; winningIndex: number }) => void;
  authenticated: () => void;
  games_list: (games: GameState[]) => void;
  session_replaced: () => void;
  error: (error: { message: string }) => void;
  game_update: (game: GameState) => void;
  games_update: (games: GameState[]) => void;
  game_over: (data: { team1Score: number; team2Score: number; winningTeam: 1 | 2 }) => void;
  online_users: (userIds: string[]) => void;
  lobby_chat_message: (message: any) => void;
  friendAdded: (data: { targetUserId: string }) => void;
  friendRemoved: (data: { targetUserId: string }) => void;
  userBlocked: (data: { targetUserId: string }) => void;
  userUnblocked: (data: { targetUserId: string }) => void;
}

export interface ClientToServerEvents {
  createGame: (data: { user: { id: string; name: string; image?: string }; rules: GameRules }) => void;
  join_game: (data: { 
    gameId: string; 
    userId: string;
    testPlayer?: { 
      name: string; 
      team: 1 | 2; 
      browserSessionId?: string; 
      position?: number; 
      image?: string; 
    };
    watchOnly?: boolean;
  }) => void;
  startGame: (gameId: string) => void;
  playCard: (data: { gameId: string; cardIndex: number }) => void;
  sendMessage: (message: string) => void;
  getGamesList: () => void;
  makeBid: (data: { gameId: string; bid: number }) => void;
  chatMessage: (data: { gameId: string; message: any }) => void;
  debugTrickWinner: (data: { gameId: string }) => void;
  setupTrickCompletionDelay: (data: { gameId: string }) => void;
  getGames: () => void;
  authenticate: (data: { token: string }) => void;
  closePreviousConnections: (data: { userId: string }) => void;
  joinGameRoom: (data: { gameId: string }) => void;
  leave_game: (data: { gameId: string; userId: string }) => void;
  lobby_message: (data: { message: string }) => void;
  add_friend: (data: { targetUserId: string }) => void;
  remove_friend: (data: { targetUserId: string }) => void;
  block_user: (data: { targetUserId: string }) => void;
  unblock_user: (data: { targetUserId: string }) => void;
}

export interface Card {
  suit: 'hearts' | 'diamonds' | 'clubs' | 'spades';
  value: string;
  points: number;
}

export interface GameRules {
  maxBid: number;
  minBid: number;
  maxPlayers: number;
  minPlayers: number;
  allowWatchOnly: boolean;
}

export interface GameState {
  id: string;
  status: 'waiting' | 'playing' | 'finished';
  players: {
    id: string;
    name: string;
    team: 1 | 2;
    position: number;
    image?: string;
  }[];
  currentTrick: Card[];
  currentPlayer: string;
  currentRound: number;
  bids: Record<string, number>;
  scores: {
    team1: number;
    team2: number;
  };
  rules: GameRules;
  createdAt: string;
  updatedAt: string;
} 