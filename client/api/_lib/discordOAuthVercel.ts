/**
 * Discord OAuth helpers for Vercel serverless (token exchange uses Vercel egress IP, not Render).
 */
import type { VercelRequest } from "@vercel/node";
import { createId } from "@paralleldrive/cuid2";
import jwt from "jsonwebtoken";
import { Pool } from "pg";

const DEFAULT_UA = "BUX-Poker-Vercel/1.0 (+https://www.bux-poker.pro; OAuth2)";

export function getDiscordCallbackUrl(req: VercelRequest): string {
  const explicit = process.env.DISCORD_VERCEL_CALLBACK_URL?.trim().replace(/\/+$/, "");
  if (explicit) return explicit;
  const host =
    (req.headers["x-forwarded-host"] as string) || req.headers.host || "";
  const proto = (req.headers["x-forwarded-proto"] as string) || "https";
  // Path is NOT under /api — many domains proxy /api/* to Render; /oauth/* stays on Vercel.
  if (host) {
    return `${proto}://${host.split(",")[0].trim()}/oauth/discord/callback`;
  }
  if (process.env.VERCEL_URL) {
    return `https://${process.env.VERCEL_URL}/oauth/discord/callback`;
  }
  throw new Error("Cannot resolve Discord callback URL (no Host header or VERCEL_URL)");
}

function isLocalHostname(host: string): boolean {
  const h = host.split(":")[0]?.toLowerCase() || "";
  return h === "localhost" || h === "127.0.0.1" || h === "[::1]";
}

function isLocalOriginUrl(url: string): boolean {
  try {
    return isLocalHostname(new URL(url).hostname);
  } catch {
    return false;
  }
}

/**
 * Where to send the browser after OAuth. Uses CLIENT_URL when it is a non-local URL.
 * If CLIENT_URL is missing or still set to localhost (common bad copy from .env), uses the
 * request Host so production logins return to www.bux-poker.pro instead of :5173.
 */
export function getClientUrl(req?: VercelRequest): string {
  const fromEnv = (process.env.CLIENT_URL || "").replace(/\/+$/, "");
  if (fromEnv && !isLocalOriginUrl(fromEnv)) return fromEnv;

  if (req) {
    const raw =
      (req.headers["x-forwarded-host"] as string) || req.headers.host || "";
    const host = raw.split(",")[0]?.trim() || "";
    const proto = (req.headers["x-forwarded-proto"] as string) || "https";
    if (host && !isLocalHostname(host)) {
      return `${proto}://${host}`;
    }
  }

  if (process.env.VERCEL_URL) {
    return `https://${process.env.VERCEL_URL}`.replace(/\/+$/, "");
  }

  return fromEnv || "https://bux-poker-puce.vercel.app";
}

let pool: Pool | null = null;

function getPool(): Pool {
  if (!pool) {
    const url = process.env.DATABASE_URL;
    if (!url) throw new Error("DATABASE_URL not set");
    pool = new Pool({ connectionString: url, max: 1 });
  }
  return pool;
}

export async function upsertDiscordUser(params: {
  discordId: string;
  username: string;
  avatarUrl: string;
  discordOAuthAccessToken: string;
  discordOAuthAccessExpiresAt: Date;
}): Promise<{ id: string }> {
  const { discordId, username, avatarUrl, discordOAuthAccessToken, discordOAuthAccessExpiresAt } =
    params;
  const newId = createId();
  const p = getPool();
  const r = await p.query<{ id: string }>(
    `INSERT INTO "User" (id, "discordId", username, "avatarUrl", "discordOAuthAccessToken", "discordOAuthAccessExpiresAt", "createdAt", "updatedAt")
     VALUES ($1, $2, $3, $4, $5, $6, NOW(), NOW())
     ON CONFLICT ("discordId") DO UPDATE
     SET username = EXCLUDED.username,
         "avatarUrl" = EXCLUDED."avatarUrl",
         "discordOAuthAccessToken" = EXCLUDED."discordOAuthAccessToken",
         "discordOAuthAccessExpiresAt" = EXCLUDED."discordOAuthAccessExpiresAt",
         "updatedAt" = NOW()
     RETURNING id`,
    [newId, discordId, username, avatarUrl, discordOAuthAccessToken, discordOAuthAccessExpiresAt]
  );
  if (!r.rows[0]?.id) throw new Error("User upsert returned no id");
  return { id: r.rows[0].id };
}

