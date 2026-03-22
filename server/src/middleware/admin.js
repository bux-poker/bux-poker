import { prisma } from "../config/database.js";
import { computeWebIsAdmin } from "../utils/webAdminStatus.js";

/**
 * Same admin decision as GET /api/auth/profile `user.isAdmin` (allowlists, bootstrap, Discord REST).
 */
export const requireAdminRole = async (req, res, next) => {
  try {
    const userId = req.userId;
    if (!userId) {
      return res.status(401).json({ error: "User not authenticated" });
    }

    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { id: true, discordId: true },
    });

    if (!user) {
      return res.status(403).json({ error: "User not found" });
    }

    const isAdmin = await computeWebIsAdmin({
      userId: user.id,
      discordId: user.discordId,
    });

    if (isAdmin) {
      return next();
    }

    return res.status(403).json({ error: "Access denied. Admin role required." });
  } catch (error) {
    console.error("[ADMIN MIDDLEWARE] Error:", error);
    return res.status(403).json({ error: "Access denied. Admin role required." });
  }
};
