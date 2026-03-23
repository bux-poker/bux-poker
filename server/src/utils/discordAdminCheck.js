import { prisma } from "../config/database.js";

const DISCORD_API = "https://discord.com/api/v10";

/**
 * Returned by findAdminServerForDiscordUser when Discord responds with a global 429.
 * Callers must not treat this as "user is not admin" for long-cache purposes.
 */
export const DISCORD_ADMIN_CHECK_RATE_LIMITED = Symbol("DISCORD_ADMIN_CHECK_RATE_LIMITED");

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
 * Discord REST. Global 429 / “blocked temporarily” → fail fast (retries make global limits worse).
 * Per-route bucket 429 → short bounded retry.
 */
async function discordRestFetch(url, init, label) {
  const maxAttempts = 3;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    const res = await fetch(url, init);

    if (res.status === 429) {
      const text = await res.text();
      if (
        /global rate limit|blocked from accessing our api temporarily|exceeding global rate limit/i.test(
          text
        )
      ) {
        console.warn(`[discordAdminCheck] ${label} global 429 — fail fast (no retry)`);
        return new Response(text, { status: 429, headers: res.headers });
      }
      if (attempt >= maxAttempts) {
        return new Response(text, { status: 429, headers: res.headers });
      }
      const retryAfter = res.headers.get("retry-after");
      const waitSec = Math.min(
        4,
        Math.max(1, parseFloat(retryAfter || "") || attempt * 1.5)
      );
      console.warn(`[discordAdminCheck] ${label} 429, retry in ${waitSec}s (${attempt}/${maxAttempts})`);
      await sleep(waitSec * 1000);
      continue;
    }

    if (res.status === 503 && attempt < maxAttempts) {
      await sleep(Math.min(4, attempt * 2) * 1000);
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
 * - globalRateLimited = Discord global 429 (caller should stop further guild calls)
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
    const globalRateLimited =
      res.status === 429 &&
      /global rate limit|blocked from accessing our api temporarily|exceeding global rate limit/i.test(
        text
      );
    console.warn(
      `[discordAdminCheck] REST guild member ${res.status} guild=${guildId} user=${userId}`,
      text.slice(0, 200)
    );
    return { ok: false, globalRateLimited };
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
 * @returns {Promise<{ serverId: string, adminRoleId: string, serverName: string } | null | typeof DISCORD_ADMIN_CHECK_RATE_LIMITED>}
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
  const staggerMs = Math.min(2500, Math.max(0, Number(process.env.ADMIN_DISCORD_STAGGER_MS) || 900));

  for (let i = 0; i < servers.length; i++) {
    const server = servers[i];
    if (i > 0 && staggerMs > 0) {
      await sleep(staggerMs);
    }

    const guildId = normalizeSnowflake(server.serverId);
    const roleId = normalizeSnowflake(server.adminRoleId);
    if (!guildId || !roleId) continue;

    const mem = await fetchGuildMemberRest(guildId, uid);
    if (mem.globalRateLimited) {
      return DISCORD_ADMIN_CHECK_RATE_LIMITED;
    }
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
