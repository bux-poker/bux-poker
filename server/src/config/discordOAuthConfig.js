/** Must match Discord Developer Portal → OAuth2 → Redirects exactly (no double slashes). */
export function resolveDiscordCallbackURL() {
  const explicit = process.env.DISCORD_CALLBACK_URL?.trim();
  if (explicit) {
    return explicit.replace(/\/+$/, "");
  }
  const base = (process.env.API_BASE_URL || "http://localhost:3000")
    .trim()
    .replace(/\/+$/, "");
  return `${base}/api/auth/discord/callback`;
}
