import { prisma } from "../config/database.js";
import { isDiscordIdAdminAllowlisted } from "../utils/adminAllowlist.js";
import {
  findAdminServerForDiscordUser,
  getConfiguredAdminServers,
} from "../utils/discordAdminCheck.js";

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

    if (isDiscordIdAdminAllowlisted(user.discordId)) {
      return next();
    }

    const servers = await getConfiguredAdminServers();

    if (servers.length === 0) {
      return next();
    }

    if (!process.env.DISCORD_BOT_TOKEN) {
      console.warn("[ADMIN MIDDLEWARE] DISCORD_BOT_TOKEN missing");
      return res.status(403).json({ error: "Admin access requires Discord bot token" });
    }

    const adminServer = await findAdminServerForDiscordUser(user.discordId, servers);
    if (adminServer) {
      req.adminServerId = adminServer.serverId;
      req.adminServerName = adminServer.serverName;
      return next();
    }

    return res.status(403).json({ error: "Access denied. Admin role required." });
  } catch (error) {
    console.error("[ADMIN MIDDLEWARE] Error:", error);
    console.error("[ADMIN MIDDLEWARE] Error stack:", error.stack);
    // Return 403 instead of 500 for security - don't leak internal errors
    return res.status(403).json({ error: "Access denied. Admin role required." });
  }
};
