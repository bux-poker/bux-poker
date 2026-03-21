/**
 * Format an absolute instant in the viewer's local timezone.
 * Includes a short zone name (e.g. EST, GMT+1) so worldwide players see unambiguous local times.
 */
export function formatLocalDateTime(date: Date | string | number): string {
  const d = date instanceof Date ? date : new Date(date);
  if (Number.isNaN(d.getTime())) {
    return typeof date === "string" ? date : "";
  }
  return new Intl.DateTimeFormat(undefined, {
    weekday: "short",
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
    timeZoneName: "short",
  }).format(d);
}
