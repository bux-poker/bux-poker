import passport from "passport";
import { Strategy as DiscordStrategy } from "passport-discord";
import { resolveDiscordCallbackURL } from "./discordOAuthConfig.js";
import { prisma } from "./database.js";
import { upsertUserFromDiscordMe } from "../services/discordUserSync.js";

export { resolveDiscordCallbackURL } from "./discordOAuthConfig.js";

// Only initialize Discord strategy if credentials are provided
if (process.env.DISCORD_CLIENT_ID && process.env.DISCORD_CLIENT_SECRET) {
  const callbackURL = resolveDiscordCallbackURL();
  console.log('[PASSPORT] Discord OAuth callback URL:', callbackURL);

  passport.use(new DiscordStrategy({
    clientID: process.env.DISCORD_CLIENT_ID,
    clientSecret: process.env.DISCORD_CLIENT_SECRET,
    callbackURL,
    scope: ['identify', 'email']
  }, async (accessToken, refreshToken, profile, done) => {
    try {
      console.log("[DISCORD AUTH] Profile data:", {
        id: profile.id,
        username: profile.username,
        avatar: profile.avatar,
      });

      const discordUserResponse = await fetch("https://discord.com/api/users/@me", {
        headers: { Authorization: `Bearer ${accessToken}` },
      });

      if (!discordUserResponse.ok) {
        console.log(
          "[DISCORD AUTH] Failed to fetch Discord user data:",
          discordUserResponse.status
        );
        const fallback = {
          id: profile.id,
          username: profile.username,
          global_name: undefined,
          avatar: profile.avatar,
        };
        const user = await upsertUserFromDiscordMe(fallback);
        return done(null, user);
      }

      const discordUser = await discordUserResponse.json();
      const user = await upsertUserFromDiscordMe(discordUser);
      return done(null, user);
    } catch (error) {
      console.error("[DISCORD AUTH] Error in passport strategy:", error);
      console.error("[DISCORD AUTH] Error stack:", error.stack);
      return done(error, null);
    }
  }));
} else {
  console.log('[PASSPORT] Discord OAuth not configured - skipping DiscordStrategy');
}


// Serialize user for session
passport.serializeUser((user, done) => {
  done(null, user.id);
});

// Deserialize user from session
passport.deserializeUser(async (id, done) => {
  try {
    const user = await prisma.user.findUnique({
      where: { id }
    });
    done(null, user);
  } catch (error) {
    done(error, null);
  }
});

export default passport;
