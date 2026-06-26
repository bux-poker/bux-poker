import { Router } from "express";
import { LeagueService } from "../services/LeagueService.js";
import { optionalAuthenticateToken, authenticateToken } from "../middleware/auth.js";
import { prisma } from "../config/database.js";
import { claimLeaguePrize } from "../services/prizes/prizeClaimExecute.js";

const router = Router();
const service = new LeagueService();

router.get("/", async (req, res, next) => {
  try {
    const { all } = req.query;
    const leagues =
      all === "1"
        ? await service.listLeagues()
        : await service.listActiveLeagues();
    res.json(leagues);
  } catch (err) {
    next(err);
  }
});

router.get("/:id", optionalAuthenticateToken, async (req, res, next) => {
  try {
    let viewer = null;
    if (req.userId) {
      viewer = await prisma.user.findUnique({
        where: { id: req.userId },
        select: { id: true, discordId: true },
      });
    }
    const league = await service.getLeagueById(req.params.id, viewer);
    if (!league) {
      return res.status(404).json({ error: "League not found" });
    }
    res.json(league);
  } catch (err) {
    next(err);
  }
});

router.post("/:id/claim-prize", authenticateToken, async (req, res, next) => {
  try {
    const { id } = req.params;
    const { recipientAddress } = req.body ?? {};
    const result = await claimLeaguePrize({
      leagueId: id,
      userId: req.userId,
      recipientAddress,
    });
    res.json(result);
  } catch (err) {
    if (err.status) return res.status(err.status).json({ error: err.message });
    next(err);
  }
});

export default router;
