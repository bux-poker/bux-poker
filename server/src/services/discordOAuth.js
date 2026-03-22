import { resolveDiscordCallbackURL } from "../config/discordOAuthConfig.js";
import { upsertUserFromDiscordMe } from "./discordUserSync.js";

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

/**
 * Discord (and Cloudflare) often return 429 with code 1015 from shared host IPs.
 * Retry with backoff and optional Retry-After header.
 */
async function fetchDiscordWithRetry(url, init, { maxAttempts = 4, label = "request" } = {}) {
  let lastStatus;
  let lastBodySnippet = "";

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    const res = await fetch(url, init);
    lastStatus = res.status;

    if (res.status !== 429) {
      return res;
    }

    const retryAfterHeader = res.headers.get("retry-after");
    let waitMs = 0;
    if (retryAfterHeader) {
      const sec = Number(retryAfterHeader);
      if (!Number.isNaN(sec)) {
        // Cap so the browser does not appear "stuck" for many minutes on Authorize
        waitMs = Math.min(15_000, Math.max(1000, sec * 1000));
      }
    }
    if (!waitMs) {
      waitMs = Math.min(10_000, 2000 * 2 ** (attempt - 1));
    }

    try {
      const text = await res.clone().text();
      lastBodySnippet = text.slice(0, 200);
    } catch {
      lastBodySnippet = "";
    }

    console.warn(
      `[AUTH] Discord ${label} returned 429 (attempt ${attempt}/${maxAttempts}), waiting ${waitMs}ms`,
      lastBodySnippet ? `body: ${lastBodySnippet}` : ""
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
 * Exchange OAuth authorization code for access_token (with retries on 429).
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

  const data = await res.json().catch(() => ({}));

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
 * GET /users/@me with Bearer token (retries on 429).
 */
export async function fetchDiscordMe(accessToken) {
  const res = await fetchDiscordWithRetry(
    "https://discord.com/api/users/@me",
    {
      headers: { Authorization: `Bearer ${accessToken}` },
    },
    { label: "users/@me" }
  );

  const discordUser = await res.json().catch(() => null);
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
