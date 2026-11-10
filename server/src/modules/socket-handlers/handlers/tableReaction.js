const ALLOWED = new Set(["sad", "angry", "celebrate", "snore", "shit", "love", "cool"]);
const EMOJI_BY_ID = {
  sad: "😢",
  angry: "😠",
  celebrate: "🎉",
  snore: "😴",
  shit: "💩",
  love: "❤️",
  cool: "😎",
};

const lastBySocket = new Map(); // socketId -> ms
const RATE_MS = 250;

/**
 * Broadcast table emoji reactions (self-bounce or throw) to the game room.
 * Also supports join-table-test for the /table-test harness.
 */
export function registerTableReaction(socket, io) {
  socket.on("join-table-test", ({ gameId, userId } = {}) => {
    try {
      const gid = gameId === "table-test" ? "table-test" : null;
      if (!gid) return;
      if (userId) socket.data.userId = String(userId);
      for (const room of socket.rooms) {
        if (room.startsWith("game:") && room !== `game:${gid}`) {
          socket.leave(room);
        }
      }
      socket.join(`game:${gid}`);
    } catch (err) {
      console.error("join-table-test error", err?.message || err);
    }
  });

  socket.on("table-reaction", (payload = {}) => {
    try {
      const now = Date.now();
      const prev = lastBySocket.get(socket.id) || 0;
      if (now - prev < RATE_MS) return;
      lastBySocket.set(socket.id, now);

      const gameId = typeof payload.gameId === "string" ? payload.gameId.trim() : "";
      if (!gameId) return;
      if (!socket.rooms.has(`game:${gameId}`)) {
        // Soft join if client forgot (table-test / reconnect races)
        socket.join(`game:${gameId}`);
      }

      const emojiId = String(payload.emojiId || "");
      if (!ALLOWED.has(emojiId)) return;
      const kind = payload.kind === "throw" ? "throw" : "self";
      const fromUserId = String(
        payload.fromUserId || socket.data.userId || ""
      ).trim();
      const toUserId = String(payload.toUserId || fromUserId || "").trim();
      if (!fromUserId || !toUserId) return;

      const event = {
        id:
          typeof payload.id === "string" && payload.id.length > 0
            ? payload.id
            : `rx-${now}-${Math.random().toString(36).slice(2, 8)}`,
        gameId,
        emoji: EMOJI_BY_ID[emojiId],
        emojiId,
        kind,
        fromUserId,
        toUserId,
        createdAt: now,
      };

      io.to(`game:${gameId}`).emit("table-reaction", event);
    } catch (err) {
      console.error("table-reaction error", err?.message || err);
    }
  });
}
