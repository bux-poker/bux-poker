/**
 * Register the disconnect socket handler.
 */
export function registerDisconnect(socket) {
  socket.on("disconnect", (reason) => {
    console.log("Poker client disconnected", socket.id, "reason:", reason);
  });
}
