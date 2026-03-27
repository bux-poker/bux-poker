import { useEffect, useRef, useState } from "react";
import type { PokerTableProps } from "./pokerTableTypes";
import {
  ACTION_OVERLAY_FADE_MS,
  getActionInfo,
  isPermanentAction,
  normalizeAction,
} from "./pokerTableActionOverlayUtils";

type Player = PokerTableProps["players"][number];

/** Stable string for overlay-related player fields (avoids setState every socket tick). */
function buildPlayersOverlaySig(players: Player[]): string {
  return players
    .map((p) => {
      const id = p.id || p.userId || "";
      return [
        id,
        String(p.lastAction ?? ""),
        String(p.lastActionSeq ?? 0),
        String(p.status ?? ""),
        String(p.chips ?? 0),
        String(p.contribution ?? 0),
      ].join(":");
    })
    .sort()
    .join("|");
}

/**
 * Tracks last-action overlays on seat avatars (FOLD/CHECK/ALL IN, etc.) with fade and new-hand reset.
 */
export function usePokerTableActionOverlays(
  players: Player[],
  showdownActive: boolean,
  currentBet: number,
  communityCards: PokerTableProps["communityCards"]
) {
  /** Stable deps: parent often passes a new [] from JSON.parse every render — do not put that ref on useEffect. */
  const communityLen = Array.isArray(communityCards) ? communityCards.length : 0;
  const contribSig = players
    .map((p) => `${p.id || p.userId || ""}:${p.contribution ?? 0}`)
    .sort()
    .join("|");

  const [actionOverlays, setActionOverlays] = useState<
    Record<string, { action: string; timestamp: number }>
  >({});
  const lastSeenActionKeyRef = useRef<Record<string, string>>({});
  const wasLikelyNewHandRef = useRef(false);

  const lastOverlaySigRef = useRef<string>("");
  const lastPermanentCleanupSigRef = useRef<string>("");
  useEffect(() => {
    const sig = buildPlayersOverlaySig(players);
    if (sig === lastOverlaySigRef.current) return;
    lastOverlaySigRef.current = sig;

    setActionOverlays((prev) => {
      const now = Date.now();
      const newOverlays: Record<string, { action: string; timestamp: number }> = { ...prev };
      const nextSeenKeys: Record<string, string> = {};
      let changed = false;

      players.forEach((player) => {
        const playerId = player.id || player.userId || "";
        const lastAction = player.lastAction || "";
        const actionKey = lastAction ? String(player.lastActionSeq || 0) : "";
        nextSeenKeys[playerId] = actionKey;
        if (lastAction && actionKey && actionKey !== lastSeenActionKeyRef.current[playerId]) {
          const st = (player.status || "").toUpperCase();
          const la = String(lastAction).toUpperCase();
          let displayAction = lastAction;
          if (
            (player.chips ?? 0) === 0 &&
            st === "ALL_IN" &&
            (la === "BET" || la === "RAISE" || la === "CALL")
          ) {
            displayAction = "ALL_IN";
          }
          const prevAction = prev[playerId]?.action;
          if (prevAction !== displayAction) {
            newOverlays[playerId] = {
              action: displayAction,
              timestamp: now,
            };
            changed = true;
          }
        }
      });

      lastSeenActionKeyRef.current = nextSeenKeys;
      return changed ? newOverlays : prev;
    });
  }, [players]);

  useEffect(() => {
    const sig = buildPlayersOverlaySig(players);
    if (sig === lastPermanentCleanupSigRef.current) return;
    lastPermanentCleanupSigRef.current = sig;

    const playerById: Record<string, { status?: string; chips: number }> = {};
    players.forEach((p) => {
      const playerId = p.id || p.userId || "";
      playerById[playerId] = { status: p.status, chips: p.chips ?? 0 };
    });

    setActionOverlays((prev) => {
      const next = { ...prev };
      let changed = false;
      Object.keys(next).forEach((playerId) => {
        const overlay = next[playerId];
        if (!isPermanentAction(overlay.action)) return;
        const player = playerById[playerId];
        if (!player) {
          delete next[playerId];
          changed = true;
          return;
        }

        const action = normalizeAction(overlay.action);
        const status = (player.status || "").toUpperCase();
        const keepFold = action === "FOLD" && status === "FOLDED";
        const keepAllIn =
          action === "ALLIN" &&
          status !== "ELIMINATED" &&
          status !== "FOLDED" &&
          status === "ALL_IN";
        if (!keepFold && !keepAllIn) {
          delete next[playerId];
          changed = true;
        }
      });
      return changed ? next : prev;
    });
  }, [players]);

  useEffect(() => {
    const interval = setInterval(() => {
      const now = Date.now();
      setActionOverlays((prev) => {
        const updated = { ...prev };
        let changed = false;
        Object.keys(updated).forEach((playerId) => {
          const overlay = updated[playerId];
          if (!isPermanentAction(overlay.action) && now - overlay.timestamp >= ACTION_OVERLAY_FADE_MS) {
            delete updated[playerId];
            changed = true;
          }
        });
        return changed ? updated : prev;
      });
    }, 100);

    return () => clearInterval(interval);
  }, []);

  useEffect(() => {
    const isLikelyNewHand =
      !showdownActive &&
      currentBet === 0 &&
      communityLen === 0 &&
      players.every((p) => (p.contribution || 0) === 0);
    if (!isLikelyNewHand) {
      wasLikelyNewHandRef.current = false;
      return;
    }
    if (wasLikelyNewHandRef.current) return;
    wasLikelyNewHandRef.current = true;
    lastOverlaySigRef.current = "";
    lastPermanentCleanupSigRef.current = "";
    lastSeenActionKeyRef.current = {};
    setActionOverlays((prev) => (Object.keys(prev).length === 0 ? prev : {}));
    // Stable deps only: do not list `players` or `communityCards[]` (new refs every socket tick).
  }, [showdownActive, currentBet, communityLen, contribSig]);

  return {
    actionOverlays,
    ACTION_FADE_MS: ACTION_OVERLAY_FADE_MS,
    isPermanentAction,
    getActionInfo,
  };
}
