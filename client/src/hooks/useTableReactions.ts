import { useCallback, useEffect, useRef, useState } from "react";
import { getSocket } from "../services/socket";
import { soundManager } from "../utils/soundManager";
import {
  REACTION_COOLDOWN_MS,
  TABLE_REACTION_EMOJIS,
  createReactionId,
  type TableReactionEmojiId,
  type TableReactionEvent,
  type TableReactionKind,
} from "../components/poker/table/tableReactions";

const MAX_LIVE = 24;
/** Must cover throw (~1.55s) and self-bounce (~2.2s). */
const TTL_MS = 2300;

/**
 * Local + socket-synced table emoji reactions.
 * For `table-test`, joins a special room so multiple browsers can see throws.
 */
export function useTableReactions(gameId: string | undefined, myUserId: string | undefined) {
  const [reactions, setReactions] = useState<TableReactionEvent[]>([]);
  const [cooldownUntil, setCooldownUntil] = useState(0);
  const [now, setNow] = useState(() => Date.now());
  const seenRef = useRef<Set<string>>(new Set());

  useEffect(() => {
    if (cooldownUntil <= Date.now()) return;
    const id = window.setInterval(() => setNow(Date.now()), 200);
    return () => window.clearInterval(id);
  }, [cooldownUntil]);

  const cooldownRemainingMs = Math.max(0, cooldownUntil - now);

  const pushReaction = useCallback((event: TableReactionEvent, playSound: boolean) => {
    if (seenRef.current.has(event.id)) return;
    seenRef.current.add(event.id);
    if (seenRef.current.size > 80) {
      const keep = [...seenRef.current].slice(-40);
      seenRef.current = new Set(keep);
    }
    setReactions((prev) => [...prev.slice(-(MAX_LIVE - 1)), event]);
    if (playSound) {
      if (event.kind === "throw") soundManager.playEmojiThrow();
      else soundManager.playEmojiPop();
    }
    window.setTimeout(() => {
      setReactions((prev) => prev.filter((r) => r.id !== event.id));
    }, TTL_MS);
  }, []);

  useEffect(() => {
    if (!gameId) return;
    const socket = getSocket();
    const join = () => {
      if (gameId === "table-test") {
        socket.emit("join-table-test", { gameId: "table-test", userId: myUserId });
      }
    };
    join();
    socket.on("connect", join);

    const onReaction = (payload: TableReactionEvent) => {
      if (!payload?.id || payload.gameId !== gameId) return;
      // Skip echo of our own optimistic send
      if (seenRef.current.has(payload.id)) return;
      pushReaction(payload, true);
    };
    socket.on("table-reaction", onReaction);

    return () => {
      socket.off("connect", join);
      socket.off("table-reaction", onReaction);
    };
  }, [gameId, myUserId, pushReaction]);

  const sendReaction = useCallback(
    (opts: {
      emojiId: TableReactionEmojiId;
      toUserId: string;
      kind: TableReactionKind;
      fromUserId?: string;
    }) => {
      if (!gameId || !myUserId) return false;
      if (Date.now() < cooldownUntil) return false;
      const def = TABLE_REACTION_EMOJIS.find((e) => e.id === opts.emojiId);
      if (!def) return false;
      const event: TableReactionEvent = {
        id: createReactionId(),
        gameId,
        emoji: def.emoji,
        emojiId: def.id,
        kind: opts.kind,
        fromUserId: opts.fromUserId || myUserId,
        toUserId: opts.toUserId,
        createdAt: Date.now(),
      };
      setCooldownUntil(Date.now() + REACTION_COOLDOWN_MS);
      setNow(Date.now());
      pushReaction(event, true);
      try {
        getSocket().emit("table-reaction", event);
      } catch {
        /* local-only fallback */
      }
      return true;
    },
    [gameId, myUserId, pushReaction, cooldownUntil]
  );

  return { reactions, sendReaction, cooldownRemainingMs };
}
