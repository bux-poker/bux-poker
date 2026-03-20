function getChipColor(val: number): string {
  switch (val) {
    case 10:
      return "#FFC0CB";
    case 20:
      return "#808080";
    case 50:
      return "#FFA500";
    case 100:
      return "#FFFF00";
    case 200:
      return "#00FF00";
    case 500:
      return "#0000FF";
    case 1000:
      return "#FF0000";
    case 5000:
      return "#8B00FF";
    case 10000:
      return "#FFD700";
    default:
      if (val >= 10000) return "#FFD700";
      if (val >= 5000) return "#8B00FF";
      if (val >= 1000) return "#FF0000";
      if (val >= 500) return "#0000FF";
      if (val >= 200) return "#00FF00";
      if (val >= 100) return "#FFFF00";
      if (val >= 50) return "#FFA500";
      if (val >= 20) return "#808080";
      return "#FFC0CB";
  }
}

/** Chip stack indicator with color tier by value. */
export function BetChip({ value }: { value: number }) {
  const chipColor = getChipColor(value);

  return (
    <div className="flex items-center" style={{ gap: "var(--hole-card-gap, 4px)" }}>
      <div
        className="rounded-full shadow-lg flex items-center justify-center relative overflow-hidden"
        style={{
          backgroundColor: chipColor,
          width: "var(--bet-chip-size, 24px)",
          height: "var(--bet-chip-size, 24px)",
        }}
      >
        <img
          src="/poker-chip.svg"
          alt="chip"
          className="w-full h-full object-contain"
          style={{ filter: "brightness(0) invert(1)" }}
        />
      </div>
      <span
        className="font-semibold text-white drop-shadow-lg"
        style={{ fontSize: "var(--bet-chip-text-size, 13px)" }}
      >
        {value.toLocaleString()}
      </span>
    </div>
  );
}
