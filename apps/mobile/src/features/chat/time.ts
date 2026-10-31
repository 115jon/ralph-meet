/**
 * Parses a server timestamp. D1 rows may hold SQLite's "YYYY-MM-DD HH:MM:SS"
 * (UTC, no zone) as well as ISO strings.
 */
export function parseTimestamp(value: string): Date {
  if (value.includes("T")) return new Date(value);
  return new Date(`${value.replace(" ", "T")}Z`);
}

/** Local calendar day, for grouping and dividers. */
export function dayKey(date: Date): string {
  return `${date.getFullYear()}-${date.getMonth()}-${date.getDate()}`;
}

const time = new Intl.DateTimeFormat(undefined, {
  hour: "2-digit",
  minute: "2-digit",
});
const weekday = new Intl.DateTimeFormat(undefined, {
  weekday: "short",
  day: "numeric",
  month: "short",
});
const fullDate = new Intl.DateTimeFormat(undefined, {
  day: "numeric",
  month: "short",
  year: "numeric",
});

export function formatTime(date: Date): string {
  return time.format(date);
}

/** "Today", "Yesterday", a weekday within the year, else the full date. */
export function formatDay(date: Date, now = new Date()): string {
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const day = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  const days = Math.round((today.getTime() - day.getTime()) / 86_400_000);
  if (days === 0) return "Today";
  if (days === 1) return "Yesterday";
  return date.getFullYear() === now.getFullYear()
    ? weekday.format(date)
    : fullDate.format(date);
}

const shortWeekday = new Intl.DateTimeFormat(undefined, { weekday: "short" });
const shortDate = new Intl.DateTimeFormat(undefined, {
  day: "numeric",
  month: "short",
});

/** A list row's stamp: the time today, a weekday this week, else the date. */
export function formatListTime(date: Date, now = new Date()): string {
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const day = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  const days = Math.round((today.getTime() - day.getTime()) / 86_400_000);
  if (days === 0) return time.format(date);
  if (days < 7) return shortWeekday.format(date);
  return shortDate.format(date);
}
