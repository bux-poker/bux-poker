import { initializeDiscordBot } from "./bot.js";

const DISCORD_INIT_TIMEOUT_MS = Number(process.env.DISCORD_INIT_TIMEOUT_MS || 50000);
const DISCORD_INIT_RETRY_MS = Number(process.env.DISCORD_INIT_RETRY_MS || 15000);

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** True unless DISCORD_BOT_ENABLED is 0/false/no (default: run loop). */
export function isDiscordBotLoopEnabled() {
  const v = process.env.DISCORD_BOT_ENABLED;
  if (v === undefined || v === "") return true;
  return v !== "0" && v !== "false" && v !== "no";
}

/**
 * Retries until the Discord gateway client is logged in.
 * On hosts whose egress IP is blocked by Cloudflare/Discord, this never succeeds — disable via DISCORD_BOT_ENABLED=false.
 */
export async function ensureDiscordBotOnlineLoop() {
  while (true) {
    try {
      const bot = await Promise.race([
        initializeDiscordBot(),
        sleep(DISCORD_INIT_TIMEOUT_MS).then(() => null),
      ]);
      if (bot) {
        console.log("[DISCORD BOT] Online");
        return;
      }
      console.warn(
        `[DISCORD BOT] Init did not complete within ${DISCORD_INIT_TIMEOUT_MS}ms; retrying in ${DISCORD_INIT_RETRY_MS}ms`
      );
    } catch (err) {
      console.error("[DISCORD BOT] Failed to initialize:", err);
    }
    await sleep(DISCORD_INIT_RETRY_MS);
  }
}
