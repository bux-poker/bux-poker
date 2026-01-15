// Player list component for chat
// Extracted from Chat.tsx

import React from 'react';
import type { Player } from '@/types/game';
import { abbreviateBotName } from '@/utils/botUtils';

interface PlayerListProps {
  players: Player[];
  spectators?: Player[];
  isMobile: boolean;
  scaleFactor: number;
  onPlayerClick?: (player: Player) => void;
  playerStatuses: Record<string, 'friend' | 'blocked' | 'not_friend'>;
  onAddFriend: (playerId: string) => void;
  onRemoveFriend: (playerId: string) => void;
  onBlockUser: (playerId: string) => void;
  onUnblockUser: (playerId: string) => void;
  currentUserId?: string;
}

// Fallback avatars 
const GUEST_AVATAR = "/guest-avatar.png";
const BOT_AVATAR = "/bot-avatar.jpg";

// Eye icon for spectators
const EyeIcon = () => (
  <svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" className="inline-block w-4 h-4 ml-1 align-middle">
    <path d="M12 5C5.63636 5 2 12 2 12C2 12 5.63636 19 12 19C18.3636 19 22 12 22 12C22 12 18.3636 5 12 5Z" stroke="#888" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"></path>
    <path d="M12 15C13.6569 15 15 13.6569 15 12C15 10.3431 13.6569 9 12 9C10.3431 9 9 10.3431 9 12C9 13.6569 10.3431 15 12 15Z" stroke="#888" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"></path>
  </svg>
);

