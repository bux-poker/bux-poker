import React, { createContext, useContext, useEffect, useRef, useState } from 'react';
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
  /** Tracks attached socket so StrictMode / user changes don't stack duplicate listeners */
  const attachedRef = useRef<{ sock: Socket; onErr: (err: Error) => void; onUpdate: () => void } | null>(null);

  useEffect(() => {
    if (!user) {
      const prev = attachedRef.current;
      if (prev) {
        prev.sock.off('connect', prev.onUpdate);
        prev.sock.off('disconnect', prev.onUpdate);
        prev.sock.off('connect_error', prev.onErr);
        attachedRef.current = null;
      }
      setSocket(null);
      setState({
        isConnected: false,
        isAuthenticated: false,
        isReady: false,
        error: null
      });
      return;
    }

    const initSocket = () => {
      try {
        const getSocket = (window as any).__getSocket;
        if (getSocket && typeof getSocket === 'function') {
          const sock = getSocket() as Socket;

          const prev = attachedRef.current;
          if (prev) {
            prev.sock.off('connect', prev.onUpdate);
            prev.sock.off('disconnect', prev.onUpdate);
            prev.sock.off('connect_error', prev.onErr);
            attachedRef.current = null;
          }

          const userId = user?.id;
          const onUpdate = () => {
            setState({
              isConnected: sock.connected,
              isAuthenticated: !!userId,
              isReady: sock.connected && !!userId,
              error: null
            });
          };

          const onErr = (err: Error) => {
            const msg = err?.message ?? '';
            if (/NS_ERROR_ABORT|abort/i.test(msg)) return;
            setState(prev => ({ ...prev, error: msg }));
          };

          sock.on('connect', onUpdate);
          sock.on('disconnect', onUpdate);
          sock.on('connect_error', onErr);
          attachedRef.current = { sock, onUpdate, onErr };

          setSocket(sock);
          onUpdate();
        } else {
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

    return () => {
      const prev = attachedRef.current;
      if (prev) {
        prev.sock.off('connect', prev.onUpdate);
        prev.sock.off('disconnect', prev.onUpdate);
        prev.sock.off('connect_error', prev.onErr);
        attachedRef.current = null;
      }
    };
  }, [user?.id]);

  return (
    <SocketContext.Provider value={{
      socket,
      ...state
    }}>
      {children}
    </SocketContext.Provider>
  );
}; 