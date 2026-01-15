import React, { createContext, useContext, useEffect, useState } from 'react';
import { Socket } from 'socket.io-client';
import { getSocketManager } from '@/features/game/services/lib/socketManager';
import { useAuth } from './AuthContext';

interface SocketContextType {
  socket: Socket | null;
  isConnected: boolean;
  isAuthenticated: boolean;
  isReady: boolean;
  error: string | null;
}

const SocketContext = createContext<SocketContextType>({
  socket: null,
  isConnected: false,
  isAuthenticated: false,
  isReady: false,
  error: null
});

export const useSocket = () => useContext(SocketContext);

export const SocketProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const { user } = useAuth();
  const [socket, setSocket] = useState<Socket | null>(null);
  const [state, setState] = useState({
    isConnected: false,
    isAuthenticated: false,
    isReady: false,
    error: null as string | null
  });

  useEffect(() => {
    console.log('SOCKET CONTEXT - User changed:', user);
    if (!user) {
      console.log('SOCKET CONTEXT - No user, clearing socket');
      setSocket(null);
      setState({
        isConnected: false,
        isAuthenticated: false,
        isReady: false,
        error: null
      });
      return;
    }

    console.log('SOCKET CONTEXT - Initializing socket for user:', { id: user.id, username: user.username });
    const socketManager = getSocketManager();
    socketManager.onStateChange((newState) => {
      console.log('SOCKET CONTEXT - State changed:', newState);
      setState(newState);
      setSocket(socketManager.getSocket());
    });

    socketManager.initialize(user.id, user.username, user.avatarUrl || undefined);

    // Ensure we auto-join any active game room after authentication
    socketManager.onStateChange((s) => {
      if (s.isReady) {
        try {
          const stored = localStorage.getItem('activeGameId');
          if (stored) {
            const sock = socketManager.getSocket();
            if (sock && sock.connected) {
              // sock.emit('join_game', { gameId: activeGameId }); // User already in game
            }
          }
        } catch {}
      }
    });

    return () => {
      socketManager.disconnect();
    };
  }, [user]);

  return (
    <SocketContext.Provider value={{
      socket,
      ...state
    }}>
      {children}
    </SocketContext.Provider>
  );
}; 