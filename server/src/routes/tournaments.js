import { Router } from "express";
import { TournamentService } from "../services/TournamentService.js";

const router = Router();
const service = new TournamentService();

router.get("/", async (req, res, next) => {
  try {
    const tournaments = await service.listTournaments();
    res.json(tournaments);
  } catch (err) {
    next(err);
  }
});

router.get("/:id", async (req, res, next) => {
  try {
    const tournament = await service.getTournamentById(req.params.id);
    if (!tournament) {
      return res.status(404).json({ error: "Tournament not found" });
    }
    res.json(tournament);
  } catch (err) {
    next(err);
  }
});

router.post("/:id/register", async (req, res, next) => {
  try {
    // TODO: get userId from auth middleware/session
    const userId = req.user?.id || req.body.userId;
    if (!userId) {
      return res.status(401).json({ error: "User not authenticated" });
    }

    const registration = await service.registerForTournament({
      tournamentId: req.params.id,
      userId
    });

    res.json(registration);
  } catch (err) {
    next(err);
  }
});

export default router;

