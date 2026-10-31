/**
 * One time-format module for the message area (rows, day dividers, embeds,
 * dialog previews, pins, threads). Every formatter is a memoised
 * `Intl.DateTimeFormat`, so a header no longer builds five formatters per
 * render.
 *
 * Hydration: the server snapshot formats in en-US / UTC; after hydration the
 * browser locale and time zone take over (same contract as
 * `useClientDateFormatter`).
 *
 * The "today" reference is one shared store that re-reads the clock at the
 * next local midnight, so rows that stay mounted across midnight move from
 * "Today" to "Yesterday" together instead of going stale.
 */
import { useCallback, useMemo, useSyncExternalStore } from "react";

export type TimeValue = string | number | Date;

const STABLE_LOCALE = "en-US";
const STABLE_TIME_ZONE = "UTC";

const TIME_OPTIONS: Intl.DateTimeFormatOptions = {
  hour: "numeric",
  minute: "2-digit",
};
const FULL_OPTIONS: Intl.DateTimeFormatOptions = {
  weekday: "long",
  year: "numeric",
  month: "long",
  day: "numeric",
  hour: "numeric",
  minute: "2-digit",
};
const WEEKDAY_DAY_OPTIONS: Intl.DateTimeFormatOptions = {
  weekday: "long",
  month: "long",
  day: "numeric",
};
const LONG_DAY_OPTIONS: Intl.DateTimeFormatOptions = {
  year: "numeric",
  month: "long",
  day: "numeric",
};
const SHORT_DAY_OPTIONS: Intl.DateTimeFormatOptions = {
  month: "short",
  day: "numeric",
};
const SHORT_DAY_YEAR_OPTIONS: Intl.DateTimeFormatOptions = {
  year: "numeric",
  month: "short",
  day: "numeric",
};

const formatterCache = new Map<string, Intl.DateTimeFormat>();

function formatterFor(
  options: Intl.DateTimeFormatOptions,
  client: boolean,
): Intl.DateTimeFormat {
  const key = `${client ? "c" : "s"}:${JSON.stringify(options)}`;
  let formatter = formatterCache.get(key);
  if (!formatter) {
    formatter = client
      ? new Intl.DateTimeFormat(undefined, options)
      : new Intl.DateTimeFormat(STABLE_LOCALE, {
          ...options,
          timeZone: STABLE_TIME_ZONE,
        });
    formatterCache.set(key, formatter);
  }
  return formatter;
}

function toDate(value: TimeValue): Date | null {
  const date = value instanceof Date ? value : new Date(value);
  return Number.isFinite(date.getTime()) ? date : null;
}

function fmt(
  value: TimeValue,
  options: Intl.DateTimeFormatOptions,
  client: boolean,
): string {
  const date = toDate(value);
  if (!date) return "Unknown time";
  try {
    return formatterFor(options, client).format(date);
  } catch {
    return "Unknown time";
  }
}

/** Local calendar day key (`YYYY-M-D`) used to break groups and place dividers. */
export function localDayKey(value: TimeValue): string | null {
  const date = toDate(value);
  if (!date) return null;
  return `${date.getFullYear()}-${date.getMonth()}-${date.getDate()}`;
}

function startOfLocalDay(ms: number): number {
  const date = new Date(ms);
  date.setHours(0, 0, 0, 0);
  return date.getTime();
}

// ── Shared midnight-ticking reference ──────────────────────────────────────

let todayStart: number | null = null;
let midnightTimer: ReturnType<typeof setTimeout> | null = null;
const listeners = new Set<() => void>();

function scheduleMidnight() {
  if (midnightTimer) clearTimeout(midnightTimer);
  if (listeners.size === 0) {
    midnightTimer = null;
    return;
  }
  const now = Date.now();
  const next = new Date(now);
  next.setHours(24, 0, 1, 0);
  midnightTimer = setTimeout(
    () => {
      todayStart = startOfLocalDay(Date.now());
      for (const listener of listeners) listener();
      scheduleMidnight();
    },
    Math.max(1000, next.getTime() - now),
  );
}

function subscribeToday(listener: () => void) {
  listeners.add(listener);
  if (listeners.size === 1) {
    todayStart = startOfLocalDay(Date.now());
    scheduleMidnight();
  }
  return () => {
    listeners.delete(listener);
    if (listeners.size === 0 && midnightTimer) {
      clearTimeout(midnightTimer);
      midnightTimer = null;
    }
  };
}

function getTodaySnapshot(): number | null {
  if (todayStart === null) todayStart = startOfLocalDay(Date.now());
  return todayStart;
}

