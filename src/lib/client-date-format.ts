import { useCallback, useEffect, useState, useSyncExternalStore } from "react";

const subscribeToClientReady = () => () => {};
const getClientReady = () => true;
const getServerReady = () => false;

const STABLE_LOCALE = "en-US";
const STABLE_TIME_ZONE = "UTC";

export type ClientDateValue = string | number | Date;
export type ClientDateFormatter = (
  value: ClientDateValue,
  options?: Intl.DateTimeFormatOptions,
) => string;

/**
 * Formats a date with a deterministic server snapshot, then opts into the
 * browser locale and time zone after hydration has completed.
 */
export function formatClientDate(
  value: ClientDateValue,
  options: Intl.DateTimeFormatOptions | undefined,
  useClientLocale: boolean,
): string {
  try {
    const formatOptions = options ?? {
      year: "numeric",
      month: "numeric",
      day: "numeric",
      hour: "numeric",
      minute: "numeric",
      second: "numeric",
    };
    const date = new Date(value);
    if (!Number.isFinite(date.getTime())) return "Unknown time";

    const resolvedOptions = useClientLocale
      ? formatOptions
      : { ...formatOptions, timeZone: STABLE_TIME_ZONE };

    return new Intl.DateTimeFormat(
      useClientLocale ? undefined : STABLE_LOCALE,
      resolvedOptions,
    ).format(date);
  } catch {
    return "Unknown time";
  }
}

export function useClientDateFormatter(): ClientDateFormatter {
  const useClientLocale = useSyncExternalStore(
    subscribeToClientReady,
    getClientReady,
    getServerReady,
  );

  return useCallback(
    (value, options) => formatClientDate(value, options, useClientLocale),
    [useClientLocale],
  );
}

export function useClientReferenceTime(): number | null {
  const [referenceTime, setReferenceTime] = useState<number | null>(null);

  useEffect(() => {
    // Date.now() is intentionally read only after the stable server snapshot.
    // eslint-disable-next-line react-hooks-js/set-state-in-effect
    setReferenceTime(Date.now());
  }, []);

  return referenceTime;
}
