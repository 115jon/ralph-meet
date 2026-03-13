import { useEffect, useRef, useState } from "react";

/**
 * Returns a live-updating formatted duration string (M:SS or H:MM:SS)
 * derived from a start timestamp. Clears when `startedAt` is null.
 *
 * @param startedAt  – epoch ms when the session began, or null to reset
 * @param enabled    – skip ticking when false (avoids pointless renders)
 */
export function useUptime(startedAt: number | null, enabled = true): string | null {
  const [display, setDisplay] = useState<string | null>(null);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    if (intervalRef.current) {
      clearInterval(intervalRef.current);
      intervalRef.current = null;
    }

    if (!startedAt || !enabled) {
      setDisplay(null);
      return;
    }

    const tick = () => {
      const elapsed = Math.max(0, Math.floor((Date.now() - startedAt) / 1000));
      const hrs = Math.floor(elapsed / 3600);
      const mins = Math.floor((elapsed % 3600) / 60);
      const secs = elapsed % 60;

      if (hrs > 0) {
        setDisplay(`${hrs}:${mins.toString().padStart(2, "0")}:${secs.toString().padStart(2, "0")}`);
      } else {
        setDisplay(`${mins}:${secs.toString().padStart(2, "0")}`);
      }
    };

    tick(); // immediate
    intervalRef.current = setInterval(tick, 1000);

    return () => {
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
        intervalRef.current = null;
      }
    };
  }, [startedAt, enabled]);

  return display;
}
