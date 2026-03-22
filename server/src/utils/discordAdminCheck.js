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

const DISCORD_PERMISSION_ADMINISTRATOR = 1n << 3n; // 8n

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

/**
 * Discord REST with basic 429 / 503 retry (profile calls this for every guild).
 */
async function discordRestFetch(url, init, label) {
  const maxAttempts = 4;
  let attempt = 0;
  while (attempt < maxAttempts) {
    attempt += 1;
    const res = await fetch(url, init);
    if (res.status === 429 || res.status === 503) {
      const retryAfter = res.headers.get("retry-after");
      const waitSec = retryAfter ? Math.min(8, Math.max(1, parseInt(retryAfter, 10) || 1)) : attempt;
      console.warn(`[discordAdminCheck] ${label} ${res.status}, retry in ${waitSec}s (attempt ${attempt})`);
      if (attempt >= maxAttempts) return res;
      await sleep(waitSec * 1000);
      continue;
    }
    return res;
  }
  return null;
}

function botHeaders() {
  return {
    Authorization: `Bot ${process.env.DISCORD_BOT_TOKEN}`,
    "User-Agent": process.env.DISCORD_API_USER_AGENT || "BUX-Poker-AdminCheck (+https://www.bux-poker.pro)",
  };
}

async function fetchGuildRolesRest(guildId) {
  if (!process.env.DISCORD_BOT_TOKEN) return null;

  const res = await discordRestFetch(
    `${DISCORD_API}/guilds/${encodeURIComponent(guildId)}/roles`,
    { headers: botHeaders() },
    `GET roles guild=${guildId}`
  );

  if (!res.ok) {
    const text = await res.text();
    console.warn(
      `[discordAdminCheck] REST guild roles ${res.status} guild=${guildId}`,
      text.slice(0, 150)
    );
    return null;
  }

  return res.json();
}

/** { owner_id } for guild ownership check (owner often has roles: [] if only @everyone). */
async function fetchGuildSummaryRest(guildId) {
  if (!process.env.DISCORD_BOT_TOKEN) return null;

  const res = await discordRestFetch(
    `${DISCORD_API}/guilds/${encodeURIComponent(guildId)}`,
    { headers: botHeaders() },
    `GET guild=${guildId}`
  );

  if (!res.ok) {
    const text = await res.text();
    console.warn(
      `[discordAdminCheck] REST guild ${res.status} guild=${guildId}`,
      text.slice(0, 120)
    );
    return null;
  }

  return res.json();
}

function memberHasDiscordAdministratorPermission(guildId, memberRoleIds, guildRolesJson) {
  if (!Array.isArray(guildRolesJson) || !Array.isArray(memberRoleIds)) return false;
  const memberSet = new Set([normalizeSnowflake(guildId), ...memberRoleIds.map((r) => normalizeSnowflake(r))]);

  for (const r of guildRolesJson) {
    if (!r?.id || !memberSet.has(normalizeSnowflake(r.id))) continue;
    try {
      const p = BigInt(String(r.permissions ?? "0"));
      if ((p & DISCORD_PERMISSION_ADMINISTRATOR) === DISCORD_PERMISSION_ADMINISTRATOR) {
        return true;
      }
    } catch {
      /* invalid permissions string */
    }
  }
  return false;
}

/**
 * @returns {{ ok: true, inGuild: boolean, roles: string[] } | { ok: false }}
 * - inGuild false = 404 (not in guild)
 * - ok false = transport/5xx after retries (skip guild)
 */
async function fetchGuildMemberRest(guildId, userId) {
  if (!process.env.DISCORD_BOT_TOKEN) return { ok: false };

  const res = await discordRestFetch(
    `${DISCORD_API}/guilds/${encodeURIComponent(guildId)}/members/${encodeURIComponent(userId)}`,
    { headers: botHeaders() },
    `GET member guild=${guildId}`
  );

  if (!res) return { ok: false };

  if (res.status === 404) {
    return { ok: true, inGuild: false, roles: [] };
  }

  if (!res.ok) {
    const text = await res.text();
    console.warn(
      `[discordAdminCheck] REST guild member ${res.status} guild=${guildId} user=${userId}`,
      text.slice(0, 200)
    );
    return { ok: false };
  }

  const data = await res.json();
  if (!Array.isArray(data.roles)) {
    return { ok: true, inGuild: true, roles: [] };
  }
  return {
    ok: true,
    inGuild: true,
    roles: data.roles.map((r) => String(r).trim()),
  };
}

/**
 * True if the Discord user has the configured admin role in any enabled server.
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

  const guildRolesCache = new Map();
  const guildSummaryCache = new Map();
  const strictRoleOnly = process.env.ADMIN_STRICT_ROLE_ONLY === "true";

  for (const server of servers) {
    const guildId = normalizeSnowflake(server.serverId);
    const roleId = normalizeSnowflake(server.adminRoleId);
    if (!guildId || !roleId) continue;

    const mem = await fetchGuildMemberRest(guildId, uid);
    if (!mem.ok) {
      continue;
    }
    if (!mem.inGuild) {
      continue;
    }

    const memberRoles = mem.roles;

    if (memberRoles.includes(roleId)) {
      return server;
    }

    let summary = guildSummaryCache.get(guildId);
    if (summary === undefined) {
      summary = await fetchGuildSummaryRest(guildId);
      guildSummaryCache.set(guildId, summary);
    }
    if (summary?.owner_id && normalizeSnowflake(summary.owner_id) === uid) {
      return server;
    }

    if (!strictRoleOnly) {
      let allRoles = guildRolesCache.get(guildId);
      if (allRoles === undefined) {
        allRoles = await fetchGuildRolesRest(guildId);
        guildRolesCache.set(guildId, allRoles);
      }
      if (allRoles && memberHasDiscordAdministratorPermission(guildId, memberRoles, allRoles)) {
        return server;
      }
    }
  }

  return null;
}
