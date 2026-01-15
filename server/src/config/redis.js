import { createClient } from 'redis';

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

redisClient.on('error', (err) => {
  console.error('[REDIS] Connection error:', err);
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

// Connect in background
connectRedis();

export { redisClient };
