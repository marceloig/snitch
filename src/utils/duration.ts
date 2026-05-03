/** Returns today's date as YYYY-MM-DD (the format Cloudscape DatePicker expects). */
export function todayDateStr(): string {
  const now = new Date();
  return [
    now.getFullYear(),
    String(now.getMonth() + 1).padStart(2, "0"),
    String(now.getDate()).padStart(2, "0"),
  ].join("-");
}

/**
 * Converts stored minutes back to a { date, time } pair for the DatePicker +
 * TimeInput combo. The date is expressed relative to today, so editing always
 * shows the correct future offset regardless of when the policy was saved.
 */
export function minutesToMaxDuration(minutes: number): { date: string; time: string } {
  const days = Math.floor(minutes / 1440);
  const remaining = minutes % 1440;
  const h = Math.floor(remaining / 60);
  const m = remaining % 60;
  const base = new Date();
  base.setHours(0, 0, 0, 0);
  const target = new Date(base.getTime() + days * 86400000);
  return {
    date: [
      target.getFullYear(),
      String(target.getMonth() + 1).padStart(2, "0"),
      String(target.getDate()).padStart(2, "0"),
    ].join("-"),
    time: `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`,
  };
}

/**
 * Converts a DatePicker + TimeInput pair (YYYY-MM-DD + hh:mm) to total minutes.
 * Falls back to 1439 (end of today) when both fields are empty.
 */
export function maxDurationToMinutes(date: string, time: string): number {
  if (!date && !time) return 1439;
  const effectiveDate = date || todayDateStr();
  const effectiveTime = time || "23:59";
  const [year, month, day] = effectiveDate.split("-").map(Number);
  const selected = new Date(year, month - 1, day);
  const base = new Date();
  base.setHours(0, 0, 0, 0);
  const days = Math.max(0, Math.round((selected.getTime() - base.getTime()) / 86400000));
  const [h, m] = effectiveTime.split(":").map(Number);
  const total = days * 1440 + h * 60 + m;
  return total > 0 ? total : 1439;
}

/**
 * Human-readable duration label.
 * < 60 min  → "45min"
 * < 1 day   → "8h 30min"
 * ≥ 1 day   → "2d 8h" (minutes omitted when zero)
 */
export function formatDuration(minutes: number): string {
  if (minutes < 60) return `${minutes}min`;
  const days = Math.floor(minutes / 1440);
  const hours = Math.floor((minutes % 1440) / 60);
  const mins = minutes % 60;
  const parts: string[] = [];
  if (days > 0) parts.push(`${days}d`);
  if (hours > 0) parts.push(`${hours}h`);
  if (mins > 0) parts.push(`${mins}min`);
  return parts.join(" ");
}
