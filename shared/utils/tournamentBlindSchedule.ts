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

export type TournamentAnchorClockInput = {
  blindPeriodAnchorAt: string | Date | null | undefined;
  awaitingHandsForBlindClock?: boolean | null | undefined;
  tournamentBreakUntilAt?: string | Date | null | undefined;
  currentLevelIndex: number;
  blindLevels: BlindLevelRow[];
  nowMs?: number;
};

export type AnchorClockResult = {
  label: string;
  phase: "break" | "level" | "aligning" | "final" | "nextHand";
  msUntilNext: number | null;
};

/**
 * Blind/break countdown for RUNNING tournaments using server anchor + break end time.
 * When `awaitingHandsForBlindClock` or anchor is missing (during hand sync), show aligning phase.
 */
export function getBlindCountdownFromTournamentSchedule(
  input: TournamentAnchorClockInput
): AnchorClockResult {
  const nowMs = input.nowMs ?? Date.now();
  const breakUntil = input.tournamentBreakUntilAt
    ? new Date(input.tournamentBreakUntilAt).getTime()
    : null;

  if (breakUntil != null && nowMs < breakUntil) {
    const ms = Math.max(0, breakUntil - nowMs);
    const minutes = Math.floor(ms / 60000);
    const seconds = Math.floor((ms % 60000) / 1000);
    return {
      label: `${minutes}:${seconds.toString().padStart(2, "0")}`,
      phase: "break",
      msUntilNext: ms,
    };
  }

  if (input.awaitingHandsForBlindClock || input.blindPeriodAnchorAt == null) {
    return { label: "next hand", phase: "nextHand", msUntilNext: 0 };
  }

  const anchorMs = new Date(input.blindPeriodAnchorAt).getTime();
  const level = input.blindLevels[input.currentLevelIndex];
  if (!level || level.duration == null || level.duration === undefined) {
    return { label: "∞", phase: "final", msUntilNext: null };
  }

  const levelMinutes = Number(level.duration);
  const durMs =
    (Number.isFinite(levelMinutes) && levelMinutes >= 0 ? levelMinutes : 0) * 60 * 1000;
  const end = anchorMs + durMs;
  const ms = Math.max(0, end - nowMs);
  if (ms <= 0) {
    return { label: "next hand", phase: "nextHand", msUntilNext: 0 };
  }
  const minutes = Math.floor(ms / 60000);
  const seconds = Math.floor((ms % 60000) / 1000);
  return {
    label: `${minutes}:${seconds.toString().padStart(2, "0")}`,
    phase: "level",
    msUntilNext: ms,
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
