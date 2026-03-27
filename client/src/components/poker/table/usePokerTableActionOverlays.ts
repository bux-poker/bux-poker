import { useEffect, useRef, useState } from "react";
import type { PokerTableProps } from "./pokerTableTypes";
import {
  ACTION_OVERLAY_FADE_MS,
  getActionInfo,
  isPermanentAction,
  normalizeAction,
} from "./pokerTableActionOverlayUtils";

type Player = PokerTableProps["players"][number];

/**
 * Tracks last-action overlays on seat avatars (FOLD/CHECK/ALL IN, etc.) with fade and new-hand reset.
 */
export function usePokerTableActionOverlays(
  players: Player[],
  showdownActive: boolean,
  currentBet: number,
  communityCards: PokerTableProps["communityCards"]
) {
  const [actionOverlays, setActionOverlays] = useState<
    Record<string, { action: string; timestamp: number }>
  >({});
  const lastSeenActionKeyRef = useRef<Record<string, string>>({});

  useEffect(() => {
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
          // Server may have sent BET/RAISE/CALL before lastAction normalization; match ALL IN overlay to 0 chips.
          if (
            (player.chips ?? 0) === 0 &&
            st === "ALL_IN" &&
            (la === "BET" || la === "RAISE" || la === "CALL")
          ) {
            displayAction = "ALL_IN";
          }
          newOverlays[playerId] = {
            action: displayAction,
            timestamp: now,
          };
          changed = true;
        }
      });

      lastSeenActionKeyRef.current = nextSeenKeys;
      // `players` is often a new array each render; returning `{ ...prev }` without changes caused an infinite loop.
      return changed ? newOverlays : prev;
    });
  }, [players]);

  useEffect(() => {
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
        // Do not treat chips===0 alone as all-in (0-chip players waiting for the next hand are not ALL_IN here).
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
      (communityCards?.length || 0) === 0 &&
      players.every((p) => (p.contribution || 0) === 0);
    if (isLikelyNewHand) {
      lastSeenActionKeyRef.current = {};
      setActionOverlays({});
    }
  }, [showdownActive, currentBet, communityCards, players]);

  return {
    actionOverlays,
    ACTION_FADE_MS: ACTION_OVERLAY_FADE_MS,
    isPermanentAction,
    getActionInfo,
  };
}
