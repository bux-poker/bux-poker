import { createClient } from 'redis';

/** Warn once if REDIS_URL looks like a truncated or private-network hostname (ENOTFOUND on Fly). */
function warnIfRedisHostSuspicious() {
  const raw = process.env.REDIS_URL;
  if (!raw || typeof raw !== 'string') return;
  try {
    const normalized = raw.replace(/^rediss:\/\//i, 'http://').replace(/^redis:\/\//i, 'http://');
    const u = new URL(normalized);
    if (!u.hostname.includes('.')) {
      console.warn(
        '[REDIS] REDIS_URL hostname has no domain segment (e.g. missing .upstash.io). ' +
          'Use the full endpoint from your Redis provider; internal-only hostnames will not resolve on Fly.'
      );
    }
  } catch {
    console.warn('[REDIS] REDIS_URL could not be parsed; check the value.');
  }
}

warnIfRedisHostSuspicious();

// Redis configuration for different environments
const getRedisConfig = () => {
  const isProduction = process.env.NODE_ENV === 'production';
  
  if (process.env.REDIS_URL) {
    // Use explicit Redis URL if provided
    return {
      url: process.env.REDIS_URL,
      password: process.env.REDIS_PASSWORD
    };
  }
  
  if (isProduction) {
    // Production: Use internal Fly.io Redis
    return {
      url: 'redis://bux-spades-redis.internal:6379',
      password: 'bux-spades-redis-2025'
    };
  } else {
    // Local development: Use localhost Redis (if running)
    return {
      url: 'redis://localhost:6379',
      password: undefined // No password for local Redis
    };
  }
};

const redisClient = createClient(getRedisConfig());

let lastRedisErrorLog = 0;
const REDIS_ERROR_LOG_INTERVAL_MS = 30_000;

redisClient.on('error', (err) => {
  const now = Date.now();
  if (now - lastRedisErrorLog >= REDIS_ERROR_LOG_INTERVAL_MS) {
    lastRedisErrorLog = now;
    console.error('[REDIS] Connection error:', err?.message || err);
  }
});

redisClient.on('connect', () => {
  console.log('[REDIS] Connected to Redis');
});

redisClient.on('ready', () => {
  console.log('[REDIS] Ready to accept commands');
});

redisClient.on('end', () => {
  console.log('[REDIS] Connection ended');
});

// Connect to Redis
async function connectRedis() {
  try {
    await redisClient.connect();
    console.log('[REDIS] Successfully connected to Redis');
  } catch (error) {
    console.error('[REDIS] Failed to connect:', error);
  }
}

export { redisClient, connectRedis };
