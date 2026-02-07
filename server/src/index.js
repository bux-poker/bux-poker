import dotenv from "dotenv";
import { app, server, io, PORT } from "./config/server.js";
import { registerSocketHandlers } from "./modules/socket-handlers/index.js";
import { initializeDiscordBot } from "./discord/bot.js";
import { startScheduledStartPoll } from "./services/TournamentEngine.js";

dotenv.config();

registerSocketHandlers(io);

// Poll for tournaments whose 2-min start time has passed (survives process restart)
startScheduledStartPoll();

// Initialize Discord bot (non-blocking)
initializeDiscordBot().catch((err) => {
  console.error("[DISCORD BOT] Failed to initialize:", err);
});

server.listen(PORT, () => {
  // eslint-disable-next-line no-console
  console.log(`BUX Poker server listening on port ${PORT}`);
});

