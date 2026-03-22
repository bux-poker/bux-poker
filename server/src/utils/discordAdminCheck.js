import { prisma } from "../config/database.js";

const DISCORD_API = "https://discord.com/api/v10";

/** Discord snowflakes must be compared as trimmed strings (DB / copy-paste drift). */
export function normalizeSnowflake(id) {
  if (id == null) return "";
  return String(id).trim();
}

export async function getConfiguredAdminServers() {
  const rows = await prisma.discordServer.findMany({
    where: {
      enabled: true,
      setupCompleted: true,
      adminRoleId: { not: null },
    },
    select: {
      serverId: true,
      adminRoleId: true,
      serverName: true,
    },
  });
  return rows.filter((s) => normalizeSnowflake(s.adminRoleId));
}

/**
 * Role IDs for a guild member via Discord REST (source of truth; avoids gateway/cache issues).
 * @returns {string[] | null} null = request failed (403/network); [] = not a member
 */
async function fetchMemberRoleIdsRest(guildId, userId) {
  const token = process.env.DISCORD_BOT_TOKEN;
  if (!token) return null;

  const res = await fetch(
    `${DISCORD_API}/guilds/${encodeURIComponent(guildId)}/members/${encodeURIComponent(userId)}`,
    {
      headers: {
        Authorization: `Bot ${token}`,
        "User-Agent": process.env.DISCORD_API_USER_AGENT || "BUX-Poker-AdminCheck (+https://www.bux-poker.pro)",
      },
    }
  );

  if (res.status === 404) {
    return [];
  }

  if (!res.ok) {
    const text = await res.text();
    console.warn(
      `[discordAdminCheck] REST guild member ${res.status} guild=${guildId} user=${userId}`,
      text.slice(0, 200)
    );
    return null;
  }

  const data = await res.json();
  if (!Array.isArray(data.roles)) return [];
  return data.roles.map((r) => String(r).trim());
}

/**
 * True if the Discord user has the configured admin role in any enabled server.
 * Uses REST only — works even when the discord.js gateway client is not connected (Render cold start).
 *
 * @param {string} discordUserId
 * @param {Array<{ serverId: string, adminRoleId: string, serverName: string }>} servers
 * @returns {Promise<{ serverId: string, adminRoleId: string, serverName: string } | null>}
 */
export async function findAdminServerForDiscordUser(discordUserId, servers) {
  const uid = normalizeSnowflake(discordUserId);
  if (!uid) return null;

  if (!process.env.DISCORD_BOT_TOKEN) {
    console.warn("[discordAdminCheck] DISCORD_BOT_TOKEN missing — cannot verify admin roles");
    return null;
  }

  for (const server of servers) {
    const guildId = normalizeSnowflake(server.serverId);
    const roleId = normalizeSnowflake(server.adminRoleId);
    if (!guildId || !roleId) continue;

    const memberRoles = await fetchMemberRoleIdsRest(guildId, uid);
    if (memberRoles === null) {
      continue;
    }
    if (memberRoles.includes(roleId)) {
      return server;
    }
  }

  return null;
}
