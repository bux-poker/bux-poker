import { prisma } from "../config/database.js";
import { getDiscordClient } from "../discord/bot.js";

/**
 * Middleware to check if user has admin role in any configured Discord server
 */
export const requireAdminRole = async (req, res, next) => {
  try {
    const userId = req.userId;
    if (!userId) {
      return res.status(401).json({ error: "User not authenticated" });
    }

    // Get user with Discord ID
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { id: true, discordId: true },
    });

    if (!user || !user.discordId) {
      return res.status(403).json({ error: "User does not have a Discord account linked" });
    }

    // Get all configured Discord servers with admin roles
    const servers = await prisma.discordServer.findMany({
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

    if (servers.length === 0) {
      // No servers configured yet - allow access (for initial setup)
      return next();
    }

    // Check if user has admin role in any server
    const discordClient = getDiscordClient();
    if (!discordClient) {
      console.warn("[ADMIN MIDDLEWARE] Discord bot not initialized");
      // If bot not available, deny access for security
      return res.status(403).json({ error: "Admin access requires Discord bot" });
    }

    // Check each server
    for (const server of servers) {
      try {
        const guild = await discordClient.guilds.fetch(server.serverId);
        const member = await guild.members.fetch(user.discordId).catch(() => null);

        if (member && member.roles.cache.has(server.adminRoleId)) {
          // User has admin role in this server
          req.adminServerId = server.serverId;
          req.adminServerName = server.serverName;
          return next();
        }
      } catch (error) {
        // User not in server or bot doesn't have permissions - continue checking other servers
        console.warn(`[ADMIN MIDDLEWARE] Error checking server ${server.serverName}:`, error.message);
        continue;
      }
    }

    // User doesn't have admin role in any server
    return res.status(403).json({ error: "Access denied. Admin role required." });
  } catch (error) {
    console.error("[ADMIN MIDDLEWARE] Error:", error);
    return res.status(500).json({ error: "Internal server error" });
  }
};
