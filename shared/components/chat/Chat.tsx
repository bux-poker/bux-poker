// Modularized Chat component
// This is a simplified version that uses the extracted components

import React from 'react';
import { useChatHooks } from './components/Chat/hooks/ChatHooks';
import { ChatHeader } from './components/Chat/components/ChatHeader';
import { ChatMessages } from './components/Chat/components/ChatMessages';
import { ChatInput } from './components/Chat/components/ChatInput';
import { PlayerList } from './components/Chat/components/PlayerList';
import type { Player } from '../../types/game';

export interface ChatMessage {
  id?: string;
  userId: string;
  userName: string;
  message: string;
  timestamp: number;
  isGameMessage?: boolean;
  userAvatar?: string;
}

interface PlayerStatsModalProps {
  isOpen: boolean;
  onClose: () => void;
  player: any;
}

interface ChatProps {
  gameId: string;
  userId: string;
  userName: string;
  players: Player[];
  spectators?: Player[];
  userAvatar?: string;
  showPlayerListTab?: boolean;
  chatType?: 'game' | 'lobby';
  onToggleChatType?: () => void;
  lobbyMessages?: ChatMessage[];
  gameMessages?: Record<string, ChatMessage>;
  isSpectator?: boolean;
  onPlayerClick?: (player: Player) => void;
  PlayerStatsModal?: React.ComponentType<PlayerStatsModalProps>;
  showDealerMessages?: boolean;
}

export default function Chat({
  gameId,
  userId,
  userName,
  players,
  spectators = [],
  userAvatar,
  showPlayerListTab = true,
  chatType = 'game',
  onToggleChatType,
  lobbyMessages = [],
  gameMessages = {},
  isSpectator = false,
  onPlayerClick,
  PlayerStatsModal,
  showDealerMessages = true
}: ChatProps) {
  const {
    messages,
    newMessage,
    setNewMessage,
    isEmojiPickerOpen,
    setIsEmojiPickerOpen,
    activeTab,
    setActiveTab,
    scaleFactor,
    isMobile,
    isStatsOpen,
    setIsStatsOpen,
    statsPlayer,
    setStatsPlayer,
    playerStatuses,
    isAuthenticated,
    isConnected,
    sendMessage,
    addFriend,
    removeFriend,
    blockUser,
    unblockUser,
    handlePlayerClick
  } = useChatHooks({
    gameId,
    userId,
    players,
    spectators,
    lobbyMessages,
    gameMessages,
    chatType,
    onToggleChatType,
    showDealerMessages
  });

  return (
    <>
      <div className="bux-chat">
        <ChatHeader
          activeTab={activeTab}
          onTabChange={setActiveTab}
          showPlayerListTab={showPlayerListTab}
          onToggleChatType={onToggleChatType}
          chatType={chatType}
          isMobile={isMobile}
        />

        <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
          {activeTab === 'chat' ? (
            <>
              <div className="min-h-0 flex-1 overflow-hidden">
                <ChatMessages
                  messages={messages}
                  isMobile={isMobile}
                  scaleFactor={scaleFactor}
                  userAvatar={userAvatar}
                  currentUserId={userId}
                  onPlayerClick={handlePlayerClick}
                  playerStatuses={playerStatuses}
                  onAddFriend={addFriend}
                  onRemoveFriend={removeFriend}
                  onBlockUser={blockUser}
                  onUnblockUser={unblockUser}
                />
              </div>
              <ChatInput
                newMessage={newMessage}
                setNewMessage={setNewMessage}
                onSendMessage={sendMessage}
                isEmojiPickerOpen={isEmojiPickerOpen}
                setIsEmojiPickerOpen={setIsEmojiPickerOpen}
                isMobile={isMobile}
                scaleFactor={scaleFactor}
                chatType={chatType}
                isConnected={isConnected}
                isAuthenticated={isAuthenticated}
              />
            </>
          ) : (
            <PlayerList
              players={players}
              spectators={spectators}
              isMobile={isMobile}
              scaleFactor={scaleFactor}
              onPlayerClick={handlePlayerClick}
              playerStatuses={playerStatuses}
              onAddFriend={addFriend}
              onRemoveFriend={removeFriend}
              onBlockUser={blockUser}
              onUnblockUser={unblockUser}
            />
          )}
        </div>
      </div>

      {PlayerStatsModal && (
        <PlayerStatsModal
          isOpen={isStatsOpen}
          onClose={() => setIsStatsOpen(false)}
          player={statsPlayer}
        />
      )}
    </>
  );
}
