import { useState, useEffect } from "react";

export type PreActionKind = "FOLD_OR_CHECK" | "CALL_ANY" | "ALL_IN";

interface PreActionControlsProps {
  selected: PreActionKind | null;
  onSelect: (kind: PreActionKind | null) => void;
}

/** Same chrome as main BettingControls action row (waiting for turn). */
export function PreActionControls({ selected, onSelect }: PreActionControlsProps) {
  const [windowSize, setWindowSize] = useState({
    width: typeof window !== "undefined" ? window.innerWidth : 1400,
  });

  useEffect(() => {
    const handleResize = () => setWindowSize({ width: window.innerWidth });
    window.addEventListener("resize", handleResize);
    return () => window.removeEventListener("resize", handleResize);
  }, []);

  const containerWidth =
    typeof window !== "undefined"
      ? `calc(${getComputedStyle(document.documentElement).getPropertyValue("--action-button-width") || "140px"} * 3 + 0.75rem * 2)`
      : "calc(140px * 3 + 0.75rem * 2)";
  void windowSize.width;

  const btnBase =
    "rounded-lg font-bold text-white shadow-lg transition-colors flex-1 whitespace-nowrap";
  const ring = (active: boolean) => (active ? "ring-2 ring-amber-400 ring-offset-2 ring-offset-slate-900" : "");

  return (
    <div className="flex flex-col items-end gap-2">
      <p className="text-xs font-medium text-slate-400 w-full text-right pr-1">Pre-select action</p>
      <div className="flex items-center gap-3" style={{ width: containerWidth }}>
        <button
          type="button"
          onClick={() => onSelect(selected === "FOLD_OR_CHECK" ? null : "FOLD_OR_CHECK")}
          className={`${btnBase} bg-slate-600 hover:bg-slate-500 ${ring(selected === "FOLD_OR_CHECK")}`}
          style={{
            minWidth: `var(--action-button-width, 140px)`,
            height: `var(--action-button-height, 48px)`,
            paddingLeft: `var(--action-button-padding-x, 24px)`,
            paddingRight: `var(--action-button-padding-x, 24px)`,
            paddingTop: `var(--action-button-padding-y, 12px)`,
            paddingBottom: `var(--action-button-padding-y, 12px)`,
            fontSize: `var(--action-button-text, 16px)`,
          }}
        >
          FOLD / CHECK
        </button>
        <button
          type="button"
          onClick={() => onSelect(selected === "CALL_ANY" ? null : "CALL_ANY")}
          className={`${btnBase} bg-blue-600 hover:bg-blue-700 ${ring(selected === "CALL_ANY")}`}
          style={{
            minWidth: `var(--action-button-width, 140px)`,
            height: `var(--action-button-height, 48px)`,
            paddingLeft: `var(--action-button-padding-x, 24px)`,
            paddingRight: `var(--action-button-padding-x, 24px)`,
            paddingTop: `var(--action-button-padding-y, 12px)`,
            paddingBottom: `var(--action-button-padding-y, 12px)`,
            fontSize: `var(--action-button-text, 16px)`,
          }}
        >
          CALL ANY
        </button>
        <button
          type="button"
          onClick={() => onSelect(selected === "ALL_IN" ? null : "ALL_IN")}
          className={`${btnBase} bg-emerald-600 hover:bg-emerald-700 ${ring(selected === "ALL_IN")}`}
          style={{
            minWidth: `var(--action-button-width, 140px)`,
            height: `var(--action-button-height, 48px)`,
            paddingLeft: `var(--action-button-padding-x, 24px)`,
            paddingRight: `var(--action-button-padding-x, 24px)`,
            paddingTop: `var(--action-button-padding-y, 12px)`,
            paddingBottom: `var(--action-button-padding-y, 12px)`,
            fontSize: `var(--action-button-text, 16px)`,
          }}
        >
          ALL IN
        </button>
      </div>
    </div>
  );
}
