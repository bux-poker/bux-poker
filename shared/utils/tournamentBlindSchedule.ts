/**
 * Client/server-aligned blind schedule math (must match server getTournamentBlindLevelFromTime).
 * Durations are in minutes; times are in milliseconds.
 */

export type BlindLevelRow = {
  level?: number;
  smallBlind?: number;
  bigBlind?: number;
  duration: number | null | undefined;
  breakAfter?: number | null;
};

export type BlindScheduleInfo = {
  currentLevelIndex: number;
  /** Milliseconds remaining until the next blind level starts (0 at boundary). */
  msUntilNextLevel: number | null;
  /** True when the structure has no further timed level after the current one. */
  atLastLevel: boolean;
};

/**
 * Compute current level index and ms until the next level boundary from elapsed time.
 * Mirrors server/src/services/tournament/blindLevels.js getTournamentBlindLevelFromTime.
 */
export function getBlindScheduleFromElapsedMs(
  elapsedMs: number,
  blindLevels: BlindLevelRow[]
): BlindScheduleInfo | null {
  if (!blindLevels.length || elapsedMs < 0) return null;

  let elapsedMinutes = elapsedMs / 1000 / 60;
  let currentLevelIndex = 0;

  for (let i = 0; i < blindLevels.length; i++) {
    const level = blindLevels[i];
    if (level.duration == null || level.duration === undefined) {
      currentLevelIndex = i;
      return {
        currentLevelIndex,
        msUntilNextLevel: null,
        atLastLevel: true,
      };
    }
    const levelMinutes = Number(level.duration);
    const dur =
      Number.isFinite(levelMinutes) && levelMinutes >= 0 ? levelMinutes : 0;

    if (elapsedMinutes <= dur) {
      currentLevelIndex = i;
      const remainingMin = dur - elapsedMinutes;
      const hasNext = i + 1 < blindLevels.length;
      return {
        currentLevelIndex,
        msUntilNextLevel: hasNext ? Math.max(0, remainingMin * 60 * 1000) : null,
        atLastLevel: !hasNext,
      };
    }
    elapsedMinutes -= dur;
    const breakMins = level.breakAfter != null ? Number(level.breakAfter) : 0;
    if (Number.isFinite(breakMins) && breakMins > 0) {
      elapsedMinutes -= breakMins;
    }
  }

  return {
    currentLevelIndex: Math.min(currentLevelIndex, blindLevels.length - 1),
    msUntilNextLevel: null,
    atLastLevel: true,
  };
}

export function getBlindScheduleForTournament(
  startedAt: string | Date,
  blindLevelsJson: string,
  nowMs: number = Date.now()
): BlindScheduleInfo | null {
  let blindLevels: BlindLevelRow[] = [];
  try {
    blindLevels = JSON.parse(blindLevelsJson || "[]");
  } catch {
    return null;
  }
  if (!Array.isArray(blindLevels) || blindLevels.length === 0) return null;

  const start = new Date(startedAt).getTime();
  const elapsedMs = nowMs - start;
  if (elapsedMs < 0) return null;

  return getBlindScheduleFromElapsedMs(elapsedMs, blindLevels);
}
