import { Router } from "express";
import { authenticateToken } from "../middleware/auth.js";
import { prisma } from "../config/database.js";

const router = Router();

// Return current user profile based on JWT
router.get("/profile", authenticateToken, async (req, res, next) => {
  try {
    const user = await prisma.user.findUnique({
      where: { id: req.userId },
      select: {
        id: true,
        username: true,
        email: true,
        avatarUrl: true,
        discordId: true,
        coins: true
      }
    });

    if (!user) {
      return res.status(404).json({ error: "User not found" });
    }

    res.json({ user });
  } catch (err) {
    next(err);
  }
});

export default router;

