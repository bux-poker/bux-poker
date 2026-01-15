import { Socket } from 'socket.io-client';
import { SocketManager } from './socketManager';

export const socketManager = SocketManager.getInstance();

export const getSocket = (): Socket | null => {
  return socketManager.getSocket();
};

export const initializeSocket = (userId: string, username: string, avatar?: string): void => {
  socketManager.initialize(userId, username, avatar);
};

export const disconnectSocket = (): void => {
  socketManager.disconnect();
};

export const getSocketState = () => {
  return socketManager.getState();
};

export const onSocketStateChange = (callback: (state: any) => void) => {
  socketManager.onStateChange(callback);
}; 