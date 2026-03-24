/**
 * Tournament standings ordering — keep in sync with TournamentLobbyModal player list.
 */

type MergedPlayer = {
  userId: string;
  chips: number;
  status: string;
  finishingPlace: number | null;
  positionField: number | null;
};

export function ordinalSuffix(n: number): string {
  if (n === 1) return "1st";
  if (n === 2) return "2nd";
  if (n === 3) return "3rd";
  return `${n}th`;
}

export function mergeTournamentPlayersWithLiveGameState(
  tournamentPlayers: any[],
  gameState: {
    players?: Array<{ userId?: string; chips?: number; status?: string }>;
  } | null
): MergedPlayer[] {
  const rows: MergedPlayer[] = tournamentPlayers.map((p: any) => ({
    userId: String(p.userId ?? ""),
    chips: p.chips ?? 0,
    status: String(p.status ?? ""),
    finishingPlace: typeof p.finishingPlace === "number" ? p.finishingPlace : null,
    positionField: typeof p.position === "number" ? p.position : null,
  }));

  if (!gameState?.players?.length) return rows;

  return rows.map((p) => {
    const live = gameState.players!.find(
      (gp) => String(gp.userId ?? "") === p.userId
    );
    if (live && live.chips !== undefined) {
      return {
        ...p,
        chips: live.chips,
        status: String(live.status ?? p.status),
      };
    }
    return p;
  });
}

export function orderTournamentPlayersForStandings(merged: MergedPlayer[]): MergedPlayer[] {
  const activeWithChips = merged.filter(
    (p) => p.status !== "ELIMINATED" && (p.chips ?? 0) > 0
  );
  const allIn = merged.filter(
    (p) => p.status !== "ELIMINATED" && (p.chips ?? 0) === 0
  );
  const eliminated = merged.filter((p) => p.status === "ELIMINATED");
  activeWithChips.sort((a, b) => (b.chips ?? 0) - (a.chips ?? 0));
  eliminated.sort(
    (a, b) =>
      (a.finishingPlace ?? a.positionField ?? 999) -
      (b.finishingPlace ?? b.positionField ?? 999)
  );
  return [...activeWithChips, ...allIn, ...eliminated];
}

export function getMyTournamentStanding(
  tournament: { players?: any[] } | null,
  gameState: {
    players?: Array<{ userId?: string; chips?: number; status?: string }>;
  } | null,
  userId: string | undefined
): { place: number | null; total: number } {
  if (!tournament?.players || !Array.isArray(tournament.players) || !userId) {
    return { place: null, total: 0 };
  }
  const uid = String(userId);
  const merged = mergeTournamentPlayersWithLiveGameState(tournament.players, gameState);
  const ordered = orderTournamentPlayersForStandings(merged);
  const idx = ordered.findIndex((p) => p.userId === uid);
  if (idx < 0) {
    return { place: null, total: ordered.length };
  }
  const me = ordered[idx];
  if (me.status === "ELIMINATED") {
    const p = me.finishingPlace ?? me.positionField;
    return { place: p ?? null, total: ordered.length };
  }
  return { place: idx + 1, total: ordered.length };
}
