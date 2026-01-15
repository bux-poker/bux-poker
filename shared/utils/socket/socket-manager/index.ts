// Core SocketManager
export { SocketManager } from './core/socketManager';

// Connection Management
export { getWebSocketUrl, createSocketConfig } from './connection/connectionManager';

// Event Listeners
export { setupSocketListeners } from './events/eventListeners';
export type { SocketState, SocketManagerCallbacks } from './events/eventListeners';

// Monitoring
export { HeartbeatMonitor } from './monitoring/heartbeatMonitor';

// Session Management
export { SessionManager } from './session/sessionManager';
export type { Session } from './session/sessionManager';

// Utilities
export { getSocketManager, getSocket, disconnectSocket, handleAuthenticatedSession } from './utils/socketUtils';
