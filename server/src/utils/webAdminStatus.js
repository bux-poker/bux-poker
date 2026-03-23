import crypto from "crypto";
import { prisma } from "../config/database.js";
import { redisClient } from "../config/redis.js";
import { isDiscordIdAdminAllowlisted, isUserIdAdminAllowlisted } from "./adminAllowlist.js";
import {
  DISCORD_ADMIN_CHECK_RATE_LIMITED,
  findAdminServerForDiscordUser,
  getConfiguredAdminServers,
} from "./discordAdminCheck.js";

const REDIS_ADMIN_PREFIX = "bux-poker:webadmin:";

function redisAdminKey(discordId, serverCount) {
  return `${REDIS_ADMIN_PREFIX}${discordId}:${serverCount}`;
}

async function redisAdminGet(discordId, serverCount) {
  try {
    if (!redisClient.isOpen) return null;
    const raw = await redisClient.get(redisAdminKey(discordId, serverCount));
    if (raw === "1") return true;
    if (raw === "0") return false;
    return null;
  } catch (e) {
    console.warn("[webAdmin] Redis decision read failed:", e?.message || e);
    return null;
  }
}

async function redisAdminSet(discordId, serverCount, isAdmin, ttlMs) {
  try {
    if (!redisClient.isOpen) return;
    const sec = Math.max(1, Math.ceil(ttlMs / 1000));
    await redisClient.set(redisAdminKey(discordId, serverCount), isAdmin ? "1" : "0", {
      EX: sec,
    });
  } catch (e) {
    console.warn("[webAdmin] Redis decision write failed:", e?.message || e);
  }
}

/**
 * In-memory cache (fast). Redis survives Render restarts — without it every deploy cold-calls Discord.
 * Positive: long TTL. Confirmed non-admin: ADMIN_NEGATIVE_CACHE_MS. Global Discord 429:
 * ADMIN_RATE_LIMIT_CACHE_MS (short) so a transient block is not treated like a verified denial.
 */
const ADMIN_POSITIVE_CACHE_MS = Math.min(
  86_400_000,
  Math.max(60_000, Number(process.env.ADMIN_DECISION_CACHE_MS) || 600_000)
);
const ADMIN_NEGATIVE_CACHE_MS = Math.min(
  ADMIN_POSITIVE_CACHE_MS,
  Math.max(15_000, Number(process.env.ADMIN_NEGATIVE_CACHE_MS) || 90_000)
);
/** Global Discord 429: cache false briefly so the client retries instead of locking out ~90s. */
const ADMIN_RATE_LIMIT_CACHE_MS = Math.min(
  120_000,
  Math.max(5_000, Number(process.env.ADMIN_RATE_LIMIT_CACHE_MS) || 15_000)
);

const adminDecisionCache = new Map();
/** @type {Map<string, Promise<boolean>>} */
const adminDecisionInflight = new Map();

function adminCacheKey(userId, discordId, serverCount) {
  return `${userId || ""}|${discordId || ""}|${serverCount}`;
}

function adminProofHashFromServers(servers) {
  const parts = servers
    .map((s) => `${String(s.serverId).trim()}:${String(s.adminRoleId).trim()}`)
    .sort();
  return crypto.createHash("sha256").update(parts.join("|")).digest("hex");
}

/** Trust last verified admin when Discord REST is blocked (default 7d, min 1h, max 7d). */
async function tryDbTrustedWebAdmin(userId, servers) {
  if (!userId) return false;
  const maxAge = Math.min(
    604_800_000,
    Math.max(3_600_000, Number(process.env.ADMIN_DB_TRUST_MS) || 604_800_000)
  );
  const proof = adminProofHashFromServers(servers);
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { webAdminVerifiedAt: true, webAdminProofHash: true },
  });
  if (!user?.webAdminVerifiedAt || user.webAdminProofHash !== proof) {
    return false;
  }
  return Date.now() - user.webAdminVerifiedAt.getTime() < maxAge;
}

