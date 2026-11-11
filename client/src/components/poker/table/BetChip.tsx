function getChipStyle(val: number): { bg: string; rim: string } {
  if (val >= 10000) return { bg: "#b45309", rim: "#fbbf24" }; // gold
  if (val >= 5000) return { bg: "#5b21b6", rim: "#c4b5fd" }; // purple
  if (val >= 1000) return { bg: "#991b1b", rim: "#fca5a5" }; // red
  if (val >= 500) return { bg: "#1e3a8a", rim: "#93c5fd" }; // blue
  if (val >= 200) return { bg: "#065f46", rim: "#6ee7b7" }; // green
  if (val >= 100) return { bg: "#854d0e", rim: "#fde047" }; // yellow
  if (val >= 50) return { bg: "#9a3412", rim: "#fdba74" }; // orange
  if (val >= 20) return { bg: "#374151", rim: "#d1d5db" }; // grey
  return { bg: "#9d174d", rim: "#f9a8d4" }; // pink / small
}

/** Embossed casino chip stack indicator. */
export function BetChip({
  value,
  hideLabel = false,
}: {
  value: number;
  hideLabel?: boolean;
}) {
  const { bg, rim } = getChipStyle(value);

  return (
    <div className="flex items-center" style={{ gap: "var(--hole-card-gap, 4px)" }}>
      <div
        className="bux-chip flex items-center justify-center"
        style={{
          background: `radial-gradient(circle at 35% 30%, ${rim}55, ${bg} 55%, #0b0f14 130%)`,
          width: "var(--bet-chip-size, 24px)",
          height: "var(--bet-chip-size, 24px)",
          boxShadow: `inset 0 0 0 2px ${rim}99, inset 0 0 0 5px rgba(0,0,0,0.28), 0 3px 8px rgba(0,0,0,0.45)`,
        }}
        aria-hidden
      />
      {!hideLabel && (
        <span
          className="font-semibold text-white drop-shadow-lg tabular-nums"
          style={{ fontSize: "var(--bet-chip-text-size, 13px)" }}
        >
          {value.toLocaleString()}
        </span>
      )}
    </div>
  );
}