function isBlocking429Body(text: string): boolean {
  if (!text) return false;
  if (/^\s*<!doctype html/i.test(text)) return true;
  try {
    const j = JSON.parse(text) as Record<string, unknown>;
    const msg = String(j.message || "");
    const type = String(j.type || "");
    const title = String(j.title || "");
    if (/exceeding global rate limit/i.test(msg)) return true;
    if (/blocked from accessing our API temporarily/i.test(msg)) return true;
    if (type.includes("error-1015") || type.includes("/1015")) return true;
    if (/1015/i.test(title) && /rate|cloudflare/i.test(title + type)) return true;
    return false;
  } catch {
    return false;
  }
}

export async function exchangeDiscordCode(
  code: string,
  redirectUri: string
): Promise<{ access_token: string; expires_in?: number }> {
  const clientId = process.env.DISCORD_CLIENT_ID;
  const clientSecret = process.env.DISCORD_CLIENT_SECRET;
  if (!clientId || !clientSecret) throw new Error("Discord OAuth not configured");

  const body = new URLSearchParams({
    client_id: clientId,
    client_secret: clientSecret,
    grant_type: "authorization_code",
    code,
    redirect_uri: redirectUri,
  });

  const res = await fetch("https://discord.com/api/oauth2/token", {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      "User-Agent": process.env.DISCORD_API_USER_AGENT || DEFAULT_UA,
      Accept: "application/json",
    },
    body: body.toString(),
  });

  const text = await res.text();
  if (res.status === 429 && isBlocking429Body(text)) {
    const err = new Error("Discord token exchange blocked (429) from this path") as Error & {
      code: string;
    };
    err.code = "DISCORD_CLOUDFLARE_BLOCK";
    throw err;
  }
  let data: {
    access_token?: string;
    expires_in?: number;
    error?: string;
    error_description?: string;
  } = {};
  try {
    data = text ? JSON.parse(text) : {};
  } catch {
    throw new Error(`Discord token exchange: non-JSON (${res.status})`);
  }
  if (!res.ok) {
    const msg = data.error_description || data.error || text.slice(0, 200);
    throw new Error(`Discord token exchange failed: ${res.status} ${msg}`);
  }
  if (!data.access_token) throw new Error("Discord token response missing access_token");
  return {
    access_token: data.access_token,
    expires_in: typeof data.expires_in === "number" ? data.expires_in : undefined,
  };
}

export async function fetchDiscordMe(accessToken: string): Promise<{
  id: string;
  username: string;
  global_name?: string | null;
  avatar: string | null;
}> {
  const res = await fetch("https://discord.com/api/users/@me", {
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "User-Agent": process.env.DISCORD_API_USER_AGENT || DEFAULT_UA,
      Accept: "application/json",
    },
  });
  const text = await res.text();
  if (res.status === 429 && isBlocking429Body(text)) {
    const err = new Error("Discord @me blocked (429)") as Error & { code: string };
    err.code = "DISCORD_CLOUDFLARE_BLOCK";
    throw err;
  }
  const discordUser = text ? JSON.parse(text) : null;
  if (!res.ok || !discordUser?.id) {
    throw new Error(`Discord @me failed: ${res.status} ${text.slice(0, 200)}`);
  }
  return discordUser;
}

export function signSessionJwt(userId: string): string {
  const secret = process.env.JWT_SECRET;
  if (!secret) throw new Error("JWT_SECRET not set");
  return jwt.sign({ userId }, secret, { expiresIn: "7d" });
}

export async function completeDiscordOAuthFromCode(
  code: string,
  redirectUri: string
): Promise<{ id: string }> {
  const tokenRes = await exchangeDiscordCode(code, redirectUri);
  const accessToken = tokenRes.access_token;
  const expiresAt =
    typeof tokenRes.expires_in === "number" && Number.isFinite(tokenRes.expires_in)
      ? new Date(Date.now() + tokenRes.expires_in * 1000)
      : new Date(Date.now() + 7 * 24 * 3600 * 1000);
  const discordUser = await fetchDiscordMe(accessToken);
  const nickname = discordUser.global_name || discordUser.username;
  const avatarUrl = discordUser.avatar
    ? `https://cdn.discordapp.com/avatars/${discordUser.id}/${discordUser.avatar}.png`
    : "/default-pfp.jpg";
  return upsertDiscordUser({
    discordId: String(discordUser.id),
    username: nickname,
    avatarUrl,
    discordOAuthAccessToken: accessToken,
    discordOAuthAccessExpiresAt: expiresAt,
  });
}
