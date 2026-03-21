import { Router } from "express";
import tournamentsRouter from "./tournaments.js";
import leaguesRouter from "./leagues.js";
import adminRouter from "./admin.js";
import authRouter from "./auth.js";
import { prisma } from "../config/database.js";

const router = Router();

router.get("/health", (req, res) => {
  res.json({ ok: true });
});

/** Optional: verify Postgres is reachable (e.g. Render / paused Neon). */
router.get("/health/db", async (req, res) => {
  try {
    await prisma.$queryRaw`SELECT 1`;
    res.json({ ok: true, db: true });
  } catch (err) {
    console.error("[HEALTH] DB check failed:", err?.code, err?.message);
    res.status(503).json({
      ok: false,
      db: false,
      error: err?.message || "database unreachable",
    });
  }
});

router.use("/tournaments", tournamentsRouter);
router.use("/leagues", leaguesRouter);
router.use("/admin", adminRouter);
router.use("/auth", authRouter);

export default router;