async function persistUserWebAdminProof(userId, servers, isAdmin) {
  if (!userId) return;
  const proof = adminProofHashFromServers(servers);
  if (isAdmin) {
    await prisma.user.update({
      where: { id: userId },
      data: { webAdminVerifiedAt: new Date(), webAdminProofHash: proof },
    });
  } else {
    await prisma.user.update({
      where: { id: userId },
      data: { webAdminVerifiedAt: null, webAdminProofHash: null },
    });
  }
}

/**
 * Web + API admin gate (profile isAdmin, /admin/* middleware, /admin/check).
 *
 * Normal operation (no env admin lists):
 * - `DiscordServer.adminRoleId` from `/setup`; verified via gateway member cache, else Discord REST,
 *   Redis, in-memory cache, and DB proof (`webAdminVerifiedAt` + hash) when REST rate-limits.
 *
 * Optional env overrides (emergency only): ADMIN_USER_IDS, ADMIN_DISCORD_IDS.
 *
 * Bootstrap: no configured servers → any Discord-linked user is admin until first `/setup`.
 */
export async function computeWebIsAdmin({ userId, discordId }) {
  if (userId && isUserIdAdminAllowlisted(userId)) {
    return true;
  }

  if (discordId == null || String(discordId).trim() === "") {
    return false;
  }
  const id = String(discordId).trim();
  if (isDiscordIdAdminAllowlisted(id)) {
    return true;
  }

  const servers = await getConfiguredAdminServers();
  if (servers.length === 0) {
    return true;
  }

  const key = adminCacheKey(userId, id, servers.length);
  const sc = servers.length;

  const hit = adminDecisionCache.get(key);
  if (hit && hit.expires > Date.now()) {
    return hit.value;
  }

  const redisHit = await redisAdminGet(id, sc);
  if (redisHit === true) {
    adminDecisionCache.set(key, { value: true, expires: Date.now() + ADMIN_POSITIVE_CACHE_MS });
    return true;
  }
  if (redisHit === false) {
    adminDecisionCache.set(key, { value: false, expires: Date.now() + ADMIN_NEGATIVE_CACHE_MS });
    return false;
  }

  if (await tryDbTrustedWebAdmin(userId, servers)) {
    adminDecisionCache.set(key, { value: true, expires: Date.now() + ADMIN_POSITIVE_CACHE_MS });
    return true;
  }

  let pending = adminDecisionInflight.get(key);
  if (!pending) {
    pending = findAdminServerForDiscordUser(id, servers).then(async (result) => {
      if (result === DISCORD_ADMIN_CHECK_RATE_LIMITED) {
        const staleOk = await redisAdminGet(id, sc);
        if (staleOk === true) {
          adminDecisionCache.set(key, {
            value: true,
            expires: Date.now() + ADMIN_RATE_LIMIT_CACHE_MS,
          });
          return true;
        }
        if (await tryDbTrustedWebAdmin(userId, servers)) {
          adminDecisionCache.set(key, {
            value: true,
            expires: Date.now() + ADMIN_RATE_LIMIT_CACHE_MS,
          });
          return true;
        }
        adminDecisionCache.set(key, {
          value: false,
          expires: Date.now() + ADMIN_RATE_LIMIT_CACHE_MS,
        });
        return false;
      }
      const value = result != null;
      const ttl = value ? ADMIN_POSITIVE_CACHE_MS : ADMIN_NEGATIVE_CACHE_MS;
      adminDecisionCache.set(key, { value, expires: Date.now() + ttl });
      await redisAdminSet(id, sc, value, ttl);
      await persistUserWebAdminProof(userId, servers, value);
      return value;
    })
      .finally(() => {
        adminDecisionInflight.delete(key);
      });
    adminDecisionInflight.set(key, pending);
  }

  return pending;
}
