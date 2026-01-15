import { io, Socket } from 'socket.io-client';
import { getWebSocketUrl, createSocketConfig } from '../connection/connectionManager';
import { setupSocketListeners, SocketState, SocketManagerCallbacks } from '../events/eventListeners';
import { HeartbeatMonitor } from '../monitoring/heartbeatMonitor';
import { SessionManager } from '../session/sessionManager';

export class SocketManager {
  private static instance: SocketManager;
  private socket: Socket | null = null;
  private state: SocketState = {
    isConnected: false,
    isAuthenticated: false,
    isReady: false,
    error: null
  };
  private sessionManager: SessionManager;
  private heartbeatMonitor: HeartbeatMonitor | null = null;

  private stateChangeCallbacks: ((state: SocketState) => void)[] = [];
  private onConnectCallbacks: (() => void)[] = [];
  private initialized = false;

  private constructor() {
    this.sessionManager = new SessionManager();
  }

  public static getInstance(): SocketManager {
    if (!SocketManager.instance) {
      SocketManager.instance = new SocketManager();
    }
    return SocketManager.instance;
  }

  public onStateChange(callback: (state: SocketState) => void) {
    this.stateChangeCallbacks.push(callback);
    // Immediately notify of current state
    callback(this.getState());
  }

  public onConnect(callback: () => void) {
    this.onConnectCallbacks.push(callback);
  }

  private notifyStateChange() {
    const state = this.getState();
    this.stateChangeCallbacks.forEach(callback => callback(state));
  }

  private notifyConnect() {
    this.onConnectCallbacks.forEach(callback => callback());
  }

  public getState(): SocketState {
    return {
      isConnected: this.state.isConnected,
      isAuthenticated: this.state.isAuthenticated,
      isReady: this.state.isReady,
      error: this.state.error
    };
  }

  public initialize(userId: string, username: string, avatar?: string): void {
    console.log('SOCKET INITIALIZE CALLED:', { userId, username });
    console.log('SOCKET INITIALIZE - localStorage contents:', {
      sessionToken: localStorage.getItem('sessionToken'),
      userData: localStorage.getItem('userData'),
      token: localStorage.getItem('token')
    });
    
    // Get token from storage
    const token = this.sessionManager.getTokenFromStorage();
    
    if (!token) {
      console.error('SocketManager: No session token found in any storage location');
      this.state.isReady = false;
      this.notifyStateChange();
      return;
    }
    
    console.log('SocketManager: Found session token in storage');

    this.sessionManager.setSession({ token, userId, username });
    
    // If we already have a socket, disconnect it
    if (this.socket) {
      console.log('SocketManager: Disconnecting existing socket');
      this.socket.disconnect();
      this.socket = null;
    }

    // Initialize new socket connection
    const wsUrl = getWebSocketUrl();
    const config = createSocketConfig(token, userId, username, avatar);
    
    console.log('SocketManager: Environment check:', {
      hostname: window.location.hostname,
      isProduction: window.location.hostname !== 'localhost' && window.location.hostname !== '127.0.0.1',
      wsUrl: wsUrl
    });
    
    this.socket = io(wsUrl, config);
    this.heartbeatMonitor = new HeartbeatMonitor(this.socket);

    this.setupSocketListeners();
    this.notifyStateChange();
    this.initialized = true;
  }

  private setupSocketListeners(): void {
    if (!this.socket || !this.heartbeatMonitor) return;

    const callbacks: SocketManagerCallbacks = {
      onStateChange: (state: SocketState) => {
        this.state = state;
        this.notifyStateChange();
      },
      onConnect: () => {
        this.state.isConnected = true;
        this.notifyConnect();
        this.notifyStateChange();
      },
      onAuthenticated: (data: { userId: string; activeGameId?: string }) => {
        this.state.isAuthenticated = true;
        this.state.isReady = this.state.isConnected && this.state.isAuthenticated;
        console.log('SOCKET STATE AFTER AUTH:', { 
          isConnected: this.state.isConnected, 
          isAuthenticated: this.state.isAuthenticated, 
          isReady: this.state.isReady,
          activeGameId: data.activeGameId
        });
        this.notifyStateChange();
      },
      onSessionInvalidated: (_data: { reason: string; message: string }) => {
        this.state.isAuthenticated = false;
        this.state.isReady = false;
        this.state.error = 'Session invalidated';
        
        // Clear session data
        this.sessionManager.clearSession();
        
        // Disconnect socket
        if (this.socket) {
          this.socket.disconnect();
          this.socket = null;
        }
        
        this.notifyStateChange();
      },
      onForceLogout: (_data: { reason: string; message: string }) => {
        console.log('[SOCKET MANAGER] Force logout triggered');
        this.state.isAuthenticated = false;
        this.state.isReady = false;
        this.state.error = 'Logged out from another device';
        
        // Clear session data
        this.sessionManager.clearSession();
        
        // Clear localStorage
        localStorage.removeItem('sessionToken');
        localStorage.removeItem('userData');
        localStorage.removeItem('activeGameId');
        
        // Disconnect socket
        if (this.socket) {
          this.socket.disconnect();
          this.socket = null;
        }
        
        this.notifyStateChange();
      },
      startHeartbeat: () => {
        this.heartbeatMonitor?.startHeartbeat();
      },
      startConnectionQualityMonitor: () => {
        this.heartbeatMonitor?.startConnectionQualityMonitor();
      }
    };

    setupSocketListeners(this.socket, callbacks);
  }

  public getSocket(): Socket | null {
    return this.socket;
  }

  public disconnect(): void {
    if (this.socket) {
      this.socket.disconnect();
      this.socket = null;
    }
    this.state.isConnected = false;
    this.state.isAuthenticated = false;
    this.state.isReady = false;
    this.sessionManager.clearSession();
    this.heartbeatMonitor?.cleanup();
    this.notifyStateChange();
  }

  public forceReconnect(): void {
    console.log('SocketManager: Force reconnecting...');
    if (this.socket) {
      this.socket.disconnect();
      this.socket = null;
    }
    
    // Reset state
    this.state.isConnected = false;
    this.state.isAuthenticated = false;
    this.state.isReady = false;

    // Reinitialize if we have a session
    const session = this.sessionManager.getSession();
    if (session) {
      console.log('SocketManager: Reinitializing with existing session');
      this.initialize(session.userId, session.username);
    }
    
    this.notifyStateChange();
  }

  public clearActiveGame(): void {
    console.log('[SOCKET MANAGER] Clearing active game from localStorage');
    localStorage.removeItem('activeGameId');
    localStorage.removeItem('lastFailedJoin');
  }

  public isInitialized(): boolean {
    return this.initialized;
  }

  public async initializeSession(): Promise<boolean> {
    const sessionData = await this.sessionManager.initializeSession();
    if (sessionData) {
      this.initialize(sessionData.userId, sessionData.username, sessionData.avatar);
      return true;
    }
    return false;
  }
}
