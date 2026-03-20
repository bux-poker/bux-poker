import { prisma } from "../../config/database.js";
import { auditChipConservation, reconcileChipConservationOnCompletion } from "./chipAudit.js";

const _onPlayersBustLocks = new Map();
// Idempotency guard to avoid processing the same bust repeatedly in race windows.
const _recentBustMarks = new Map(); // key: `${tournamentId}:${playerId}` -> timestamp ms
const RECENT_BUST_WINDOW_MS = 30000;

/**
 * Mark a single player as bust - only updates DB. Handles P2025 (player already removed by consolidation).
 * @param {string} tournamentId
 * @param {string} playerId
 * @param {number|null} finishingPlace - explicit place when multiple bust same hand
 */
export async function markPlayerBust(tournamentId, playerId, finishingPlace = null) {
  const now = Date.now();
  const dedupeKey = `${tournamentId}:${playerId}`;
  const seenAt = _recentBustMarks.get(dedupeKey);
  if (seenAt && now - seenAt < RECENT_BUST_WINDOW_MS) {
    console.log(`[TOURNAMENT] Skipping duplicate bust for ${playerId} (${Math.floor((now - seenAt) / 1000)}s since last)`);
    return;
  }

  const current = await prisma.player.findUnique({
    where: { id: playerId },
    select: { id: true, chips: true, status: true }
  });
  if (!current) {
    console.log(`[TOURNAMENT] Player ${playerId} not found, skipping bust update`);
    return;
  }
  // Critical guard: never eliminate a player that currently has chips.
  if ((current.chips ?? 0) > 0) {
    console.warn(`[TOURNAMENT] Guard: refusing to bust chip-positive player ${playerId} (chips=${current.chips})`);
    return;
  }
  if (current.status === "ELIMINATED") {
    _recentBustMarks.set(dedupeKey, now);
    return;
  }

  try {
    const result = await prisma.player.updateMany({
      where: { id: playerId, chips: { lte: 0 }, status: { not: "ELIMINATED" } },
      data: { status: "ELIMINATED", chips: 0 }
    });
    if (!result.count) {
      console.warn(`[TOURNAMENT] Bust skipped for ${playerId}: chips/status changed before update`);
      return;
    }
  } catch (err) {
    if (err?.code === "P2025") {
      console.log(`[TOURNAMENT] Player ${playerId} already removed (consolidation), skipping bust update`);
      return;
    }
    throw err;
  }
  const place = finishingPlace ?? (await prisma.player.count({
    where: { game: { tournamentId }, chips: { gt: 0 }, status: { not: "ELIMINATED" } }
  })) + 1;
  await prisma.player.update({
    where: { id: playerId },
    data: { finishingPlace: place }
  }).catch((err) => {
    if (err?.code === "P2025") return;
    console.error(`[TOURNAMENT] Error setting finishingPlace for player ${playerId}:`, err);
  });
  _recentBustMarks.set(dedupeKey, now);
}

/**
 * Process multiple busts (same hand), then complete tournament or run consolidation.
 * @param {string} tournamentId
 * @param {string[]} playerIds
 * @param {{ consolidateTables: (tournamentId: string) => Promise<object[]> }} deps
 */
export async function doOnPlayersBust(tournamentId, playerIds, deps) {
  if (!playerIds || playerIds.length === 0) return;
  const uniquePlayerIds = [...new Set(playerIds)];

  const remainingBeforeBust = await prisma.player.count({
    where: { game: { tournamentId }, chips: { gt: 0 }, status: { not: "ELIMINATED" } }
  });
  const basePlace = remainingBeforeBust + 1;
  console.log(`[TOURNAMENT] onPlayersBust: ${uniquePlayerIds.length} busted, remainingBeforeBust=${remainingBeforeBust}, basePlace=${basePlace}`);

  for (let i = 0; i < uniquePlayerIds.length; i++) {
    await markPlayerBust(tournamentId, uniquePlayerIds[i], basePlace + i);
  }

  const remainingAfterBust = await prisma.player.count({
    where: { game: { tournamentId }, chips: { gt: 0 }, status: { not: "ELIMINATED" } }
  });
  console.log(`[TOURNAMENT] onPlayersBust: remainingAfterBust=${remainingAfterBust}`);

  if (remainingAfterBust === 1) {
    const winner = await prisma.player.findFirst({
      where: { game: { tournamentId }, chips: { gt: 0 }, status: { not: "ELIMINATED" } },
      include: { user: true, game: true }
    });
    if (winner) {
      const current = await prisma.tournament.findUnique({
        where: { id: tournamentId },
        select: { status: true }
      });
      if (current?.status === "COMPLETED") {
        return;
      }
      const verifyCount = await prisma.player.count({
        where: { game: { tournamentId }, chips: { gt: 0 }, status: { not: "ELIMINATED" } }
      });
      if (verifyCount !== 1) {
        console.warn(`[TOURNAMENT] Aborting completion: verifyCount=${verifyCount} (expected 1) - possible race`);
        return;
      }
      await prisma.player.update({
        where: { id: winner.id },
        data: { finishingPlace: 1 }
      });
      await prisma.tournament.update({
        where: { id: tournamentId },
        data: { status: "COMPLETED" }
      });
      await reconcileChipConservationOnCompletion(tournamentId);
      await auditChipConservation(tournamentId);
      try {
        const tournament = await prisma.tournament.findUnique({
          where: { id: tournamentId },
          include: { games: { include: { players: { include: { user: true } } } } }
        });
        if (tournament) {
          const { postTournamentWinnersEmbed } = await import("../../discord/bot.js");
          await postTournamentWinnersEmbed(tournament);
        }
      } catch (err) {
        console.error("[TOURNAMENT] Error posting winners embed:", err);
      }
    }
  } else if (remainingAfterBust > 1) {
    await deps.consolidateTables(tournamentId);
  }
}

/**
 * Public API: acquire lock, then run doOnPlayersBust.
 * @param {string} tournamentId
 * @param {string[]} playerIds
 * @param {{ consolidateTables: (tournamentId: string) => Promise<object[]> }} deps
 */
export async function onPlayersBust(tournamentId, playerIds, deps) {
  if (!playerIds || playerIds.length === 0) return;
  const existing = _onPlayersBustLocks.get(tournamentId);
  if (existing) {
    await existing;
    return onPlayersBust(tournamentId, playerIds, deps);
  }
  const p = doOnPlayersBust(tournamentId, playerIds, deps);
  _onPlayersBustLocks.set(tournamentId, p);
  try {
    return await p;
  } finally {
    _onPlayersBustLocks.delete(tournamentId);
  }
}
