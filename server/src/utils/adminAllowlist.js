/**
 * Comma-separated Discord user snowflakes in ADMIN_DISCORD_IDS (Render env).
 * These users always pass admin check (panel + API) even if the bot is down
 * or Discord role sync fails.
 */
export function getAdminDiscordIdAllowlist() {
  const raw = process.env.ADMIN_DISCORD_IDS || "";
  return raw
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

export function isDiscordIdAdminAllowlisted(discordId) {
  if (discordId == null || discordId === "") return false;
  const id = String(discordId);
  return getAdminDiscordIdAllowlist().includes(id);
}
