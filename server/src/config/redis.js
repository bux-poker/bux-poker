import "dotenv/config";
import { createClient } from "redis";

function parseRedisHostname(raw) {
  try {
    const normalized = raw.replace(/^rediss:\/\//i, "http://").replace(/^redis:\/\//i, "http://");
    return new URL(normalized).hostname;
  } catch {
    return null;
  }
}

/**
 * Production must use a real Redis reachable from Fly (e.g. Fly `fly redis create` → *.upstash.io).
 * Render internal hostnames (no public DNS) will never resolve here.
 */
function assertProductionRedisConfig() {
  if (process.env.NODE_ENV !== "production") return;

  const raw = process.env.REDIS_URL;
  if (!raw || typeof raw !== "string" || !raw.trim()) {
    console.error(
      "[REDIS] FATAL: REDIS_URL is required in production. Run: ./scripts/fly-redis-setup.sh"
    );
    process.exit(1);
  }

  const hostname = parseRedisHostname(raw);
  if (!hostname) {
    console.error("[REDIS] FATAL: REDIS_URL is not a valid URL.");
    process.exit(1);
  }

  const isLocal = hostname === "localhost" || hostname === "127.0.0.1";
  if (!isLocal && !hostname.includes(".")) {
    console.error(
      "[REDIS] FATAL: REDIS_URL hostname is not a public DNS name (e.g. Render internal redis://red-xxxxx:6379). " +
        "Create Fly Redis: fly redis create … then fly redis status bux-poker-redis — see ./scripts/fly-redis-setup.sh"
    );
    process.exit(1);
  }
}

assertProductionRedisConfig();

/** Warn if hostname looks like a truncated internal name (log only; assert above already exits in prod). */
function warnIfRedisHostSuspicious() {
  if (process.env.NODE_ENV === "production") return;
  const raw = process.env.REDIS_URL;
  if (!raw || typeof raw !== "string") return;
  const hostname = parseRedisHostname(raw);
  if (!hostname || hostname === "localhost" || hostname === "127.0.0.1") return;
  if (!hostname.includes(".")) {
    console.warn(
      "[REDIS] REDIS_URL hostname has no domain segment — will not resolve from Fly. Use Fly Upstash Redis (see scripts/fly-redis-setup.sh)."
    );
  }
}

warnIfRedisHostSuspicious();

function logRedisConfiguredHost() {
  const raw = process.env.REDIS_URL;
  if (!raw || typeof raw !== "string") return;
  const hostname = parseRedisHostname(raw);
  if (hostname) {
    // eslint-disable-next-line no-console
    console.log("[REDIS] Configured host:", hostname);
  }
}

logRedisConfiguredHost();

const getRedisConfig = () => {
  const isProduction = process.env.NODE_ENV === "production";

  if (process.env.REDIS_URL) {
    return {
      url: process.env.REDIS_URL,
      password: process.env.REDIS_PASSWORD,
    };
  }

  if (isProduction) {
    // Unreachable if assertProductionRedisConfig ran; kept for clarity.
    throw new Error("REDIS_URL missing in production");
  }

  return {
    url: "redis://localhost:6379",
    password: undefined,
  };
};

const redisClient = createClient(getRedisConfig());

let lastRedisErrorLog = 0;
const REDIS_ERROR_LOG_INTERVAL_MS = 30_000;

redisClient.on("error", (err) => {
  const now = Date.now();
  if (now - lastRedisErrorLog >= REDIS_ERROR_LOG_INTERVAL_MS) {
    lastRedisErrorLog = now;
    console.error("[REDIS] Connection error:", err?.message || err);
  }
});

redisClient.on("connect", () => {
  console.log("[REDIS] Connected to Redis");
});

redisClient.on("ready", () => {
  console.log("[REDIS] Ready to accept commands");
});

redisClient.on("end", () => {
  console.log("[REDIS] Connection ended");
});

async function connectRedis() {
  try {
    await redisClient.connect();
    console.log("[REDIS] Successfully connected to Redis");
  } catch (error) {
    console.error("[REDIS] Failed to connect:", error);
  }
}

export { redisClient, connectRedis };
