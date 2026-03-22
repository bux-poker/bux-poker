import { prisma } from "../config/database.js";

/**
 * Create or update app user from Discord GET /users/@me JSON.
 * @param {object} discordUser - { id, username, global_name?, avatar }
 */
export async function upsertUserFromDiscordMe(discordUser) {
  const profileId = String(discordUser.id);
  const currentNickname = discordUser.global_name || discordUser.username;
  const currentAvatar = discordUser.avatar;

  const avatarUrl = currentAvatar
    ? `https://cdn.discordapp.com/avatars/${profileId}/${currentAvatar}.png`
    : "/default-pfp.jpg";

  let user = await prisma.user.findUnique({
    where: { discordId: profileId },
  });

  if (!user) {
    user = await prisma.user.create({
      data: {
        discordId: profileId,
        username: currentNickname,
        avatarUrl,
      },
    });
    console.log("[DISCORD AUTH] New user created:", user.id);
  } else {
    user = await prisma.user.update({
      where: { id: user.id },
      data: {
        username: currentNickname,
        avatarUrl,
      },
    });
    console.log("[DISCORD AUTH] Existing user updated:", user.id);
  }

  return user;
}
