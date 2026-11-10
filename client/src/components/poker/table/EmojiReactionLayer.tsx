import { useEffect, useLayoutEffect, useRef, useState } from "react";
import {
  TABLE_REACTION_EMOJIS,
  type TableReactionEmojiId,
  type TableReactionEvent,
} from "./tableReactions";

type SeatPlayer = {
  id: string;
  userId?: string;
  seatNumber: number;
};

type Point = { x: number; y: number };

type Props = {
  reactions: TableReactionEvent[];
  players: SeatPlayer[];
  myUserId?: string;
  pickerTargetUserId: string | null;
  onPick: (emojiId: TableReactionEmojiId) => void;
  onClosePicker: () => void;
  seatRefs: React.MutableRefObject<Map<string, HTMLElement | null>>;
  tableRef: React.RefObject<HTMLDivElement | null>;
};

function seatCenter(
  tableEl: HTMLElement,
  seatEl: HTMLElement
): Point {
  const tableBox = tableEl.getBoundingClientRect();
  const seatBox = seatEl.getBoundingClientRect();
  return {
    x: seatBox.left - tableBox.left + seatBox.width / 2,
    y: seatBox.top - tableBox.top + seatBox.height / 2,
  };
}

export function EmojiReactionLayer({
  reactions,
  pickerTargetUserId,
  onPick,
  onClosePicker,
  seatRefs,
  tableRef,
}: Props) {
  const [selfPos, setSelfPos] = useState<Record<string, Point>>({});
  const [throwGeom, setThrowGeom] = useState<
    Record<string, { x0: number; y0: number; x1: number; y1: number }>
  >({});
  const [pickerPos, setPickerPos] = useState<Point | null>(null);
  const pickerAnchorRef = useRef<HTMLDivElement | null>(null);

  useLayoutEffect(() => {
    const tableEl = tableRef.current;
    if (!tableEl) return;

    const nextSelf: Record<string, Point> = {};
    const nextThrow: typeof throwGeom = {};
    for (const r of reactions) {
      if (r.kind === "self") {
        const el = seatRefs.current.get(r.toUserId);
        if (!el) continue;
        nextSelf[r.id] = seatCenter(tableEl, el);
      } else {
        const fromEl = seatRefs.current.get(r.fromUserId);
        const toEl = seatRefs.current.get(r.toUserId);
        if (!fromEl || !toEl) continue;
        const a = seatCenter(tableEl, fromEl);
        const b = seatCenter(tableEl, toEl);
        nextThrow[r.id] = { x0: a.x, y0: a.y, x1: b.x, y1: b.y };
      }
    }
    setSelfPos(nextSelf);
    setThrowGeom(nextThrow);

    if (pickerTargetUserId) {
      const seatEl = seatRefs.current.get(pickerTargetUserId);
      if (seatEl) {
        const c = seatCenter(tableEl, seatEl);
        setPickerPos({ x: c.x, y: c.y - 10 });
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
              {r.emoji}
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
            {r.emoji}
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
            transform: "translate(-50%, -100%)",
          }}
          role="dialog"
          aria-label="React with emoji"
        >
          {TABLE_REACTION_EMOJIS.map((e) => (
            <button
              key={e.id}
              type="button"
              title={e.label}
              onClick={(ev) => {
                ev.stopPropagation();
                onPick(e.id);
              }}
            >
              {e.emoji}
            </button>
          ))}
        </div>
      )}
    </>
  );
}
