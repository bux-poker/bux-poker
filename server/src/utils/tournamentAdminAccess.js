import { prisma } from "../config/database.js";
import {
  DISCORD_ADMIN_CHECK_RATE_LIMITED,
  findAdminServerForDiscordUser,
  getConfiguredAdminServers,
  normalizeSnowflake,
} from "./discordAdminCheck.js";
import {
  isDiscordIdAdminAllowlisted,
  isUserIdAdminAllowlisted,
} from "./adminAllowlist.js";

/** DiscordServer rows usable for admin role checks. */
export function tournamentPostsToDiscordAdminRows(posts) {
  if (!Array.isArray(posts)) return [];
  return posts
    .filter((p) => p?.server?.enabled && p?.server?.setupCompleted && p.server.adminRoleId)
    .map((p) => ({
      id: p.server.id,
      serverId: p.server.serverId,
      adminRoleId: p.server.adminRoleId,
      serverName: p.server.serverName,
    }));
}

export async function loadTournamentAdminServers(tournamentId) {
  const posts = await prisma.tournamentPost.findMany({
    where: { tournamentId },
    include: {
      server: {
        select: {
          id: true,
          serverId: true,
          adminRoleId: true,
          serverName: true,
          enabled: true,
          setupCompleted: true,
        },
      },
    },
  });
  return tournamentPostsToDiscordAdminRows(posts);
}

function isSuperAdmin({ userId, discordId }) {
  if (userId && isUserIdAdminAllowlisted(userId)) return true;
  if (discordId && isDiscordIdAdminAllowlisted(String(discordId).trim())) return true;
  return false;
}

export function serversOverlap(tournamentServers, userManagedServers) {
  if (!tournamentServers?.length || !userManagedServers?.length) return false;
  const managedIds = new Set(
    userManagedServers.map((s) => normalizeSnowflake(s.serverId))
  );
  return tournamentServers.some((s) =>
    managedIds.has(normalizeSnowflake(s.serverId))
  );
}

/**
 * Discord servers (among configured rows) where this user has the admin role.
 * @returns {Promise<{ servers: object[], allowlist?: boolean, bootstrap?: boolean, rateLimited?: boolean }>}
 */
export async function getUserManagedDiscordServers({ userId, discordId }) {
  if (isSuperAdmin({ userId, discordId })) {
    return { allowlist: true, servers: await getConfiguredAdminServers() };
  }

  const all = await getConfiguredAdminServers();
  if (all.length === 0) {
    return { bootstrap: true, servers: [] };
  }

  if (!discordId || String(discordId).trim() === "") {
    return { servers: [] };
  }

  const managed = [];
  for (const server of all) {
    const hit = await findAdminServerForDiscordUser(discordId, [server]);
    if (hit === DISCORD_ADMIN_CHECK_RATE_LIMITED) {
      return { rateLimited: true, servers: managed };
    }
    if (hit) managed.push(server);
  }
  return { servers: managed };
}

function canManageWithServers({
  tournamentServers,
  managed,
  createdById,
  userId,
  discordId,
}) {
  if (isSuperAdmin({ userId, discordId })) return true;

  if (managed.allowlist || managed.bootstrap) {
    if (tournamentServers.length === 0) return createdById === userId;
    return serversOverlap(tournamentServers, managed.servers);
  }

  if (managed.rateLimited) return false;

  if (tournamentServers.length === 0) {
    return createdById === userId;
  }

  return serversOverlap(tournamentServers, managed.servers);
}

export async function canManageTournament({ userId, discordId, tournamentId }) {
  if (!userId) return false;

  const tournament = await prisma.tournament.findUnique({
    where: { id: tournamentId },
    select: {
      id: true,
      createdById: true,
      posts: {
        include: {
          server: {
            select: {
              id: true,
              serverId: true,
              adminRoleId: true,
              serverName: true,
              enabled: true,
              setupCompleted: true,
            },
          },
        },
      },
    },
  });

  if (!tournament) return false;

  const tournamentServers = tournamentPostsToDiscordAdminRows(tournament.posts);
  const managed = await getUserManagedDiscordServers({ userId, discordId });

  return canManageWithServers({
    tournamentServers,
    managed,
    createdById: tournament.createdById,
    userId,
    discordId,
  });
}

export async function canManageLeague({ userId, discordId, leagueId }) {
  if (!userId) return false;

  const league = await prisma.league.findUnique({
    where: { id: leagueId },
    select: {
      id: true,
      createdById: true,
      games: {
        take: 1,
        orderBy: { gameNumber: "asc" },
        select: { tournamentId: true },
      },
    },
  });

  if (!league) return false;

  const firstLegId = league.games[0]?.tournamentId;
  if (firstLegId) {
    return canManageTournament({ userId, discordId, tournamentId: firstLegId });
  }

  return league.createdById === userId;
}

/**
 * Ensure every Discord guild id in `serverIds` is one the user may post tournaments to.
 * @param {string[]} serverIds Discord guild snowflakes from the create form
 */
export async function assertUserMayUseServerIds({ userId, discordId, serverIds }) {
  const ids = Array.isArray(serverIds)
    ? serverIds.map((s) => String(s).trim()).filter(Boolean)
    : [];
  if (ids.length === 0) return;

  const managed = await getUserManagedDiscordServers({ userId, discordId });
  if (managed.allowlist || managed.bootstrap) return;

  if (managed.rateLimited) {
    const err = new Error(
      "Discord admin check is temporarily unavailable. Try again in a moment."
    );
    err.status = 503;
    throw err;
  }

  const allowedGuildIds = new Set(
    managed.servers.map((s) => normalizeSnowflake(s.serverId))
  );
  const denied = ids.filter((id) => !allowedGuildIds.has(normalizeSnowflake(id)));
  if (denied.length > 0) {
    const err = new Error(
      "You can only create tournaments for Discord servers where you have the admin role."
    );
    err.status = 403;
    throw err;
  }
}

/**
 * Attach `canManage` to tournament payloads for the authenticated viewer.
 */
export async function attachCanManageToTournaments(tournaments, viewerUserId, viewerDiscordId) {
  if (!viewerUserId || !Array.isArray(tournaments) || tournaments.length === 0) {
    return tournaments.map((t) => ({ ...t, canManage: false }));
  }

  const managed = await getUserManagedDiscordServers({
    userId: viewerUserId,
    discordId: viewerDiscordId,
  });

  return tournaments.map((t) => {
    const tournamentServers = tournamentPostsToDiscordAdminRows(t.posts || []);
    const canManage = canManageWithServers({
      tournamentServers,
      managed,
      createdById: t.createdById,
      userId: viewerUserId,
      discordId: viewerDiscordId,
    });
    return { ...t, canManage };
  });
}
