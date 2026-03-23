import crypto from "crypto";
import { Router } from "express";
import passport from "../config/passport.js";
import { authenticateToken } from "../middleware/auth.js";
import { prisma } from "../config/database.js";
import jwt from "jsonwebtoken";
import { completeDiscordOAuthFromCode } from "../services/discordOAuth.js";
import {
  computeWebIsAdmin,
  emergencyStampWebAdminForSessionUser,
} from "../utils/webAdminStatus.js";

const router = Router();

// Discord OAuth routes
router.get(
  "/discord",
  passport.authenticate("discord", { scope: ["identify", "email", "guilds", "guilds.members.read"] })
);

/**
 * Callback uses manual token exchange + retries on HTTP 429 (Discord / Cloudflare 1015 on shared hosts).
 * Passport still handles the initial /discord redirect.
 */
router.get("/discord/callback", async (req, res) => {
  const clientUrl = process.env.CLIENT_URL || "http://localhost:5173";

  if (req.query.error) {
    console.error(
      "[AUTH] Discord OAuth error query:",
      req.query.error,
      req.query.error_description
    );
    return res.redirect(`${clientUrl}/login?error=discord_auth_failed`);
  }

  const code = req.query.code;
  if (!code || typeof code !== "string") {
    console.error("[AUTH] Discord callback missing ?code=");
    return res.redirect(`${clientUrl}/login?error=discord_auth_failed`);
  }

  try {
    const user = await completeDiscordOAuthFromCode(code);

    if (!user?.id) {
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
    console.error("[AUTH] Discord OAuth callback failed:", error?.message);
    if (error?.oauthBody) {
      console.error("[AUTH] Discord token response body:", error.oauthBody);
    }
    const errKey =
      error?.code === "DISCORD_CLOUDFLARE_BLOCK"
        ? "discord_cloudflare"
        : "discord_auth_failed";
    return res.redirect(`${clientUrl}/login?error=${errKey}`);
  }
});

/**
 * Discord global 429 from your host cannot be fixed in code. This stamps `webAdminVerifiedAt` + proof hash
 * for the **current JWT user** so `isAdmin` succeeds via DB trust (no Discord HTTP).
 *
 * Render: set WEB_ADMIN_BOOTSTRAP_SECRET (≥24 chars). Then once (curl or REST client):
 *   POST https://<api>/api/auth/emergency-web-admin-stamp
 *   Headers: Authorization: Bearer <sessionToken>, X-Web-Admin-Bootstrap: <same secret>
 * Remove the env var after you recover.
 */
router.post("/emergency-web-admin-stamp", authenticateToken, async (req, res) => {
  try {
    const secret = (process.env.WEB_ADMIN_BOOTSTRAP_SECRET || "").trim();
    if (!secret || secret.length < 24) {
      return res.status(404).json({ error: "Not found" });
    }
    const header = String(req.get("x-web-admin-bootstrap") || "").trim();
    if (header.length !== secret.length) {
      return res.status(403).json({ error: "Forbidden" });
    }
    let match = false;
    try {
      match = crypto.timingSafeEqual(Buffer.from(header, "utf8"), Buffer.from(secret, "utf8"));
    } catch {
      match = false;
    }
    if (!match) {
      return res.status(403).json({ error: "Forbidden" });
    }

    const userId = req.userId;
    const stamp = await emergencyStampWebAdminForSessionUser(userId);
    if (!stamp.ok && stamp.error === "discord_required") {
      return res.status(400).json({ error: "Discord-linked account required" });
    }
    if (stamp.alreadyOpen) {
      return res.json({ ok: true, message: "No Discord servers configured — admin gate already open" });
    }

    console.warn("[AUTH] Emergency webAdmin DB proof stamped for userId", userId);

    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { discordId: true },
    });
    const isAdmin = await computeWebIsAdmin({ userId, discordId: user?.discordId ?? null });
    return res.json({ ok: true, isAdmin });
  } catch (err) {
    console.error("[AUTH] emergency-web-admin-stamp:", err?.message || err);
    return res.status(500).json({ error: "Server error" });
  }
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

    const isAdmin = await computeWebIsAdmin({ userId, discordId: user.discordId });
    res.setHeader("Cache-Control", "private, no-store, no-cache, must-revalidate");
    res.json({ user: { ...user, isAdmin } });
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

