export class HeartbeatMonitor {
  private heartbeatInterval: NodeJS.Timeout | null = null;
  private connectionQualityInterval: NodeJS.Timeout | null = null;
  private socket: any;

  constructor(socket: any) {
    this.socket = socket;
  }

  public startHeartbeat(): void {
    const isMobile = /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent);
    if (!isMobile) return; // Only use heartbeat on mobile devices
    
    console.log('SocketManager: Starting heartbeat for mobile device');
    this.stopHeartbeat(); // Clear any existing heartbeat
    
    this.heartbeatInterval = setInterval(() => {
      if (this.socket && this.socket.connected) {
        // Send a ping to keep connection alive
        this.socket.emit('ping');
        console.log('SocketManager: Heartbeat ping sent');
      } else {
        console.log('SocketManager: Heartbeat failed - socket not connected');
        this.stopHeartbeat();
      }
    }, 25000); // Send heartbeat every 25 seconds
  }

  public stopHeartbeat(): void {
    if (this.heartbeatInterval) {
      clearInterval(this.heartbeatInterval);
      this.heartbeatInterval = null;
      console.log('SocketManager: Heartbeat stopped');
    }
  }

  public startConnectionQualityMonitor(): void {
    const isMobile = /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent);
    if (!isMobile) return; // Only monitor on mobile devices
    
    console.log('SocketManager: Starting connection quality monitor for mobile device');
    this.stopConnectionQualityMonitor(); // Clear any existing monitor
    
    this.connectionQualityInterval = setInterval(() => {
      if (this.socket) {
        const transport = this.socket.io?.engine?.transport?.name;
        const connected = this.socket.connected;
        
        console.log('SocketManager: Connection quality check:', {
          transport,
          connected,
          timestamp: new Date().toISOString()
        });
        
        // If connection is poor, try to improve it
        if (connected && transport === 'polling') {
          console.log('SocketManager: Polling transport detected, connection quality:', { transport, connected });
        }
      }
    }, 30000); // Check every 30 seconds
  }

  public stopConnectionQualityMonitor(): void {
    if (this.connectionQualityInterval) {
      clearInterval(this.connectionQualityInterval);
      this.connectionQualityInterval = null;
      console.log('SocketManager: Connection quality monitor stopped');
    }
  }

  public cleanup(): void {
    this.stopHeartbeat();
    this.stopConnectionQualityMonitor();
  }
}
