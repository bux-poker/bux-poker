// Chat input component with emoji picker

import React, { useState, useRef, useEffect } from 'react';
import { createPortal } from 'react-dom';
import Picker from '@emoji-mart/react';
import data from '@emoji-mart/data';

interface EmojiData {
  native: string;
}

interface ChatInputProps {
  newMessage: string;
  setNewMessage: (message: string) => void;
  onSendMessage: (message: string) => void;
  isEmojiPickerOpen: boolean;
  setIsEmojiPickerOpen: (open: boolean) => void;
  isMobile: boolean;
  scaleFactor: number;
  chatType: 'game' | 'lobby';
  isConnected: boolean;
  isAuthenticated: boolean;
}

export const ChatInput: React.FC<ChatInputProps> = ({
  newMessage,
  setNewMessage,
  onSendMessage,
  isEmojiPickerOpen,
  setIsEmojiPickerOpen,
  isMobile,
  chatType,
  isConnected,
  isAuthenticated
}) => {
  const emojiPickerRef = useRef<HTMLDivElement>(null);
  const emojiButtonRef = useRef<HTMLButtonElement>(null);
  const [retryCount, setRetryCount] = useState(0);

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (emojiPickerRef.current && !emojiPickerRef.current.contains(event.target as Node)) {
        setIsEmojiPickerOpen(false);
      }
    };

    if (isEmojiPickerOpen) {
      document.addEventListener('mousedown', handleClickOutside);
    }

    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, [isEmojiPickerOpen, setIsEmojiPickerOpen]);

  const handleEmojiSelect = (emoji: EmojiData) => {
    (setNewMessage as any)((prev: string) => prev + emoji.native);
    setIsEmojiPickerOpen(false);
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (newMessage.trim() && isConnected && isAuthenticated) {
      onSendMessage(newMessage.trim());
      setNewMessage('');
      setRetryCount(0);
    }
  };

  const handleKeyPress = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSubmit(e);
    }
  };

  const inputHeight = isMobile ? 34 : 40;
  const sendSize = isMobile ? 34 : 40;
  const canSend = !!newMessage.trim() && isConnected && isAuthenticated;

  return (
    <div className="bux-chat-input-bar">
      <form onSubmit={handleSubmit} className="flex items-center gap-2">
        <div className="relative flex-1">
          <input
            type="text"
            value={newMessage}
            onChange={(e) => setNewMessage(e.target.value)}
            onKeyPress={handleKeyPress}
            placeholder={`Type a ${chatType} message...`}
            className="bux-chat-input pr-9"
            style={{
              height: inputHeight,
              fontSize: isMobile ? 12 : 13,
              paddingLeft: 10,
              paddingRight: 36,
            }}
            disabled={!isConnected || !isAuthenticated}
          />

          <button
            ref={emojiButtonRef}
            type="button"
            onClick={() => setIsEmojiPickerOpen(!isEmojiPickerOpen)}
            className="absolute top-1/2 right-2 -translate-y-1/2 text-slate-400 transition-colors hover:text-[color:var(--bux-brass)]"
            disabled={!isConnected || !isAuthenticated}
            aria-label="Emoji"
          >
            😀
          </button>

          {isEmojiPickerOpen && emojiButtonRef.current && createPortal(
            <div
              ref={emojiPickerRef}
              className="fixed z-[99999]"
              style={{
                top: `${emojiButtonRef.current.getBoundingClientRect().top - 350}px`,
                left: `${emojiButtonRef.current.getBoundingClientRect().right - 300}px`
              }}
            >
              <Picker
                data={data}
                onEmojiSelect={handleEmojiSelect}
                theme="dark"
                previewPosition="none"
                searchPosition="top"
                skinTonePosition="search"
                perLine={8}
                emojiSize={isMobile ? 20 : 24}
                maxFrequentRows={2}
              />
            </div>,
            document.body
          )}
        </div>

        <button
          type="submit"
          disabled={!canSend}
          className="bux-chat-send"
          style={{ width: sendSize, height: sendSize }}
          aria-label="Send"
        >
          <svg
            style={{ width: isMobile ? 16 : 18, height: isMobile ? 16 : 18 }}
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            viewBox="0 0 24 24"
          >
            <path strokeLinecap="round" strokeLinejoin="round" d="M4 4l16 8-16 8 4-8z" />
          </svg>
        </button>
      </form>

      {!isConnected && (
        <div className="mt-1 text-[10px] text-red-300">
          Disconnected. Retrying... ({retryCount}/3)
        </div>
      )}

      {!isAuthenticated && (
        <div className="mt-1 text-[10px] text-amber-300">
          Not authenticated. Please refresh the page.
        </div>
      )}
    </div>
  );
};
