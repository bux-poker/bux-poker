import { Router } from "express";
import { authenticateToken } from "../middleware/auth.js";
import { TournamentEngine } from "../services/TournamentEngine.js";
import { prisma } from "../config/database.js";

const router = Router();
const engine = new TournamentEngine();

// All admin routes require JWT auth for now.
router.use(authenticateToken);

// Create a new tournament
router.post("/tournaments", async (req, res, next) => {
  try {
    const {
      name,
      description,
      startTime,
      maxPlayers = 100,
      seatsPerTable = 9,
      startingChips = 10000,
      blindLevelsJson,
      prizePlaces = 3,
    } = req.body;

    if (!name || !startTime) {
      return res.status(400).json({ error: "Name and startTime are required" });
    }

    // Default blind levels if not provided
    const defaultBlindLevels = [
      { level: 1, smallBlind: 25, bigBlind: 50, duration: 15 },
      { level: 2, smallBlind: 50, bigBlind: 100, duration: 15 },
      { level: 3, smallBlind: 100, bigBlind: 200, duration: 15 },
      { level: 4, smallBlind: 200, bigBlind: 400, duration: 15 },
      { level: 5, smallBlind: 400, bigBlind: 800, duration: 15 },
    ];

    const blindLevels = blindLevelsJson
      ? typeof blindLevelsJson === "string"
        ? JSON.parse(blindLevelsJson)
        : blindLevelsJson
      : defaultBlindLevels;

    const tournament = await prisma.tournament.create({
      data: {
        name,
        description,
        startTime: new Date(startTime),
        maxPlayers,
        seatsPerTable,
        startingChips,
        blindLevelsJson: JSON.stringify(blindLevels),
        prizePlaces,
        createdById: req.userId, // From JWT auth middleware
      },
      include: {
        createdBy: {
          select: {
            id: true,
            username: true,
            avatarUrl: true,
          },
        },
      },
    });

    res.status(201).json(tournament);
  } catch (err) {
    next(err);
  }
});

router.post("/tournaments/:id/start", async (req, res, next) => {
  try {
    const { id } = req.params;
    const result = await engine.startTournament(id);
    res.json(result);
  } catch (err) {
    next(err);
  }
});

router.post("/tournaments/:id/advance-blinds", async (req, res, next) => {
  try {
    const { id } = req.params;
    const games = await engine.advanceBlindLevel(id);
    res.json({ tournamentId: id, games });
  } catch (err) {
    next(err);
  }
});

router.post("/tournaments/:id/end", async (req, res, next) => {
  try {
    const { id } = req.params;
    await engine.advanceBlindLevel(id); // optional last blind bump
    await prisma.tournament.update({
      where: { id },
      data: { status: "COMPLETED" }
    });
    res.json({ tournamentId: id, status: "COMPLETED" });
  } catch (err) {
    next(err);
  }
});

export default router;