const getServerToday = () => null;

/**
 * Start of the local day, as ms. `null` during SSR and hydration. Updates for
 * every subscriber at local midnight. Waking from sleep re-checks on focus.
 */
function useTodayStart(): number | null {
  return useSyncExternalStore(subscribeToday, getTodaySnapshot, getServerToday);
}

if (typeof window !== "undefined") {
  const recheck = () => {
    if (listeners.size === 0) return;
    const start = startOfLocalDay(Date.now());
    if (start !== todayStart) {
      todayStart = start;
      for (const listener of listeners) listener();
      scheduleMidnight();
    }
  };
  window.addEventListener("focus", recheck);
  document.addEventListener("visibilitychange", recheck);
}

const subscribeNoop = () => () => {};

function useClientReady(): boolean {
  return useSyncExternalStore(
    subscribeNoop,
    () => true,
    () => false,
  );
}

// ── Pure formatters (client = browser locale) ──────────────────────────────

/** `8:12 PM` */
function formatTime(value: TimeValue, client = true): string {
  return fmt(value, TIME_OPTIONS, client);
}

/**
 * `8:12` (no day period) for the 32px gutter of grouped follow-ups, where
 * `10:52 PM` would overflow. Locales with a 24h clock are unchanged.
 */
export function formatClock(value: TimeValue, client = true): string {
  const date = toDate(value);
  if (!date) return "";
  try {
    const parts = formatterFor(TIME_OPTIONS, client).formatToParts(date);
    return parts
      .filter((part) => part.type !== "dayPeriod")
      .map((part) => part.value)
      .join("")
      .trim();
  } catch {
    return "";
  }
}

/** `Thursday, October 22, 2026 at 8:12 PM` (tooltip / title text). */
function formatFull(value: TimeValue, client = true): string {
  return fmt(value, FULL_OPTIONS, client);
}

/**
 * Day divider label: `Today`, `Yesterday`, `Thursday, October 22` (this
 * year) or `October 22, 2025`.
 */
export function formatDayLabel(
  value: TimeValue,
  today: number | null,
  client = true,
): string {
  const date = toDate(value);
  if (!date) return "Unknown day";
  if (today !== null) {
    const day = startOfLocalDay(date.getTime());
    if (day === today) return "Today";
    const yesterday = new Date(today);
    yesterday.setDate(yesterday.getDate() - 1);
    if (day === yesterday.getTime()) return "Yesterday";
    if (date.getFullYear() === new Date(today).getFullYear()) {
      return fmt(date, WEEKDAY_DAY_OPTIONS, client);
    }
  }
  return fmt(date, LONG_DAY_OPTIONS, client);
}

/**
 * Compact date for embeds, pins and previews: `8:12 PM` today, `Yesterday`,
 * `Oct 22` this year, `Oct 22, 2025` otherwise.
 */
export function formatShortDate(
  value: TimeValue,
  today: number | null,
  client = true,
): string {
  const date = toDate(value);
  if (!date) return "Unknown time";
  if (today !== null) {
    const day = startOfLocalDay(date.getTime());
    if (day === today) return fmt(date, TIME_OPTIONS, client);
    const yesterday = new Date(today);
    yesterday.setDate(yesterday.getDate() - 1);
    if (day === yesterday.getTime()) return "Yesterday";
    if (date.getFullYear() === new Date(today).getFullYear()) {
      return fmt(date, SHORT_DAY_OPTIONS, client);
    }
  }
  return fmt(date, SHORT_DAY_YEAR_OPTIONS, client);
}

export interface MessageTimeFormat {
  today: number | null;
  time: (value: TimeValue) => string;
  clock: (value: TimeValue) => string;
  full: (value: TimeValue) => string;
  dayLabel: (value: TimeValue) => string;
  shortDate: (value: TimeValue) => string;
}

/**
 * Hook form: binds the formatters to the hydration-safe locale and the shared
 * midnight reference. Components re-render only at local midnight.
 */
export function useMessageTimeFormat(): MessageTimeFormat {
  const client = useClientReady();
  const today = useTodayStart();
  const time = useCallback((v: TimeValue) => formatTime(v, client), [client]);
  const full = useCallback((v: TimeValue) => formatFull(v, client), [client]);
  return useMemo(
    () => ({
      today,
      time,
      clock: (v: TimeValue) => formatClock(v, client),
      full,
      dayLabel: (v: TimeValue) => formatDayLabel(v, today, client),
      shortDate: (v: TimeValue) => formatShortDate(v, today, client),
    }),
    [today, time, full, client],
  );
}
