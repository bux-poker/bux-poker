// Chat header component with tab switching and chat type toggle

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
}) => {
  if (!showPlayerListTab) {
    return null;
  }

  const tabSize = isMobile
    ? { width: 44, height: 30, icon: 15 }
    : { width: 56, height: 34, icon: 18 };

  return (
    <div className="bux-chat-header">
      <div className="flex items-center gap-1.5">
        <button
          type="button"
          className={`bux-chat-tab ${activeTab === 'chat' ? 'is-active' : ''}`}
          style={{ width: tabSize.width, height: tabSize.height }}
          onClick={() => onTabChange('chat')}
          aria-label="Chat"
        >
          <img
            src="/chat.svg"
            alt=""
            style={{
              width: tabSize.icon,
              height: tabSize.icon,
              filter: 'invert(1) brightness(2)',
            }}
          />
        </button>
        <button
          type="button"
          className={`bux-chat-tab ${activeTab === 'players' ? 'is-active' : ''}`}
          style={{ width: tabSize.width, height: tabSize.height }}
          onClick={() => onTabChange('players')}
          aria-label="Players"
        >
          <img
            src="/players.svg"
            alt=""
            style={{
              width: tabSize.icon,
              height: tabSize.icon,
              filter: 'invert(1) brightness(2)',
            }}
          />
        </button>

        {onToggleChatType && (
          <div className="ml-1.5 flex items-center gap-1.5">
            <span
              className="font-display text-[10px] font-semibold uppercase tracking-wide"
              style={{ color: 'var(--bux-brass)' }}
            >
              {chatType === 'game' ? 'Game' : 'Lobby'}
            </span>
            <button
              type="button"
              onClick={onToggleChatType}
              className="relative inline-flex items-center rounded-full transition-colors"
              style={{
                height: 20,
                width: 36,
                background:
                  chatType === 'game'
                    ? 'var(--bux-accent-deep)'
                    : 'color-mix(in srgb, var(--bux-panel) 80%, #64748b)',
              }}
              aria-label={`Switch to ${chatType === 'game' ? 'lobby' : 'game'} chat`}
            >
              <span
                className="inline-block rounded-full bg-white transition-transform"
                style={{
                  height: 16,
                  width: 16,
                  marginLeft: 2,
                  transform: chatType === 'game' ? 'translateX(16px)' : 'translateX(0)',
                }}
              />
            </button>
          </div>
        )}
      </div>
    </div>
  );
};
