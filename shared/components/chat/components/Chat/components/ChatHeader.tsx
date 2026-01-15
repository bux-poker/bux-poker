// Chat header component with tab switching and chat type toggle
// Extracted from Chat.tsx

import React from 'react';

interface ChatHeaderProps {
  activeTab: 'chat' | 'players';
  onTabChange: (tab: 'chat' | 'players') => void;
  showPlayerListTab: boolean;
  onToggleChatType?: () => void;
  chatType: 'game' | 'lobby';
  isMobile: boolean;
  scaleFactor?: number;
}

export const ChatHeader: React.FC<ChatHeaderProps> = ({
  activeTab,
  onTabChange,
  showPlayerListTab,
  onToggleChatType,
  chatType,
  isMobile,
  scaleFactor = 1
}) => {
  // Scale down for different screen widths
  const screenWidth = window.innerWidth;
  const isSmallScreen = screenWidth >= 600 && screenWidth <= 649;
  const isMediumScreen = screenWidth >= 700 && screenWidth <= 750;
  const scale = isSmallScreen ? 0.8 : isMediumScreen ? 0.85 : 1;
  return (
    <div 
      className="flex items-center justify-between bg-gray-900 border-b border-gray-600"
      style={{
        padding: `${8 * scale}px`,
        fontSize: `${14 * scale}px`
      }}
    >
      <div className="flex items-center gap-2">
        <button
          className="flex items-center justify-center rounded-md font-semibold transition"
          style={{
            width: `${(isMobile ? 48 : 80) * scale}px`,
            height: `${(isMobile ? 32 : 40) * scale}px`,
            backgroundColor: activeTab === 'chat' ? '#4f46e5' : '#374151'
          }}
          onClick={() => onTabChange('chat')}
          aria-label="Chat"
        >
          <img 
            src="/chat.svg" 
            alt="Chat" 
            style={{ 
              width: `${(isMobile ? 16 : 24) * scale}px`,
              height: `${(isMobile ? 16 : 24) * scale}px`,
              filter: 'invert(1) brightness(2)' 
            }} 
          />
        </button>
        {showPlayerListTab && (
          <button
            className="flex items-center justify-center rounded-md font-semibold transition"
            style={{
              width: `${(isMobile ? 48 : 80) * scale}px`,
              height: `${(isMobile ? 32 : 40) * scale}px`,
              backgroundColor: activeTab === 'players' ? '#4f46e5' : '#374151'
            }}
            onClick={() => onTabChange('players')}
            aria-label="Players"
          >
            <img 
              src="/players.svg" 
              alt="Players" 
              style={{ 
                width: `${(isMobile ? 16 : 24) * scale}px`,
                height: `${(isMobile ? 16 : 24) * scale}px`,
                filter: 'invert(1) brightness(2)' 
              }} 
            />
          </button>
        )}
        
        {/* Toggle switch for chat type */}
        {onToggleChatType && (
          <div className="flex items-center gap-2 ml-2">
            <span 
              className="text-gray-300"
              style={{
                fontSize: `${(isMobile ? 12 : 14) * scale}px`
              }}
            >
              {chatType === 'game' ? 'Game' : 'Lobby'}
            </span>
            <button
              onClick={onToggleChatType}
              className="relative inline-flex items-center rounded-full transition-colors"
              style={{
                height: `${(isMobile ? 20 : 24) * scale}px`,
                width: `${(isMobile ? 36 : 44) * scale}px`,
                backgroundColor: chatType === 'game' ? '#4f46e5' : '#4b5563'
              }}
              aria-label={`Switch to ${chatType === 'game' ? 'lobby' : 'game'} chat`}
            >
              <span
                className="inline-block rounded-full bg-white transition-transform"
                style={{
                  height: `${(isMobile ? 16 : 20) * scale}px`,
                  width: `${(isMobile ? 16 : 20) * scale}px`,
                  transform: chatType === 'game' 
                    ? `translateX(${(isMobile ? 16 : 20) * scale}px)` 
                    : 'translateX(0)'
                }}
              />
            </button>
          </div>
        )}
      </div>
    </div>
  );
};
