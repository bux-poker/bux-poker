/**
 * Register the disconnect socket handler.
 */
export function registerDisconnect(socket) {
  socket.on("disconnect", () => {
    console.log("Poker client disconnected", socket.id);
  });
}
