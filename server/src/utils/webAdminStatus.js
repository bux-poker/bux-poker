import { isDiscordIdAdminAllowlisted } from "./adminAllowlist.js";
import {
  findAdminServerForDiscordUser,
  getConfiguredAdminServers,
} from "./discordAdminCheck.js";

/**
 * Same rules as GET /api/admin/check (Discord allowlist, configured servers, REST role check).
 */
export async function computeWebIsAdmin(discordId) {
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
