import { useEffect, useLayoutEffect, useRef, useState } from "react";
import {
  TABLE_REACTION_EMOJIS,
  reactionEmojiSrc,
  type TableReactionEmojiId,
  type TableReactionEvent,
} from "./tableReactions";

type SeatPlayer = {
  id: string;
  userId?: string;
  seatNumber: number;
};

type Point = { x: number; y: number };
type ThrowGeom = { x0: number; y0: number; x1: number; y1: number };

type Props = {
  reactions: TableReactionEvent[];
  players: SeatPlayer[];
  myUserId?: string;
  pickerTargetUserId: string | null;
  onPick: (emojiId: TableReactionEmojiId) => void;
  onClosePicker: () => void;
  seatRefs: React.MutableRefObject<Map<string, HTMLElement | null>>;
  tableRef: React.RefObject<HTMLDivElement | null>;
  /** Remaining cooldown ms; >0 disables picks */
  cooldownRemainingMs?: number;
};

const PICKER_W = 176;
const PICKER_H = 96;
const CARD_SIDE_OFFSET = 78;

function seatCenter(tableEl: HTMLElement, seatEl: HTMLElement): Point {
  const tableBox = tableEl.getBoundingClientRect();
  const seatBox = seatEl.getBoundingClientRect();
  return {
    x: seatBox.left - tableBox.left + seatBox.width / 2,
    y: seatBox.top - tableBox.top + seatBox.height / 2,
  };
}

function clamp(n: number, min: number, max: number) {
  return Math.max(min, Math.min(max, n));
}

/** Same side as hole cards: toward table center from the seat. */
function pickerBesideSeat(tableEl: HTMLElement, seatEl: HTMLElement): Point {
  const tableBox = tableEl.getBoundingClientRect();
  const c = seatCenter(tableEl, seatEl);
  const towardCenter = c.x < tableBox.width / 2 ? 1 : -1;
  let x = c.x + towardCenter * CARD_SIDE_OFFSET;
  let y = c.y;
  // Keep fully on the table surface (same clip region as seat cards).
  x = clamp(x, PICKER_W / 2 + 8, tableBox.width - PICKER_W / 2 - 8);
  y = clamp(y, PICKER_H / 2 + 8, tableBox.height - PICKER_H / 2 - 8);
  return { x, y };
}

function ReactionImg({
  emojiId,
  emoji,
  className,
}: {
  emojiId: string;
  emoji: string;
  className?: string;
}) {
  const src = reactionEmojiSrc(emojiId);
  if (!src) {
    return <span className={className}>{emoji}</span>;
  }
  return (
    <img
      src={src}
      alt=""
      draggable={false}
      className={className}
      style={{ width: "1em", height: "1em", display: "block" }}
    />
  );
}

