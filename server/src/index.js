import dotenv from "dotenv";
import { app, server, io, PORT } from "./config/server.js";
import { registerSocketHandlers } from "./modules/socket-handlers/index.js";
import { initializeDiscordBot } from "./discord/bot.js";
import { startScheduledStartPoll, startIdleTablesPoll } from "./services/TournamentEngine.js";
import { connectRedis } from "./config/redis.js";

dotenv.config();

registerSocketHandlers(io);

// Poll for tournaments whose 2-min start time has passed (survives process restart)
startScheduledStartPoll();
startIdleTablesPoll();

// Initialize Discord bot (non-blocking)
initializeDiscordBot().catch((err) => {
  console.error("[DISCORD BOT] Failed to initialize:", err);
});

async function start() {
  if (process.env.REDIS_URL) {
    await connectRedis().catch((err) => {
      console.warn("[REDIS] Session store unavailable, using memory:", err?.message);
    });
  }
  server.listen(PORT, () => {
    // eslint-disable-next-line no-console
    console.log(`BUX Poker server listening on port ${PORT}`);
  });
}
start();

