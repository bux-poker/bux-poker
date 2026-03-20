/** Fade duration for non-permanent action text on avatars. */
export const ACTION_OVERLAY_FADE_MS = 2000;

export function isPermanentAction(action: string): boolean {
  const normalized = action.toUpperCase();
  return normalized === "FOLD" || normalized === "ALL_IN" || normalized === "ALLIN";
}

export function normalizeAction(action: string): string {
  return action.toUpperCase().replace("_", "");
}

export function getActionInfo(action: string): { text: string; color: string } {
  switch (action.toUpperCase()) {
    case "FOLD":
      return { text: "FOLD", color: "#dc2626" };
    case "CHECK":
      return { text: "CHECK", color: "#2563eb" };
    case "CALL":
      return { text: "CALL", color: "#2563eb" };
    case "BET":
      return { text: "BET", color: "#059669" };
    case "RAISE":
      return { text: "RAISE", color: "#059669" };
    case "ALL_IN":
    case "ALLIN":
      return { text: "ALL IN", color: "#059669" };
    default:
      return { text: action, color: "#64748b" };
  }
}
