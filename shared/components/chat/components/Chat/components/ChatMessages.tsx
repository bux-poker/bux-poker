// Chat messages display component

import React, { useRef, useEffect } from 'react';
import type { ChatMessage } from "../../../Chat";

interface ChatMessagesProps {
  messages: ChatMessage[];
  isMobile: boolean;
  scaleFactor: number;
  userAvatar?: string;
  currentUserId?: string;
  onPlayerClick?: (player: any) => void;
  playerStatuses?: Record<string, 'friend' | 'blocked' | 'not_friend'>;
  onAddFriend?: (playerId: string) => void;
  onRemoveFriend?: (playerId: string) => void;
  onBlockUser?: (playerId: string) => void;
  onUnblockUser?: (playerId: string) => void;
}

const GUEST_AVATAR = "/guest-avatar.png";

const EyeIcon = () => (
  <svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" className="inline-block h-4 w-4 align-middle">
    <path d="M12 5C5.63636 5 2 12 2 12C2 12 5.63636 19 12 19C18.3636 19 22 12 22 12C22 12 18.3636 5 12 5Z" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"></path>
    <path d="M12 15C13.6569 15 15 13.6569 15 12C15 10.3431 13.6569 9 12 9C10.3431 9 9 10.3431 9 12C9 13.6569 10.3431 15 12 15Z" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"></path>
  </svg>
);

export const ChatMessages: React.FC<ChatMessagesProps> = ({
  messages,
  isMobile,
  scaleFactor,
  userAvatar,
  currentUserId,
}) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  // Scroll only inside the chat panel — never scrollIntoView (that shifts the table behind).
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    container.scrollTop = container.scrollHeight;
  }, [messages]);

  const fontSizes = {
    messageText: `${Math.floor(13 * scaleFactor)}px`,
    timestamp: `${Math.floor(11 * scaleFactor)}px`,
    username: `${Math.floor(12 * scaleFactor)}px`,
  };

  const formatTimestamp = (timestamp: number | string | any) => {
    let date: Date;
    if (typeof timestamp === 'string') {
      date = new Date(timestamp);
    } else if (typeof timestamp === 'number') {
      date = new Date(timestamp);
    } else if (timestamp && typeof timestamp === 'object') {
      const ts = timestamp.timestamp || timestamp.time || timestamp.value || Date.now();
      date = new Date(ts);
    } else {
      date = new Date();
    }

    if (isNaN(date.getTime())) {
      date = new Date();
    }

    return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  };

  const avatarSize = isMobile ? 22 : 28;

  return (
    <div ref={containerRef} className="bux-chat-messages">
      {messages.map((message, index) => {
        const messageText = typeof message.message === 'string'
          ? message.message
          : typeof message.message === 'object' && message.message !== null
            ? String(message.message)
            : '';

        let messageTimestamp = message.timestamp;
        if (messageTimestamp && typeof messageTimestamp === 'object') {
          messageTimestamp = messageTimestamp.timestamp || messageTimestamp.time || messageTimestamp.value || Date.now();
        }
        if (!messageTimestamp || (typeof messageTimestamp !== 'number' && typeof messageTimestamp !== 'string')) {
          messageTimestamp = Date.now();
        }

        const isSystemMessage = message.userId === 'system' || message.userId === 'DEALER';
        const isCurrentUser = currentUserId ? message.userId === currentUserId : false;

        if (isSystemMessage) {
          return (
            <div key={message.id || index} className="bux-chat-system" style={{ fontSize: fontSizes.messageText }}>
              <span className="inline-flex items-center justify-center gap-1">
                {messageText.includes('spectating') && <EyeIcon />}
                {messageText}
              </span>
            </div>
          );
        }

        return (
          <div
            key={message.id || index}
            className={`flex items-start ${isCurrentUser ? 'justify-end' : ''}`}
          >
            {!isCurrentUser && (
              <div
                className="mr-1.5 shrink-0 overflow-hidden rounded-full border border-[color:var(--bux-panel-border)]"
                style={{ width: avatarSize, height: avatarSize }}
              >
                <img
                  src={message.userAvatar || GUEST_AVATAR}
                  alt={message.userName || ''}
                  className="h-full w-full object-cover"
                  onError={(e) => {
                    (e.target as HTMLImageElement).src = GUEST_AVATAR;
                  }}
                />
              </div>
            )}
            <div className={`bux-chat-bubble ${isCurrentUser ? 'is-self' : 'is-other'}`}>
              <div className="mb-0.5 flex items-center justify-between gap-2">
                {!isCurrentUser && (
                  <span
                    className="font-display font-semibold tracking-wide opacity-90"
                    style={{ fontSize: fontSizes.username, color: 'var(--bux-brass)' }}
                  >
                    {message.userName}
                  </span>
                )}
                <span className="ml-auto opacity-60" style={{ fontSize: fontSizes.timestamp }}>
                  {formatTimestamp(messageTimestamp)}
                </span>
              </div>
              <p style={{ fontSize: fontSizes.messageText }}>{messageText}</p>
            </div>
            {isCurrentUser && (
              <div
                className="ml-1.5 shrink-0 overflow-hidden rounded-full border border-[color:var(--bux-panel-border)]"
                style={{ width: avatarSize, height: avatarSize }}
              >
                <img
                  src={userAvatar || GUEST_AVATAR}
                  alt="You"
                  className="h-full w-full object-cover"
                  onError={(e) => {
                    (e.target as HTMLImageElement).src = GUEST_AVATAR;
                  }}
                />
              </div>
            )}
          </div>
        );
      })}
      <div ref={messagesEndRef} />
    </div>
  );
};
