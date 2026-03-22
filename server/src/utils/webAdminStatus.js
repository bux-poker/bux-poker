import { isDiscordIdAdminAllowlisted, isUserIdAdminAllowlisted } from "./adminAllowlist.js";
import {
  findAdminServerForDiscordUser,
  getConfiguredAdminServers,
} from "./discordAdminCheck.js";

/**
 * Web + API admin gate (profile isAdmin, /admin/* middleware, /admin/check).
 *
 * Order:
 * 1) ADMIN_USER_IDS (Prisma User.id / JWT userId) — no Discord API
 * 2) ADMIN_DISCORD_IDS
 * 3) No configured DiscordServer rows → bootstrap (everyone with discordId is admin)
 * 4) Discord REST: configured admin role / owner / Administrator permission
 */
export async function computeWebIsAdmin({ userId, discordId }) {
  if (userId && isUserIdAdminAllowlisted(userId)) {
    return true;
  }

  if (discordId == null || String(discordId).trim() === "") {
    return false;
  }
  const id = String(discordId).trim();
  if (isDiscordIdAdminAllowlisted(id)) return true;

  const servers = await getConfiguredAdminServers();
  if (servers.length === 0) return true;

  const adminServer = await findAdminServerForDiscordUser(id, servers);
  return !!adminServer;
}
