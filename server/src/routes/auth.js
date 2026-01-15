import { Router } from "express";
import passport from "../config/passport.js";
import { authenticateToken } from "../middleware/auth.js";
import { prisma } from "../config/database.js";
import jwt from "jsonwebtoken";

const router = Router();

// Discord OAuth routes
router.get("/discord", passport.authenticate("discord", { scope: ["identify", "email"] }));

router.get(
  "/discord/callback",
  passport.authenticate("discord", { failureRedirect: "/login?error=discord_auth_failed" }),
  async (req, res) => {
    try {
      // Generate JWT token
      const token = jwt.sign(
        { userId: req.user.id },
        process.env.JWT_SECRET || "your-secret-key",
        { expiresIn: "7d" }
      );

      // Redirect to frontend with token
      const clientUrl = process.env.CLIENT_URL || "http://localhost:5173";
      res.redirect(`${clientUrl}/auth/callback?token=${token}`);
    } catch (error) {
      console.error("[AUTH] Discord callback error:", error);
      const clientUrl = process.env.CLIENT_URL || "http://localhost:5173";
      res.redirect(`${clientUrl}/login?error=token_generation_failed`);
    }
  }
);

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

