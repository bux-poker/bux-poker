import { isDiscordIdAdminAllowlisted, isUserIdAdminAllowlisted } from "./adminAllowlist.js";
import {
  findAdminServerForDiscordUser,
  getConfiguredAdminServers,
} from "./discordAdminCheck.js";

/**
 * Cache Discord-based admin resolution so /api/auth/profile does not hammer Discord on every
 * page load (React Strict Mode = double mount, multiple tabs, etc.).
 * Override with ADMIN_DECISION_CACHE_MS (ms), default 10 minutes.
 */
const ADMIN_CACHE_MS = Math.min(
  86_400_000,
  Math.max(30_000, Number(process.env.ADMIN_DECISION_CACHE_MS) || 600_000)
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
 * Order:
 * 1) ADMIN_USER_IDS — no Discord
 * 2) ADMIN_DISCORD_IDS — no Discord
 * 3) No configured DiscordServer rows → bootstrap
 * 4) Discord REST (cached + singleflight per user)
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
        adminDecisionCache.set(key, { value, expires: Date.now() + ADMIN_CACHE_MS });
        return value;
      })
      .finally(() => {
        adminDecisionInflight.delete(key);
      });
    adminDecisionInflight.set(key, pending);
  }

  return pending;
}
