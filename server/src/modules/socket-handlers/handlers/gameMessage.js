/**
 * Register the game_message socket handler (broadcast to room).
 */
export function registerGameMessage(socket, io) {
  socket.on("game_message", async ({ gameId, message }) => {
    try {
      io.to(`game:${gameId}`).emit("game_message", { gameId, message });
    } catch (err) {
      console.error("game_message error", err);
      socket.emit("error", { message: "Failed to send message" });
    }
  });
}
