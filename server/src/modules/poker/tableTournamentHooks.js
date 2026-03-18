import { prisma } from "../../config/database.js";

export async function emitIfTournamentCompleted(tournamentId, io) {
  if (!tournamentId || !io) return;
  try {
    const { TournamentEngine } = await import("../../services/TournamentEngine.js");
    await new TournamentEngine().completeTournamentIfOneLeft(tournamentId);
    const t = await prisma.tournament.findUnique({
      where: { id: tournamentId },
      select: { status: true },
    });
    if (t?.status === "COMPLETED") {
      io.emit("tournament_completed", { tournamentId });
      console.log(
        `[POKER] Emitted tournament_completed for tournament ${tournamentId} (broadcast to all clients)`
      );
    }
  } catch (err) {
    console.error("[POKER] Error in emitIfTournamentCompleted:", err);
  }
}

