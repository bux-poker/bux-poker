import { isDiscordIdAdminAllowlisted, isUserIdAdminAllowlisted } from "./adminAllowlist.js";
import {
  findAdminServerForDiscordUser,
  getConfiguredAdminServers,
} from "./discordAdminCheck.js";

/**
 * Cache Discord-based admin resolution so /api/auth/profile does not hammer Discord on every
 * page load (React Strict Mode = double mount, multiple tabs, etc.).
 * Positive result: long TTL. Negative: short TTL so a Discord 429 / transient failure is not
 * remembered for 10 minutes.
 */
const ADMIN_POSITIVE_CACHE_MS = Math.min(
  86_400_000,
  Math.max(60_000, Number(process.env.ADMIN_DECISION_CACHE_MS) || 600_000)
);
const ADMIN_NEGATIVE_CACHE_MS = Math.min(
  ADMIN_POSITIVE_CACHE_MS,
  Math.max(15_000, Number(process.env.ADMIN_NEGATIVE_CACHE_MS) || 90_000)
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
    pending = findAdminServerForDiscordUser(id, servers)
      .then((server) => !!server)
      .then((value) => {
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
