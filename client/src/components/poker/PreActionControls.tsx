export type PreActionKind = "FOLD_OR_CHECK" | "CALL_ANY" | "ALL_IN";

interface PreActionControlsProps {
  selected: PreActionKind | null;
  onSelect: (kind: PreActionKind | null) => void;
}

/** Pre-action toggles sized to match BettingControls so the dock height never jumps. */
export function PreActionControls({ selected, onSelect }: PreActionControlsProps) {
  const items: { kind: PreActionKind; label: string }[] = [
    { kind: "FOLD_OR_CHECK", label: "Fold/Check" },
    { kind: "CALL_ANY", label: "Call any" },
    { kind: "ALL_IN", label: "All-in" },
  ];

  const btnStyle = {
    minWidth: `var(--action-button-width, 140px)`,
    height: `var(--action-button-height, 48px)`,
    paddingLeft: `var(--action-button-padding-x, 24px)`,
    paddingRight: `var(--action-button-padding-x, 24px)`,
    fontSize: `var(--action-button-text, 16px)`,
  } as const;

  const containerWidth =
    "calc(var(--action-button-width, 140px) * 3 + 0.75rem * 2)";

  return (
    <div className="flex max-h-full flex-col items-end justify-center gap-1 sm:gap-2">
      <span className="pr-1 font-display text-[10px] font-semibold uppercase tracking-[0.14em] text-slate-500">
        Pre-action
      </span>
      <div
        className="flex items-center gap-1.5 sm:gap-2"
        style={{ width: containerWidth }}
        role="group"
        aria-label="Pre-select action"
      >
        {items.map(({ kind, label }) => {
          const pressed = selected === kind;
          return (
            <button
              key={kind}
              type="button"
              aria-pressed={pressed}
              onClick={() => onSelect(pressed ? null : kind)}
              className={`flex-1 whitespace-nowrap rounded-xl font-bold transition ${
                pressed
                  ? "bg-[color:var(--bux-accent)] text-white shadow-lg"
                  : "bg-slate-700/80 text-slate-200 hover:bg-slate-600"
              }`}
              style={btnStyle}
            >
              {label}
            </button>
          );
        })}
      </div>
      {/* Spacer matches BettingControls' second row so dock height stays constant. */}
      <div
        aria-hidden
        style={{
          width: containerWidth,
          height: `var(--amount-input-height, 68px)`,
        }}
      />
    </div>
  );
}
