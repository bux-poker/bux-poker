// Modularized Chat component
// This is a simplified version that uses the extracted components

import React from 'react';
import { useChatHooks } from './hooks/ChatHooks';
import { ChatHeader } from './components/ChatHeader';
import { ChatMessages } from './components/ChatMessages';
import { ChatInput } from './components/ChatInput';
import { PlayerList } from './components/PlayerList';
import PlayerStatsModal from '../../../../components/modals/PlayerStatsModal';
import type { Player } from "../../../../types/game";
import type { ChatMessage } from "../../Chat";

interface ChatModularProps {
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
}

export default function ChatModular({
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
  onPlayerClick
}: ChatModularProps) {
  
  // Use the chat hooks for all state management and event handling
  const {
    // State
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
    
    // Refs
    messagesEndRef,
    emojiPickerRef,
    lobbyEmojiPickerRef,
    
    // Socket state
    socket,
    isAuthenticated,
    isConnected,
    isReady,
    
    // Actions
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
    onToggleChatType
  });

  return (
    <>
      <div className="flex flex-col h-full bg-gray-800 border-l border-gray-600">
        {/* Chat Header */}
        <ChatHeader
          activeTab={activeTab}
          onTabChange={setActiveTab}
          showPlayerListTab={showPlayerListTab}
          onToggleChatType={onToggleChatType}
          chatType={chatType}
          isMobile={isMobile}
          scaleFactor={scaleFactor}
        />

        {/* Chat Content */}
        <div className={`flex-1 flex flex-col ${isEmojiPickerOpen ? 'overflow-visible' : 'overflow-hidden'}`}>
          {activeTab === 'chat' ? (
            <>
              {/* Chat Messages - takes remaining space */}
              <div className={`flex-1 ${isEmojiPickerOpen ? 'overflow-visible' : 'overflow-hidden'}`}>
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

              {/* Chat Input - fixed at bottom */}
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
            /* Player List */
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
              currentUserId={userId}
            />
          )}
        </div>
      </div>

      {/* Player Stats Modal */}
      <PlayerStatsModal
        isOpen={isStatsOpen}
        onClose={() => setIsStatsOpen(false)}
        player={statsPlayer}
      />
    </>
  );
}
