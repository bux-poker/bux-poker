import "dotenv/config";
import { createClient } from "redis";

/** When set on Fly, do not create a Redis client (dead REDIS_URL was causing session/502 issues behind Vercel). */
const skipRedisClient = process.env.ALLOW_MEMORY_SESSIONS === "1";

function parseRedisHostname(raw) {
  try {
    const normalized = raw.replace(/^rediss:\/\//i, "http://").replace(/^redis:\/\//i, "http://");
    return new URL(normalized).hostname;
  } catch {
    return null;
  }
}

/**
 * Production normally requires Redis (sessions). Set ALLOW_MEMORY_SESSIONS=1 to run without
 * REDIS_URL on a single machine (fly.toml ha=false); sessions reset on restart — emergency only.
 * Render internal hostnames (no public DNS) will never resolve here.
 */
function assertProductionRedisConfig() {
  if (process.env.NODE_ENV !== "production") return;

  const raw = process.env.REDIS_URL;
  const hasUrl = raw && typeof raw === "string" && raw.trim();
  const memoryOk = process.env.ALLOW_MEMORY_SESSIONS === "1";

  if (!hasUrl) {
    if (memoryOk) {
      console.warn(
        "[REDIS] ALLOW_MEMORY_SESSIONS=1 and no REDIS_URL — using in-memory sessions (lost on restart). Add Redis when you can."
      );
      return;
    }
    console.error(
      "[REDIS] FATAL: REDIS_URL is required in production. Run: ./scripts/fly-redis-setup.sh — or set ALLOW_MEMORY_SESSIONS=1 temporarily."
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

if (skipRedisClient) {
  console.warn(
    "[REDIS] ALLOW_MEMORY_SESSIONS=1 — Redis client disabled; sessions use in-memory store (Fly single machine)."
  );
}

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
  if (skipRedisClient) return;
  const raw = process.env.REDIS_URL;
  if (!raw || typeof raw !== "string") return;
  const hostname = parseRedisHostname(raw);
  if (hostname) {
    // eslint-disable-next-line no-console
    console.log("[REDIS] Configured host:", hostname);
  }
}

logRedisConfiguredHost();

function getRedisConfigForUrl(url) {
  const extraPassword = (process.env.REDIS_PASSWORD ?? "").trim();
  const base =
    extraPassword.length > 0
      ? { url, password: extraPassword }
      : { url };

  return {
    ...base,
    pingInterval: 30_000,
    socket: {
      family: 4,
      connectTimeout: 15_000,
      keepAlive: true,
      keepAliveInitialDelay: 10_000,
    },
  };
}

const redisUrlProd = skipRedisClient ? "" : (process.env.REDIS_URL || "").trim();
const redisClient =
  redisUrlProd.length > 0
    ? createClient(getRedisConfigForUrl(process.env.REDIS_URL))
    : process.env.NODE_ENV === "production"
      ? null
      : createClient(getRedisConfigForUrl("redis://localhost:6379"));

let lastRedisErrorLog = 0;
const REDIS_ERROR_LOG_INTERVAL_MS = 30_000;

if (redisClient) {
  redisClient.on("error", (err) => {
    const now = Date.now();
    if (now - lastRedisErrorLog >= REDIS_ERROR_LOG_INTERVAL_MS) {
      lastRedisErrorLog = now;
      console.error("[REDIS] Connection error:", err?.message || err);
    }
  });

  redisClient.on("ready", () => {
    console.log("[REDIS] Ready (commands accepted)");
  });

  redisClient.on("end", () => {
    console.log("[REDIS] Connection ended");
  });
}

async function connectRedis() {
  if (!redisClient) return;
  try {
    await redisClient.connect();
  } catch (error) {
    console.error("[REDIS] Failed to connect:", error);
  }
}

export { redisClient, connectRedis };
