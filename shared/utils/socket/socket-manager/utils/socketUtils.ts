import { Socket } from 'socket.io-client';
import { SocketManager } from '../core/socketManager';

export const getSocketManager = () => {
  return SocketManager.getInstance();
};

export const getSocket = (): Socket | null => {
  const manager = getSocketManager();
  return manager.getSocket();
};

export const disconnectSocket = () => {
  const manager = getSocketManager();
  manager.disconnect();
};

export async function handleAuthenticatedSession() {
  const socketManager = getSocketManager();
  if (!socketManager.isInitialized()) {
    console.log('Socket not initialized, initializing...');
    return await socketManager.initializeSession();
  }
  return true;
}
