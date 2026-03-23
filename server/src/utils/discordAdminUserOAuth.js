import { prisma } from "../config/database.js";

const DISCORD_API = "https://discord.com/api/v10";
const UA =
  process.env.DISCORD_API_USER_AGENT ||
  "BUX-Poker-UserOAuth-Admin (+https://www.bux-poker.pro)";

function trimId(id) {
  if (id == null) return "";
  return String(id).trim();
}

async function discordBearerGet(path, accessToken) {
  const res = await fetch(`${DISCORD_API}${path}`, {
    headers: {
      Authorization: `Bearer ${accessToken}`,
      Accept: "application/json",
      "User-Agent": UA,
    },
  });
  const text = await res.text();
  if (!res.ok) return null;
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

/**
 * Admin check using the user's OAuth token (guilds + guilds.members.read), not the bot REST API.
 * Avoids bot global rate limits on GET /guilds/{id}/members/{id}.
 */
export async function findAdminServerViaStoredUserOAuth(discordUserId, servers) {
  const uid = trimId(discordUserId);
  if (!uid || !servers?.length) return null;

  const row = await prisma.user.findUnique({
    where: { discordId: uid },
    select: { discordOAuthAccessToken: true, discordOAuthAccessExpiresAt: true },
  });
  const token = row?.discordOAuthAccessToken;
  if (!token) return null;
  if (row.discordOAuthAccessExpiresAt && row.discordOAuthAccessExpiresAt.getTime() < Date.now() + 10_000) {
    return null;
  }

  const guildsJson = await discordBearerGet("/users/@me/guilds?limit=200", token);
  if (!Array.isArray(guildsJson)) return null;

  const guildMap = new Map(guildsJson.map((g) => [trimId(g.id), g]));

  for (const server of servers) {
    const guildId = trimId(server.serverId);
    const roleId = trimId(server.adminRoleId);
    if (!guildId || !roleId) continue;

    const g = guildMap.get(guildId);
    if (!g) continue;

    if (g.owner === true) {
      return server;
    }

    const member = await discordBearerGet(
      `/users/@me/guilds/${encodeURIComponent(guildId)}/member`,
      token
    );
    if (!member || !Array.isArray(member.roles)) continue;

    const roleSet = new Set(member.roles.map((r) => trimId(r)));
    if (roleSet.has(roleId)) {
      return server;
    }
    // Bot REST can still resolve Discord "Administrator" permission via role list; user OAuth cannot without extra calls.
  }

  return null;
}
