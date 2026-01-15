import { Router } from "express";
import tournamentsRouter from "./tournaments.js";
import leaguesRouter from "./leagues.js";
import adminRouter from "./admin.js";
import authRouter from "./auth.js";

const router = Router();

router.get("/health", (req, res) => {
  res.json({ ok: true });
});

router.use("/tournaments", tournamentsRouter);
router.use("/leagues", leaguesRouter);
router.use("/admin", adminRouter);
router.use("/auth", authRouter);

export default router;

