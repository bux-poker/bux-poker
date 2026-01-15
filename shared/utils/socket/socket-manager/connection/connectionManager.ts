// For WebSocket connections in production, we need to use wss:// instead of https://
export const getWebSocketUrl = () => {
  console.log('getWebSocketUrl called with:', {
    VITE_SOCKET_URL: import.meta.env.VITE_SOCKET_URL,
    hostname: window.location.hostname,
    location: window.location.href
  });
  
  if (import.meta.env.VITE_SOCKET_URL) {
    const url = import.meta.env.VITE_SOCKET_URL.replace('https://', 'wss://').replace('http://', 'ws://');
    console.log('Using VITE_SOCKET_URL:', url);
    return url;
  }
  
  // Check if we're in production by looking at the current URL
  const isProduction = window.location.hostname !== 'localhost' && window.location.hostname !== '127.0.0.1';
  console.log('Production check:', { hostname: window.location.hostname, isProduction });
  
  if (isProduction) {
    console.log('Returning production WebSocket URL: wss://bux-spades-server.fly.dev');
    return 'wss://bux-spades-server.fly.dev';
  }
  console.log('Returning development WebSocket URL: ws://localhost:3000');
  return 'ws://localhost:3000';
};

export const createSocketConfig = (token: string, userId: string, username: string, avatar?: string) => {
  // Detect mobile device for optimized settings
  const isMobile = /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent);
  const isSafari = /Safari/.test(navigator.userAgent) && !/Chrome/.test(navigator.userAgent);
  
  console.log('SocketManager: Device detection:', { isMobile, isSafari });
  
  return {
    transports: isMobile ? ['polling', 'websocket'] : ['websocket', 'polling'], // Prefer polling on mobile
    auth: {
      token,
      userId,
      username,
      avatar
    },
    reconnection: true,
    reconnectionAttempts: isMobile ? 10 : 8, // Reduced attempts to prevent connection spam
    reconnectionDelay: isMobile ? 3000 : 2000, // Slower initial reconnection
    reconnectionDelayMax: isMobile ? 10000 : 8000, // Shorter max delay
    timeout: isMobile ? 30000 : 20000, // Shorter timeout for faster failure detection
    autoConnect: true,
    forceNew: true, // Force new connection
    upgrade: true, // Allow transport upgrade
    rememberUpgrade: true,
    // Add more robust settings for page refresh scenarios
    closeOnBeforeunload: false, // Don't close on page unload
    // Mobile-specific optimizations - removed User-Agent header to fix CORS
    extraHeaders: undefined
  };
};
