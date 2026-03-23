import { isDiscordIdAdminAllowlisted, isUserIdAdminAllowlisted } from "./adminAllowlist.js";
import {
  DISCORD_ADMIN_CHECK_RATE_LIMITED,
  findAdminServerForDiscordUser,
  getConfiguredAdminServers,
} from "./discordAdminCheck.js";

/**
 * Cache Discord-based admin resolution so /api/auth/profile does not hammer Discord on every
 * page load (React Strict Mode = double mount, multiple tabs, etc.).
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

/**
 * Web + API admin gate (profile isAdmin, /admin/* middleware, /admin/check).
 *
 * Normal operation (no env admin lists):
 * - `DiscordServer.adminRoleId` from `/setup` in Postgres; verified via Discord REST (cached).
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

  const hit = adminDecisionCache.get(key);
  if (hit && hit.expires > Date.now()) {
    return hit.value;
  }

  let pending = adminDecisionInflight.get(key);
  if (!pending) {
    pending = findAdminServerForDiscordUser(id, servers).then((result) => {
      if (result === DISCORD_ADMIN_CHECK_RATE_LIMITED) {
        adminDecisionCache.set(key, {
          value: false,
          expires: Date.now() + ADMIN_RATE_LIMIT_CACHE_MS,
        });
        return false;
      }
      const value = result != null;
      const ttl = value ? ADMIN_POSITIVE_CACHE_MS : ADMIN_NEGATIVE_CACHE_MS;
      adminDecisionCache.set(key, { value, expires: Date.now() + ttl });
      return value;
    })
      .finally(() => {
        adminDecisionInflight.delete(key);
      });
    adminDecisionInflight.set(key, pending);
  }

  return pending;
}