export function EmojiReactionLayer({
  reactions,
  pickerTargetUserId,
  onPick,
  onClosePicker,
  seatRefs,
  tableRef,
  cooldownRemainingMs = 0,
}: Props) {
  const [selfPos, setSelfPos] = useState<Record<string, Point>>({});
  const [throwGeom, setThrowGeom] = useState<Record<string, ThrowGeom>>({});
  const [pickerPos, setPickerPos] = useState<Point | null>(null);
  const pickerAnchorRef = useRef<HTMLDivElement | null>(null);
  // Freeze flight paths so layout churn mid-animation can't reverse the throw.
  const lockedSelfRef = useRef<Record<string, Point>>({});
  const lockedThrowRef = useRef<Record<string, ThrowGeom>>({});

  useLayoutEffect(() => {
    const tableEl = tableRef.current;
    if (!tableEl) return;

    const liveIds = new Set(reactions.map((r) => r.id));
    for (const id of Object.keys(lockedSelfRef.current)) {
      if (!liveIds.has(id)) delete lockedSelfRef.current[id];
    }
    for (const id of Object.keys(lockedThrowRef.current)) {
      if (!liveIds.has(id)) delete lockedThrowRef.current[id];
    }

    const nextSelf: Record<string, Point> = {};
    const nextThrow: Record<string, ThrowGeom> = {};

    for (const r of reactions) {
      if (r.kind === "self") {
        if (!lockedSelfRef.current[r.id]) {
          const el = seatRefs.current.get(r.toUserId);
          if (!el) continue;
          lockedSelfRef.current[r.id] = seatCenter(tableEl, el);
        }
        nextSelf[r.id] = lockedSelfRef.current[r.id];
      } else {
        if (!lockedThrowRef.current[r.id]) {
          const fromEl = seatRefs.current.get(r.fromUserId);
          const toEl = seatRefs.current.get(r.toUserId);
          if (!fromEl || !toEl) continue;
          const a = seatCenter(tableEl, fromEl);
          const b = seatCenter(tableEl, toEl);
          lockedThrowRef.current[r.id] = { x0: a.x, y0: a.y, x1: b.x, y1: b.y };
        }
        nextThrow[r.id] = lockedThrowRef.current[r.id];
      }
    }
    setSelfPos(nextSelf);
    setThrowGeom(nextThrow);

    if (pickerTargetUserId) {
      const seatEl = seatRefs.current.get(pickerTargetUserId);
      if (seatEl) {
        setPickerPos(pickerBesideSeat(tableEl, seatEl));
      } else {
        setPickerPos(null);
      }
    } else {
      setPickerPos(null);
    }
  }, [reactions, pickerTargetUserId, seatRefs, tableRef]);

  useEffect(() => {
    if (!pickerTargetUserId) return;
    const onDoc = (e: MouseEvent | TouchEvent) => {
      const t = e.target as Node;
      if (pickerAnchorRef.current?.contains(t)) return;
      const el = t as HTMLElement;
      if (el?.closest?.("[data-seat-avatar]")) return;
      onClosePicker();
    };
    document.addEventListener("mousedown", onDoc);
    document.addEventListener("touchstart", onDoc);
    return () => {
      document.removeEventListener("mousedown", onDoc);
      document.removeEventListener("touchstart", onDoc);
    };
  }, [pickerTargetUserId, onClosePicker]);

  const onCooldown = cooldownRemainingMs > 0;
  const cooldownSec = Math.ceil(cooldownRemainingMs / 1000);

  return (
    <>
      {reactions.map((r) => {
        if (r.kind === "self") {
          const p = selfPos[r.id];
          if (!p) return null;
          return (
            <span
              key={r.id}
              className="bux-emoji-self"
              style={{ left: p.x, top: p.y }}
              aria-hidden
            >
              <ReactionImg emojiId={r.emojiId} emoji={r.emoji} />
            </span>
          );
        }
        const g = throwGeom[r.id];
        if (!g) return null;
        return (
          <span
            key={r.id}
            className="bux-emoji-throw"
            style={
              {
                ["--rx-x0" as string]: `${g.x0}px`,
                ["--rx-y0" as string]: `${g.y0}px`,
                ["--rx-x1" as string]: `${g.x1}px`,
                ["--rx-y1" as string]: `${g.y1}px`,
              } as React.CSSProperties
            }
            aria-hidden
          >
            <ReactionImg emojiId={r.emojiId} emoji={r.emoji} />
          </span>
        );
      })}

      {pickerTargetUserId && pickerPos && (
        <div
          ref={pickerAnchorRef}
          className="bux-emoji-picker"
          style={{
            left: pickerPos.x,
            top: pickerPos.y,
            width: PICKER_W,
          }}
          role="dialog"
          aria-label="React with emoji"
        >
          {onCooldown && (
            <div className="bux-emoji-picker-cooldown" aria-live="polite">
              Wait {cooldownSec}s
            </div>
          )}
          <div className={`bux-emoji-picker-grid ${onCooldown ? "is-disabled" : ""}`}>
            {TABLE_REACTION_EMOJIS.map((e) => (
              <button
                key={e.id}
                type="button"
                title={onCooldown ? `Wait ${cooldownSec}s` : e.label}
                disabled={onCooldown}
                onClick={(ev) => {
                  ev.stopPropagation();
                  if (onCooldown) return;
                  onPick(e.id);
                }}
              >
                <ReactionImg emojiId={e.id} emoji={e.emoji} />
              </button>
            ))}
          </div>
        </div>
      )}
    </>
  );
}
