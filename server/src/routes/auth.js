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
  passport.authenticate("discord", { failureRedirect: "/login?error=discord_auth_failed", session: false }),
  async (req, res) => {
    try {
      // Check if user was authenticated
      if (!req.user) {
        console.error("[AUTH] No user in request after Discord authentication");
        const clientUrl = process.env.CLIENT_URL || "http://localhost:5173";
        return res.redirect(`${clientUrl}/login?error=no_user`);
      }

      // Check if user has an id
      if (!req.user.id) {
        console.error("[AUTH] User object missing id:", req.user);
        const clientUrl = process.env.CLIENT_URL || "http://localhost:5173";
        return res.redirect(`${clientUrl}/login?error=invalid_user`);
      }

      // Generate JWT token
      const jwtSecret = process.env.JWT_SECRET;
      if (!jwtSecret) {
        console.error("[AUTH] JWT_SECRET not set in environment variables");
        const clientUrl = process.env.CLIENT_URL || "http://localhost:5173";
        return res.redirect(`${clientUrl}/login?error=server_config`);
      }

      const token = jwt.sign(
        { userId: req.user.id },
        jwtSecret,
        { expiresIn: "7d" }
      );

      // Redirect to frontend with token
      const clientUrl = process.env.CLIENT_URL || "http://localhost:5173";
      console.log("[AUTH] Successfully authenticated user:", req.user.id, "Redirecting to:", clientUrl);
      res.redirect(`${clientUrl}/auth/callback?token=${token}`);
    } catch (error) {
      console.error("[AUTH] Discord callback error:", error);
      console.error("[AUTH] Error stack:", error.stack);
      const clientUrl = process.env.CLIENT_URL || "http://localhost:5173";
      res.redirect(`${clientUrl}/login?error=token_generation_failed`);
    }
  }
);

// Return current user profile based on JWT
router.get("/profile", authenticateToken, async (req, res, next) => {
  try {
    const userId = req.userId;
    if (!userId || typeof userId !== "string") {
      return res.status(403).json({ error: "Invalid authentication" });
    }

    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: {
        id: true,
        username: true,
        email: true,
        avatarUrl: true,
        discordId: true,
      },
    });

    if (!user) {
      return res.status(404).json({ error: "User not found" });
    }

    res.json({ user });
  } catch (err) {
    const code = err && typeof err === "object" ? err.code : undefined;
    const name = err && typeof err === "object" ? err.name : undefined;
    if (typeof code === "string" && code.startsWith("P")) {
      console.error("[AUTH] /profile Prisma error:", code, err?.message);
      if (code === "P1001" || code === "P1017") {
        return res.status(503).json({ error: "Database temporarily unavailable" });
      }
    }
    if (name === "PrismaClientValidationError") {
      console.error("[AUTH] /profile Prisma validation:", err?.message);
      return res.status(400).json({ error: "Invalid request" });
    }
    next(err);
  }
});

export default router;

