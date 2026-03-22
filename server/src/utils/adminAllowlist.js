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
  const id = String(discordId).trim();
  return getAdminDiscordIdAllowlist().includes(id);
}

/**
 * Comma-separated Prisma User.id (JWT `userId`, cuid) in ADMIN_USER_IDS.
 * Bypasses Discord REST entirely — use when role checks are flaky after adding DiscordServer rows.
 */
export function getAdminUserIdAllowlist() {
  const raw = process.env.ADMIN_USER_IDS || "";
  return raw
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

export function isUserIdAdminAllowlisted(userId) {
  if (userId == null || userId === "") return false;
  const id = String(userId).trim();
  return getAdminUserIdAllowlist().includes(id);
}
