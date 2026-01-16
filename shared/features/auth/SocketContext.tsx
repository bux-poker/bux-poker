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

    // Dynamically import getSocket from client services
    // This allows shared components to use the socket without direct dependency
    const initSocket = async () => {
      try {
        // Try to get socket from window if available (set by client)
        const getSocket = (window as any).__getSocket;
        if (getSocket && typeof getSocket === 'function') {
          const sock = getSocket();
          setSocket(sock);
          
          // Monitor connection status
          const updateConnection = () => {
            setState({
              isConnected: sock.connected,
              isAuthenticated: !!user,
              isReady: sock.connected && !!user,
              error: null
            });
          };

          sock.on('connect', updateConnection);
          sock.on('disconnect', updateConnection);
          sock.on('connect_error', (err) => {
            setState(prev => ({ ...prev, error: err.message }));
          });

          updateConnection();
        } else {
          // Fallback: assume connected if user exists
          setState({
            isConnected: true,
            isAuthenticated: true,
            isReady: true,
            error: null
          });
        }
      } catch (error) {
        console.error('Error initializing socket:', error);
        setState({
          isConnected: false,
          isAuthenticated: false,
          isReady: false,
          error: 'Failed to connect'
        });
      }
    };

    initSocket();
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