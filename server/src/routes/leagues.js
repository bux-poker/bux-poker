import { Router } from "express";
import { LeagueService } from "../services/LeagueService.js";

const router = Router();
const service = new LeagueService();

router.get("/", async (req, res, next) => {
  try {
    const leagues = await service.listLeagues();
    res.json(leagues);
  } catch (err) {
    next(err);
  }
});

router.get("/:id", async (req, res, next) => {
  try {
    const league = await service.getLeagueById(req.params.id);
    if (!league) {
      return res.status(404).json({ error: "League not found" });
    }
    res.json(league);
  } catch (err) {
    next(err);
  }
});

export default router;

