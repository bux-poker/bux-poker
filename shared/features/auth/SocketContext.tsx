import React, { createContext, useContext, useEffect, useState } from 'react';
import { Socket } from 'socket.io-client';
import { useAuth } from './AuthContext';

// Simple socket connection - use getSocket from client services directly
// This context just provides socket state for Chat components
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
    if (!user) {
      setSocket(null);
      setState({
        isConnected: false,
        isAuthenticated: false,
        isReady: false,
        error: null
      });
      return;
    }

    // For poker, socket is managed per-game in PokerGameView
    // This context just provides basic state for Chat components
    // Chat components should use the socket passed via props or getSocket() directly
    setState({
      isConnected: true,
      isAuthenticated: true,
      isReady: true,
      error: null
    });
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