import { io, Socket } from "socket.io-client";
import { getSocketServerUrl } from "@shared/utils/clientSocketUrl";

/** WebSockets are not proxied through Vercel; connect to Fly in production. */
const SOCKET_URL = getSocketServerUrl();

let socket: Socket | null = null;

export function getSocket(): Socket {
  if (!socket) {
    socket = io(SOCKET_URL, {
      withCredentials: true,
      path: "/socket.io",
      transports: ["websocket", "polling"],
      reconnection: true,
      reconnectionAttempts: Infinity,
      reconnectionDelay: 1000,
      reconnectionDelayMax: 5000,
    });

    // Make socket available to shared components via window
    if (typeof window !== 'undefined') {
      (window as any).__getSocket = getSocket;
    }
  }

  return socket;
}

export function disconnectSocket() {
  if (socket) {
    socket.disconnect();
    socket = null;
  }
}