export const PlayerList: React.FC<PlayerListProps> = ({
  players,
  spectators = [],
  isMobile,
  scaleFactor,
  onPlayerClick,
  playerStatuses,
  onAddFriend,
  onRemoveFriend,
  onBlockUser,
  onUnblockUser,
  currentUserId
}) => {
  const getFontSizes = () => {
    const baseSize = isMobile ? 12 : 14;
    return {
      playerName: `${Math.floor(baseSize * scaleFactor)}px`,
      status: `${Math.floor((baseSize - 2) * scaleFactor)}px`,
      sectionTitle: `${Math.floor((baseSize + 2) * scaleFactor)}px`
    };
  };

  const fontSizes = getFontSizes();

  const getPlayerStatus = (userId: string) => {
    return playerStatuses[userId] || 'not_friend';
  };

  const handlePlayerAction = (action: string, playerId: string) => {
    if (action === 'add_friend') {
      onAddFriend(playerId);
    } else if (action === 'remove_friend') {
      onRemoveFriend(playerId);
    } else if (action === 'block_user') {
      onBlockUser(playerId);
    } else if (action === 'unblock_user') {
      onUnblockUser(playerId);
    }
  };

  const renderPlayer = (player: Player, isSpectator: boolean = false) => {
    const status = getPlayerStatus(player.id);
    const isBot = (player as any).type === 'bot';
    const isCurrentUser = currentUserId && player.id === currentUserId;
    
    return (
      <div
        key={player.id}
        className="flex items-center justify-between p-3 hover:bg-gray-700 rounded-lg transition-colors"
      >
        <div className="flex items-center gap-3 flex-1">
          {/* Avatar with online indicator */}
          <div className="relative">
            <img
              src={isBot ? BOT_AVATAR : (player.avatarUrl || GUEST_AVATAR)}
              alt={player.username || player.name}
              className="w-10 h-10 rounded-full"
              onError={(e) => {
                (e.target as HTMLImageElement).src = isBot ? BOT_AVATAR : GUEST_AVATAR;
              }}
            />
            {/* Green dot for online status */}
            <div className="absolute -bottom-1 -right-1 w-3 h-3 bg-green-500 border-2 border-gray-800 rounded-full"></div>
          </div>
          
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2">
              <div
                className="font-medium text-white truncate cursor-pointer hover:text-blue-300"
                style={{ fontSize: fontSizes.playerName }}
                onClick={() => onPlayerClick && onPlayerClick(player)}
              >
                {isBot ? abbreviateBotName(player.username || player.name) : (player.username || player.name)}
                {isSpectator && <EyeIcon />}
              </div>
              {isBot && <span className="text-xs text-gray-400">(Bot)</span>}
            </div>
            <div className="text-xs text-gray-400" style={{ fontSize: fontSizes.status }}>
              {isSpectator ? 'Spectator' : 'Player'}
              {status !== 'not_friend' && (
                <span className="ml-1">
                  {status === 'friend' ? '👥 Friend' : '🚫 Blocked'}
                </span>
              )}
            </div>
          </div>
        </div>
        
        {/* Player actions - hide for current user */}
        {!isBot && !isCurrentUser && status !== 'blocked' && (
          <div className="flex gap-1">
            {status === 'friend' ? (
              <button className="w-8 h-8 flex items-center justify-center rounded-full bg-red-600 border border-slate-300 hover:bg-red-700" title="Remove Friend"
                onClick={() => handlePlayerAction('remove_friend', player.id)}>
                <img src="/remove-friend.svg" alt="Remove Friend" className="w-5 h-5" style={{ filter: 'invert(1) brightness(2)' }} />
              </button>
            ) : (
              <button className="w-8 h-8 flex items-center justify-center rounded-full bg-green-600 border border-slate-300 hover:bg-green-700" title="Add Friend"
                onClick={() => handlePlayerAction('add_friend', player.id)}>
                <img src="/add-friend.svg" alt="Add Friend" className="w-5 h-5" style={{ filter: 'invert(1) brightness(2)' }} />
              </button>
            )}
            <button className="w-8 h-8 flex items-center justify-center rounded-full bg-slate-600 border border-slate-300 hover:bg-slate-500" title="Block"
              onClick={() => handlePlayerAction('block_user', player.id)}>
              <svg className="w-7 h-7" fill="none" viewBox="0 0 24 24" stroke="white" strokeWidth="2">
                <circle cx="12" cy="12" r="11" stroke="white" strokeWidth="2" />
                <path d="M4 4L20 20M20 4L4 20" stroke="white" strokeWidth="2.5" />
              </svg>
            </button>
          </div>
        )}
        
        {!isBot && !isCurrentUser && status === 'blocked' && (
          <button className="w-8 h-8 flex items-center justify-center rounded-full bg-yellow-600 border border-slate-300 hover:bg-yellow-700" title="Unblock"
            onClick={() => handlePlayerAction('unblock_user', player.id)}>
            <svg className="w-7 h-7" fill="none" viewBox="0 0 24 24" stroke="white" strokeWidth="2">
              <path d="M9 12l2 2 4-4" stroke="white" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </button>
        )}
      </div>
    );
  };

  return (
    <div className="flex-1 overflow-y-auto p-2" style={{ maxHeight: 'calc(100vh - 200px)' }}>
      {/* Players Section */}
      {players.length > 0 && (
        <div className="mb-4">
          <h3
            className="text-white font-semibold mb-2 pb-1 border-b border-gray-600"
            style={{ fontSize: fontSizes.sectionTitle }}
          >
            Players ({players.length})
          </h3>
          <div className="space-y-1">
            {players.map(player => renderPlayer(player, false))}
          </div>
        </div>
      )}
      
      {/* Spectators Section */}
      {spectators.length > 0 && (
        <div>
          <h3
            className="text-white font-semibold mb-2 pb-1 border-b border-gray-600"
            style={{ fontSize: fontSizes.sectionTitle }}
          >
            Spectators ({spectators.length})
          </h3>
          <div className="space-y-1">
            {spectators.map(player => renderPlayer(player, true))}
          </div>
        </div>
      )}
      
      {/* Empty state */}
      {players.length === 0 && spectators.length === 0 && (
        <div className="text-center text-gray-400 py-8">
          <div className="text-4xl mb-2">👥</div>
          <div style={{ fontSize: fontSizes.playerName }}>No players online</div>
        </div>
      )}
    </div>
  );
};
