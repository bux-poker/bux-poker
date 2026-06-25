import { prisma } from "../config/database.js";
import {
  canManageLeague,
  canManageTournament,
} from "../utils/tournamentAdminAccess.js";

export function requireTournamentAdmin(paramName = "id") {
  return async (req, res, next) => {
    try {
      const tournamentId = req.params[paramName];
      if (!tournamentId) {
        return res.status(400).json({ error: "Tournament id required" });
      }

      const user = await prisma.user.findUnique({
        where: { id: req.userId },
        select: { id: true, discordId: true },
      });

      if (!user) {
        return res.status(403).json({ error: "User not found" });
      }

      const ok = await canManageTournament({
        userId: user.id,
        discordId: user.discordId,
        tournamentId,
      });

      if (!ok) {
        return res.status(403).json({
          error:
            "Access denied. You must be an admin of the Discord server this tournament was created for.",
        });
      }

      return next();
    } catch (err) {
      console.error("[TOURNAMENT ADMIN] Error:", err);
      return res.status(403).json({ error: "Access denied." });
    }
  };
}

export function requireLeagueAdmin(paramName = "id") {
  return async (req, res, next) => {
    try {
      const leagueId = req.params[paramName];
      if (!leagueId) {
        return res.status(400).json({ error: "League id required" });
      }

      const user = await prisma.user.findUnique({
        where: { id: req.userId },
        select: { id: true, discordId: true },
      });

      if (!user) {
        return res.status(403).json({ error: "User not found" });
      }

      const ok = await canManageLeague({
        userId: user.id,
        discordId: user.discordId,
        leagueId,
      });

      if (!ok) {
        return res.status(403).json({
          error:
            "Access denied. You must be an admin of the Discord server this league was created for.",
        });
      }

      return next();
    } catch (err) {
      console.error("[LEAGUE ADMIN] Error:", err);
      return res.status(403).json({ error: "Access denied." });
    }
  };
}
