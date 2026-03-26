/**
 * Base URL for Socket.IO (must be http:// or https://). The client upgrades to WebSocket itself;
 * passing wss:// breaks the polling transport and can cause flaky connections behind proxies.
 */
export const getWebSocketUrl = () => {
  console.log('getWebSocketUrl called with:', {
    VITE_SOCKET_URL: import.meta.env.VITE_SOCKET_URL,
    VITE_API_BASE_URL: import.meta.env.VITE_API_BASE_URL,
    hostname: window.location.hostname,
    location: window.location.href
  });

  const raw =
    import.meta.env.VITE_SOCKET_URL || import.meta.env.VITE_API_BASE_URL;
  if (raw) {
    const trimmed = String(raw).replace(/\/$/, '');
    console.log('Using socket base URL:', trimmed);
    return trimmed;
  }

  const isProduction =
    window.location.hostname !== 'localhost' &&
    window.location.hostname !== '127.0.0.1';
  console.log('Production check:', {
    hostname: window.location.hostname,
    isProduction
  });

  if (isProduction) {
    console.error(
      '[socket] VITE_SOCKET_URL or VITE_API_BASE_URL must be set for production builds'
    );
    return 'https://localhost:3000';
  }
  console.log('Returning development Socket.IO URL: http://localhost:3000');
  return 'http://localhost:3000';
};

export const createSocketConfig = (token: string, userId: string, username: string, avatar?: string) => {
  // Detect mobile device for optimized settings
  const isMobile = /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent);
  const isSafari = /Safari/.test(navigator.userAgent) && !/Chrome/.test(navigator.userAgent);
  
  console.log('SocketManager: Device detection:', { isMobile, isSafari });
  
  // Polling first survives strict proxies (e.g. some PaaS edges) better than WS-first; upgrade still allowed.
  return {
    transports: ['polling', 'websocket'],
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
