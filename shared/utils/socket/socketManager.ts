// Core SocketManager
export { SocketManager } from './socket-manager/core/socketManager';

// Connection Management
export { getWebSocketUrl, createSocketConfig } from './socket-manager/connection/connectionManager';

// Event Listeners
export { setupSocketListeners } from './socket-manager/events/eventListeners';
export type { SocketState, SocketManagerCallbacks } from './socket-manager/events/eventListeners';

// Monitoring
export { HeartbeatMonitor } from './socket-manager/monitoring/heartbeatMonitor';

// Session Management
export { SessionManager } from './socket-manager/session/sessionManager';
export type { Session } from './socket-manager/session/sessionManager';

// Utilities
export { getSocketManager, getSocket, disconnectSocket, handleAuthenticatedSession } from './socket-manager/utils/socketUtils';
