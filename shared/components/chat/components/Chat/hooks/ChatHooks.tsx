// Chat hooks for socket event handling and message management
// Extracted from Chat.tsx

import { useState, useEffect, useRef } from 'react';
import { useSocket } from '../../../../auth/SocketContext';
import { useAuth } from '../../../../auth/AuthContext';
import { api } from '../../../../../services/lib/api';
import type { ChatMessage } from "../../../Chat";
import type { Player } from '../../../../../types/game';

interface ChatHooksProps {
  gameId: string;
  userId: string;
  players: Player[];
  spectators?: Player[];
  lobbyMessages?: ChatMessage[];
  gameMessages?: Record<string, ChatMessage>;
  chatType: 'game' | 'lobby';
  onToggleChatType?: () => void;
}

export const useChatHooks = ({
  gameId,
  userId,
  players,
  spectators = [],
  lobbyMessages = [],
  gameMessages = {},
  chatType,
  onToggleChatType
}: ChatHooksProps) => {
  const { socket, isAuthenticated, isConnected, isReady } = useSocket();
  const { user } = useAuth();
  
  // State management
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [newMessage, setNewMessage] = useState('');
  const [isEmojiPickerOpen, setIsEmojiPickerOpen] = useState(false);
  const [activeTab, setActiveTab] = useState<'chat' | 'players'>('chat');
  const [scaleFactor, setScaleFactor] = useState(1);
  const [isMobile, setIsMobile] = useState(false);
  const [isStatsOpen, setIsStatsOpen] = useState(false);
  const [statsPlayer, setStatsPlayer] = useState<any | null>(null);
  const [playerStatuses, setPlayerStatuses] = useState<Record<string, 'friend' | 'blocked' | 'not_friend'>>({});
  
  // Refs
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const emojiPickerRef = useRef<HTMLDivElement>(null);
  const lobbyEmojiPickerRef = useRef<HTMLDivElement>(null);
  
  // Screen size state
  const [screenSize, setScreenSize] = useState({
    width: window.innerWidth,
    height: window.innerHeight
  });

  // Responsive sizing effect
  useEffect(() => {
    const handleResize = () => {
      setScreenSize({
        width: window.innerWidth,
        height: window.innerHeight
      });
    };

    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);

  // Calculate scale factor based on screen size
  const getScaleFactor = () => {
    if (screenSize.width < 900) {
      return 0.8;
    } else if (screenSize.width < 1024) {
      return 0.9;
    }
    return 1;
  };

  // Update scale factor when screen size changes
  useEffect(() => {
    setScaleFactor(getScaleFactor());
    setIsMobile(screenSize.width < 800);
  }, [screenSize]);

  // Load player statuses
  useEffect(() => {
    const loadStatuses = async () => {
      if (!isAuthenticated || chatType !== 'lobby') return;
      
      try {
        const response = await api.get('/api/auth/users');
        const allUsers = (response as any).data;
        
        const statuses: Record<string, 'friend' | 'blocked' | 'not_friend'> = {};
        
        // Get friends and blocked users
        const friendsResponse = await api.get('/api/auth/friends');
        const blockedResponse = await api.get('/api/auth/blocked');
        
        const friends = (friendsResponse as any).data || [];
        const blocked = (blockedResponse as any).data || [];
        
        // Set statuses for all players and spectators
        [...players, ...spectators].forEach(player => {
          if (friends.some((f: any) => f.id === player.id)) {
            statuses[player.id] = 'friend';
          } else if (blocked.some((b: any) => b.id === player.id)) {
            statuses[player.id] = 'blocked';
          } else {
            statuses[player.id] = 'not_friend';
          }
        });
        
        setPlayerStatuses(statuses);
      } catch (error) {
        console.error('Error loading player statuses:', error);
      }
    };
    
    loadStatuses();
  }, [isAuthenticated, players, spectators, chatType]);

  // Socket event handlers
  useEffect(() => {
    if (!socket) return;

    // CRITICAL: Listen to CustomEvent, NOT socket directly to avoid duplicates
    const handleGameMessageEvent = (event: CustomEvent) => {
      const { gameId: evtGameId, message } = event.detail || {};
      if (!evtGameId || evtGameId !== gameId || !message) return;
      if (message && message.userId !== 'system') {
        setMessages(prev => {
          // Check if message already exists to prevent duplicates
          const exists = prev.some(m => m.id === message.id);
          if (exists) return prev;
          return [...prev, message];
        });
      }
    };

    const handleLobbyMessage = (data: any) => {
      if (data && data.userId !== 'system') {
        setMessages(prev => [...prev, data]);
      }
    };

    const handleSystemMessageEvent = (event: CustomEvent) => {
      const { gameId: evtGameId, message } = event.detail || {};
      if (!evtGameId || evtGameId !== gameId || !message) return;
      // Normalize system message to ChatMessage shape
      const sys = {
        id: message.id || `sys_${Date.now()}`,
        userId: message.userId || 'system',
        userName: message.userName || 'System',
        message: message.message || '',
        timestamp: Date.now(),
        isGameMessage: true
      } as ChatMessage;
      setMessages(prev => [...prev, sys]);
    };

    window.addEventListener('gameMessage', handleGameMessageEvent as EventListener);
    socket.on('lobby_chat_message', handleLobbyMessage);
    window.addEventListener('systemMessage', handleSystemMessageEvent as EventListener);

    return () => {
      window.removeEventListener('gameMessage', handleGameMessageEvent as EventListener);
      socket.off('lobby_chat_message', handleLobbyMessage);
      window.removeEventListener('systemMessage', handleSystemMessageEvent as EventListener);
    };
  }, [socket, gameId]);

  // Load initial messages
  useEffect(() => {
    if (chatType === 'game' && Object.keys(gameMessages).length > 0) {
      setMessages(prev => {
        const newMessages = Object.values(gameMessages);
        // Only update if we don't have messages yet or if the game messages are actually new
        if (prev.length === 0) {
          return newMessages;
        }
        return prev;
      });
    } else if (chatType === 'lobby' && lobbyMessages.length > 0) {
      setMessages(prev => {
        // Only update if we don't have messages yet
        if (prev.length === 0) {
          return lobbyMessages;
        }
        return prev;
      });
    }
  }, [chatType, gameMessages, lobbyMessages]);

  // Message sending
  const sendMessage = async (messageText: string) => {
    if (!socket || !isAuthenticated || !messageText.trim()) return;

    const message: ChatMessage = {
      id: `${userId}-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
      userId,
      userName: user?.username || 'Unknown',
      message: messageText,
      timestamp: Date.now(),
      isGameMessage: chatType === 'game'
    };

    try {
      if (chatType === 'game') {
        socket.emit('game_message', { gameId, message });
      } else {
        socket.emit('lobby_chat_message', message);
      }
      
      // CRITICAL: Don't add message to local state here - it will be added when we receive it back from server
      // This prevents duplicate messages (optimistic update + server broadcast)
    } catch (error) {
      console.error('Error sending message:', error);
    }
  };

  // Player actions
  const addFriend = async (playerId: string) => {
    try {
      await api.post('/api/auth/friends', { friendId: playerId });
      setPlayerStatuses(prev => ({ ...prev, [playerId]: 'friend' }));
    } catch (error) {
      console.error('Error adding friend:', error);
    }
  };

  const removeFriend = async (playerId: string) => {
    try {
      await api.delete(`/api/auth/friends/${playerId}`);
      setPlayerStatuses(prev => ({ ...prev, [playerId]: 'not_friend' }));
    } catch (error) {
      console.error('Error removing friend:', error);
    }
  };

  const blockUser = async (playerId: string) => {
    try {
      await api.post('/api/auth/block', { blockedId: playerId });
      setPlayerStatuses(prev => ({ ...prev, [playerId]: 'blocked' }));
    } catch (error) {
      console.error('Error blocking user:', error);
    }
  };

  const unblockUser = async (playerId: string) => {
    try {
      await api.delete(`/api/auth/block/${playerId}`);
      setPlayerStatuses(prev => ({ ...prev, [playerId]: 'not_friend' }));
    } catch (error) {
      console.error('Error unblocking user:', error);
    }
  };

  const handlePlayerClick = (player: Player) => {
    setStatsPlayer(player);
    setIsStatsOpen(true);
  };

  return {
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
  };
};
