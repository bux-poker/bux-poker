/** Format hand category for display (e.g. FULL_HOUSE -> "Full House"). */
export function formatHandCategory(category: string): string {
  if (!category) return "";
  return category
    .split("_")
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase())
    .join(" ");
}
