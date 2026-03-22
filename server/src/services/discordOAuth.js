import { resolveDiscordCallbackURL } from "../config/discordOAuthConfig.js";
import { upsertUserFromDiscordMe } from "./discordUserSync.js";

/** Discord asks for an identifiable User-Agent; Node's default is often blocked by Cloudflare. */
const DEFAULT_DISCORD_UA =
  "BUX-Poker/1.0 (+https://www.bux-poker.pro; Discord OAuth2 server)";

function withDiscordApiFetchInit(init = {}) {
  const headers = new Headers(init.headers);
  if (!headers.has("User-Agent")) {
    headers.set("User-Agent", process.env.DISCORD_API_USER_AGENT || DEFAULT_DISCORD_UA);
  }
  if (!headers.has("Accept")) {
    headers.set("Accept", "application/json");
  }
  return { ...init, headers };
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function isCloudflareOrHtmlChallenge(text) {
  if (!text || typeof text !== "string") return false;
  const t = text.slice(0, 4000);
  if (/^\s*<!doctype html/i.test(text)) return true;
  if (/cloudflare/i.test(t) && /cf-ray/i.test(t)) return true;
  if (/attention required.*cloudflare/i.test(t)) return true;
  return false;
}

/**
 * Cloudflare sometimes returns 429 with JSON problem details (e.g. error 1015) — same IP won't recover by retrying.
 * @see https://developers.cloudflare.com/support/troubleshooting/http-status-codes/cloudflare-1xxx-errors/error-1015/
 */
function isCloudflareJson1015OrEgressBlock(text) {
  if (!text || typeof text !== "string") return false;
  const s = text.trim();
  if (!s.startsWith("{")) return false;
  try {
    const j = JSON.parse(s);
    const type = String(j.type || "");
    const title = String(j.title || "");
    if (type.includes("error-1015") || type.includes("/1015")) return true;
    if (/1015/i.test(title) && /rate|cloudflare/i.test(title + type)) return true;
    return false;
  } catch {
    return false;
  }
}

/**
 * HTML challenge or JSON 1015 — not recoverable by backoff from this host.
 */
function throwIfDiscordBlockingResponse(status, bodyText, label) {
  if (isCloudflareOrHtmlChallenge(bodyText)) {
    const err = new Error(
      `Discord ${label}: blocked by edge (HTTP ${status} HTML page, not API JSON). Try again later or redeploy the API (new outbound IP).`
    );
    err.code = "DISCORD_CLOUDFLARE_BLOCK";
    err.statusCode = status;
    throw err;
  }
  if (isCloudflareJson1015OrEgressBlock(bodyText)) {
    const err = new Error(
      `Discord ${label}: Cloudflare 1015 (egress IP rate-limited). Retries from this server won't help — wait, use Manual Deploy on Render, or move API hosting.`
    );
    err.code = "DISCORD_CLOUDFLARE_BLOCK";
    err.statusCode = status;
    throw err;
  }
}

/**
 * Discord (and Cloudflare) may return 429 with a JSON body (retry) or HTML (edge block).
 */
async function fetchDiscordWithRetry(url, init, { maxAttempts = 4, label = "request" } = {}) {
  let lastStatus;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    const res = await fetch(url, withDiscordApiFetchInit(init));
    lastStatus = res.status;

    if (res.status !== 429) {
      return res;
    }

    const bodyText = await res.clone().text();
    throwIfDiscordBlockingResponse(res.status, bodyText, label);

    const retryAfterHeader = res.headers.get("retry-after");
    let waitMs = 0;
    if (retryAfterHeader) {
      const sec = Number(retryAfterHeader);
      if (!Number.isNaN(sec)) {
        waitMs = Math.min(15_000, Math.max(1000, sec * 1000));
      }
    }
    if (!waitMs) {
      waitMs = Math.min(10_000, 2000 * 2 ** (attempt - 1));
    }

    console.warn(
      `[AUTH] Discord ${label} returned 429 (attempt ${attempt}/${maxAttempts}), waiting ${waitMs}ms`,
      `body: ${bodyText.slice(0, 160)}`
    );

    if (attempt === maxAttempts) {
      const err = new Error(
        `Discord ${label} rate limited after ${maxAttempts} attempts (HTTP ${lastStatus})`
      );
      err.statusCode = 429;
      throw err;
    }

    await sleep(waitMs);
  }

  throw new Error(`Discord ${label}: unexpected retry loop exit`);
}

/**
 * Exchange OAuth authorization code for access_token (with limited retries on JSON 429).
 */
export async function exchangeDiscordOAuthCode(code) {
  const clientId = process.env.DISCORD_CLIENT_ID;
  const clientSecret = process.env.DISCORD_CLIENT_SECRET;
  if (!clientId || !clientSecret) {
    throw new Error("Discord OAuth is not configured");
  }

  const redirectUri = resolveDiscordCallbackURL();
  const body = new URLSearchParams({
    client_id: clientId,
    client_secret: clientSecret,
    grant_type: "authorization_code",
    code,
    redirect_uri: redirectUri,
  });

  const res = await fetchDiscordWithRetry(
    "https://discord.com/api/oauth2/token",
    {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: body.toString(),
    },
    { label: "token exchange" }
  );

  const rawText = await res.text();
  let data = {};
  try {
    data = rawText ? JSON.parse(rawText) : {};
  } catch {
    throwIfDiscordBlockingResponse(res.status, rawText, "token exchange");
    const err = new Error(`Discord token exchange: non-JSON response (${res.status})`);
    err.statusCode = res.status;
    throw err;
  }

  if (!res.ok) {
    const msg =
      data?.error_description ||
      data?.error ||
      (typeof data === "string" ? data : JSON.stringify(data));
    const err = new Error(`Discord token exchange failed: ${res.status} ${msg}`);
    err.statusCode = res.status;
    err.oauthBody = data;
    throw err;
  }

  if (!data.access_token) {
    throw new Error("Discord token response missing access_token");
  }

  return data.access_token;
}

/**
 * GET /users/@me with Bearer token (retries on JSON 429 only).
 */
export async function fetchDiscordMe(accessToken) {
  const res = await fetchDiscordWithRetry(
    "https://discord.com/api/users/@me",
    {
      headers: { Authorization: `Bearer ${accessToken}` },
    },
    { label: "users/@me" }
  );

  const rawText = await res.text();
  let discordUser = null;
  try {
    discordUser = rawText ? JSON.parse(rawText) : null;
  } catch {
    throwIfDiscordBlockingResponse(res.status, rawText, "users/@me");
    const err = new Error(`Discord users/@me: non-JSON (${res.status})`);
    err.statusCode = res.status;
    throw err;
  }

  if (!res.ok || !discordUser?.id) {
    const err = new Error(
      `Failed to fetch Discord profile: ${res.status} ${JSON.stringify(discordUser)}`
    );
    err.statusCode = res.status;
    throw err;
  }

  console.log("[DISCORD AUTH] Discord API @me:", {
    username: discordUser.username,
    global_name: discordUser.global_name,
    avatar: discordUser.avatar,
  });

  return discordUser;
}

/**
 * Full callback flow: code → token → @me → DB user.
 */
export async function completeDiscordOAuthFromCode(code) {
  const accessToken = await exchangeDiscordOAuthCode(code);
  const discordUser = await fetchDiscordMe(accessToken);
  return upsertUserFromDiscordMe(discordUser);
}
