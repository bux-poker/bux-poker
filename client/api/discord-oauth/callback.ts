import type { VercelRequest, VercelResponse } from "@vercel/node";
import {
  completeDiscordOAuthFromCode,
  getClientUrl,
  getDiscordCallbackUrl,
  signSessionJwt,
} from "../_lib/discordOAuthVercel";

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== "GET") {
    res.status(405).setHeader("Allow", "GET").end("Method Not Allowed");
    return;
  }

  const clientUrl = getClientUrl();

  if (req.query.error) {
    console.error("[AUTH][Vercel] Discord error query:", req.query.error, req.query.error_description);
    res.redirect(302, `${clientUrl}/login?error=discord_auth_failed`);
    return;
  }

  const code = req.query.code;
  if (!code || typeof code !== "string") {
    console.error("[AUTH][Vercel] Missing code");
    res.redirect(302, `${clientUrl}/login?error=discord_auth_failed`);
    return;
  }

  try {
    const redirectUri = getDiscordCallbackUrl(req);
    const user = await completeDiscordOAuthFromCode(code, redirectUri);
    const token = signSessionJwt(user.id);
    console.log("[AUTH][Vercel] OK user", user.id);
    res.redirect(302, `${clientUrl}/auth/callback?token=${encodeURIComponent(token)}`);
  } catch (e: unknown) {
    const err = e as { message?: string; code?: string };
    console.error("[AUTH][Vercel] callback failed:", err?.message);
    const key = err?.code === "DISCORD_CLOUDFLARE_BLOCK" ? "discord_cloudflare" : "discord_auth_failed";
    res.redirect(302, `${clientUrl}/login?error=${key}`);
  }
}
