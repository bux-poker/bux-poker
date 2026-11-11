export type PreActionKind = "FOLD_OR_CHECK" | "CALL_ANY" | "ALL_IN";

interface PreActionControlsProps {
  selected: PreActionKind | null;
  onSelect: (kind: PreActionKind | null) => void;
}

/** Slim segmented pre-action toggles (waiting for turn). */
export function PreActionControls({ selected, onSelect }: PreActionControlsProps) {
  const items: { kind: PreActionKind; label: string }[] = [
    { kind: "FOLD_OR_CHECK", label: "Fold/Check" },
    { kind: "CALL_ANY", label: "Call any" },
    { kind: "ALL_IN", label: "All-in" },
  ];

  return (
    <div className="flex flex-col items-end gap-1">
      <span className="pr-1 font-display text-[10px] font-semibold uppercase tracking-[0.14em] text-slate-500">
        Pre-action
      </span>
      <div className="bux-preaction" role="group" aria-label="Pre-select action">
        {items.map(({ kind, label }) => (
          <button
            key={kind}
            type="button"
            aria-pressed={selected === kind}
            onClick={() => onSelect(selected === kind ? null : kind)}
          >
            {label}
          </button>
        ))}
      </div>
    </div>
  );
}
