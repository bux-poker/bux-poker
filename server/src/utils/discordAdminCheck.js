import { prisma } from "../config/database.js";

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
 * @param {import('discord.js').Client | null} discordClient
 * @param {string} discordUserId
 * @param {Array<{ serverId: string, adminRoleId: string, serverName: string }>} servers
 * @returns {Promise<{ serverId: string, adminRoleId: string, serverName: string } | null>}
 */
export async function findAdminServerForDiscordUser(discordClient, discordUserId, servers) {
  const uid = normalizeSnowflake(discordUserId);
  if (!discordClient?.guilds || !uid) return null;

  for (const server of servers) {
    const guildId = normalizeSnowflake(server.serverId);
    const roleId = normalizeSnowflake(server.adminRoleId);
    if (!guildId || !roleId) continue;

    try {
      const guild = await discordClient.guilds.fetch(guildId).catch(() => null);
      if (!guild) {
        console.warn(`[discordAdminCheck] Bot not in guild ${guildId} (${server.serverName})`);
        continue;
      }

      let member = null;
      try {
        member = await guild.members.fetch({ user: uid, force: true });
      } catch {
        member = await guild.members.fetch(uid).catch(() => null);
      }
      if (!member) continue;

      if (member.roles.cache.has(roleId)) {
        return server;
      }
      // Rare: cache key mismatch — verify by id
      const match = member.roles.cache.find((r) => r.id === roleId);
      if (match) return server;
    } catch (e) {
      console.warn(`[discordAdminCheck] ${server.serverName}:`, e?.message || e);
    }
  }

  return null;
}
