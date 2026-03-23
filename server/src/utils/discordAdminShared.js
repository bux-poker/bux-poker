/**
 * Shared admin-check rate limit state (bot REST + user OAuth hit the same Discord global limits).
 */

export const DISCORD_ADMIN_CHECK_RATE_LIMITED = Symbol("DISCORD_ADMIN_CHECK_RATE_LIMITED");

let discordAdminGlobalBackoffUntil = 0;

export function isDiscordGlobal429Body(text) {
  if (!text || typeof text !== "string") return false;
  return /global rate limit|blocked from accessing our api temporarily|exceeding global rate limit/i.test(
    text
  );
}

export function scheduleDiscordAdminGlobalBackoff() {
  const backoffMs = Math.min(
    600_000,
    Math.max(45_000, Number(process.env.DISCORD_ADMIN_GLOBAL_BACKOFF_MS) || 120_000)
  );
  const next = Date.now() + backoffMs;
  if (next > discordAdminGlobalBackoffUntil) {
    discordAdminGlobalBackoffUntil = next;
    console.warn(
      `[discordAdmin] Global Discord 429 — pausing admin API (bot + user OAuth) ~${Math.round(backoffMs / 1000)}s`
    );
  }
}

export function isDiscordAdminGlobalBackoffActive() {
  return Date.now() < discordAdminGlobalBackoffUntil;
}
