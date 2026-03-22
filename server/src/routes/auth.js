import { Router } from "express";
import passport from "../config/passport.js";
import { authenticateToken } from "../middleware/auth.js";
import { prisma } from "../config/database.js";
import jwt from "jsonwebtoken";

const router = Router();

// Discord OAuth routes
router.get("/discord", passport.authenticate("discord", { scope: ["identify", "email"] }));

// Passport authenticate() must receive (req, res, next) — omitting `next` breaks the OAuth2 strategy.
router.get("/discord/callback", (req, res, next) => {
  const clientUrl = process.env.CLIENT_URL || "http://localhost:5173";

  passport.authenticate("discord", { session: false }, (err, user, info) => {
    if (err) {
      console.error("[AUTH] Discord token exchange failed:", err.message);
      if (err.oauthError) {
        console.error(
          "[AUTH] Discord oauthError:",
          err.oauthError.statusCode,
          err.oauthError.data
        );
      }
      return res.redirect(`${clientUrl}/login?error=discord_auth_failed`);
    }
    if (!user) {
      console.error("[AUTH] Discord callback: no user", info);
      return res.redirect(`${clientUrl}/login?error=discord_auth_failed`);
    }

    try {
      if (!user.id) {
        console.error("[AUTH] User object missing id:", user);
        return res.redirect(`${clientUrl}/login?error=invalid_user`);
      }

      const jwtSecret = process.env.JWT_SECRET;
      if (!jwtSecret) {
        console.error("[AUTH] JWT_SECRET not set in environment variables");
        return res.redirect(`${clientUrl}/login?error=server_config`);
      }

      const token = jwt.sign({ userId: user.id }, jwtSecret, { expiresIn: "7d" });
      console.log(
        "[AUTH] Successfully authenticated user:",
        user.id,
        "Redirecting to:",
        clientUrl
      );
      return res.redirect(`${clientUrl}/auth/callback?token=${token}`);
    } catch (error) {
      console.error("[AUTH] Discord callback error:", error);
      return res.redirect(`${clientUrl}/login?error=token_generation_failed`);
    }
  })(req, res, next);
});

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

