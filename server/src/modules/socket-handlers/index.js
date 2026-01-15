import { registerPokerHandlers } from "./pokerHandler.js";

export function registerSocketHandlers(io) {
  registerPokerHandlers(io);
}

