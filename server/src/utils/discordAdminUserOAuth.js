import { prisma } from "../config/database.js";
import {
  DISCORD_ADMIN_CHECK_RATE_LIMITED,
  isDiscordGlobal429Body,
  scheduleDiscordAdminGlobalBackoff,
} from "./discordAdminShared.js";

const DISCORD_API = "https://discord.com/api/v10";
const UA =
  process.env.DISCORD_API_USER_AGENT ||
  "BUX-Poker-UserOAuth-Admin (+https://www.bux-poker.pro)";

function getAdminRoleIdAllowlist() {
  const raw = process.env.ADMIN_ROLE_IDS || "";
  return raw
    .split(",")
    .map((s) => normSnowflake(s))
    .filter(Boolean);
}

function trimId(id) {
  if (id == null) return "";
  return String(id).trim();
}

/** Normalize Discord snowflakes so "123" and 123n match DB strings. */
function normSnowflake(id) {
  const t = trimId(id);
  if (!t) return "";
  try {
    return BigInt(t).toString();
  } catch {
    return t;
  }
}

async function discordBearerGet(path, accessToken, label) {
  const res = await fetch(`${DISCORD_API}${path}`, {
    headers: {
      Authorization: `Bearer ${accessToken}`,
      Accept: "application/json",
      "User-Agent": UA,
    },
  });
  const text = await res.text();
  if (res.status === 429 && isDiscordGlobal429Body(text)) {
    scheduleDiscordAdminGlobalBackoff();
    console.warn(
      `[webAdmin] user OAuth ${label} global 429 — skipping bot REST this request (${text.slice(0, 100).replace(/\s+/g, " ")})`
    );
    return DISCORD_ADMIN_CHECK_RATE_LIMITED;
  }
  if (!res.ok) {
    console.warn(
      `[webAdmin] user OAuth ${label} HTTP ${res.status} — ${text.slice(0, 160).replace(/\s+/g, " ")}`
    );
    return null;
  }
  try {
    return JSON.parse(text);
  } catch {
    console.warn(`[webAdmin] user OAuth ${label} non-JSON response`);
    return null;
  }
}

/**
 * Admin check using the user's OAuth token (guilds + guilds.members.read), not the bot REST API.
 * Avoids bot global rate limits on GET /guilds/{id}/members/{id}.
 */
export async function findAdminServerViaStoredUserOAuth(discordUserId, servers) {
  const uid = normSnowflake(discordUserId);
  if (!uid || !servers?.length) return null;
  const allowlistedRoleIds = new Set(getAdminRoleIdAllowlist());

  const row = await prisma.user.findUnique({
    where: { discordId: uid },
    select: { discordOAuthAccessToken: true, discordOAuthAccessExpiresAt: true },
  });
  const token = row?.discordOAuthAccessToken;
  if (!token) {
    return null;
  }
  if (row.discordOAuthAccessExpiresAt && row.discordOAuthAccessExpiresAt.getTime() < Date.now() + 10_000) {
    console.warn("[webAdmin] user OAuth token expired for discordId", uid.slice(0, 8) + "…");
    return null;
  }

  const guildsJson = await discordBearerGet("/users/@me/guilds?limit=200", token, "GET @me/guilds");
  if (guildsJson === DISCORD_ADMIN_CHECK_RATE_LIMITED) {
    return DISCORD_ADMIN_CHECK_RATE_LIMITED;
  }
  if (!Array.isArray(guildsJson)) {
    return null;
  }

  const guildMap = new Map(guildsJson.map((g) => [normSnowflake(g.id), g]));

  for (const server of servers) {
    const guildId = normSnowflake(server.serverId);
    const roleId = normSnowflake(server.adminRoleId);
    if (!guildId || !roleId) continue;

    const g = guildMap.get(guildId);
    if (!g) continue;

    if (g.owner === true) {
      return server;
    }

    const member = await discordBearerGet(
      `/users/@me/guilds/${encodeURIComponent(guildId)}/member`,
      token,
      `GET @me/guilds/${guildId}/member`
    );
    if (member === DISCORD_ADMIN_CHECK_RATE_LIMITED) {
      return DISCORD_ADMIN_CHECK_RATE_LIMITED;
    }
    if (!member || !Array.isArray(member.roles)) continue;

    const roleSet = new Set(member.roles.map((r) => normSnowflake(r)));
    if (roleSet.has(roleId)) {
      return server;
    }
    // Optional env fallback when setup role is stale/misconfigured for a guild.
    if (allowlistedRoleIds.size > 0 && [...allowlistedRoleIds].some((rid) => roleSet.has(rid))) {
      return server;
    }
  }

  return null;
}
