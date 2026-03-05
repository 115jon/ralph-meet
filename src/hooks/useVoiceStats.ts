import type { SFUClient, VoiceConnectionStats } from "@/lib/sfu-client";
import { useEffect, useRef, useState } from "react";

/**
 * Polls SFU connection stats on a 2-second interval.
 * Returns the latest VoiceConnectionStats snapshot, or null if unavailable.
 *
 * @param sfu      – The SFUClient instance (may be null when disconnected)
 * @param enabled  – Whether to actively poll (set false when the panel is hidden
 *                   and the tooltip isn't being shown)
 */
export function useVoiceStats(
  sfu: SFUClient | null,
  enabled: boolean,
): VoiceConnectionStats | null {
  const [stats, setStats] = useState<VoiceConnectionStats | null>(null);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    if (intervalRef.current) {
      clearInterval(intervalRef.current);
      intervalRef.current = null;
    }

    if (!sfu || !enabled) {
      const timeout = setTimeout(() => setStats(null), 0);
      return () => clearTimeout(timeout);
    }

    // Immediate read
    const snap = sfu.getConnectionStats();
    let initialTimeoutId: NodeJS.Timeout;
    if (snap) {
      initialTimeoutId = setTimeout(() => setStats(snap), 0);
    }

    // Poll every 2s (aligned with SFU's internal stats interval)
    intervalRef.current = setInterval(() => {
      const s = sfu.getConnectionStats();
      if (s) setStats(s);
    }, 2000);

    return () => {
      clearTimeout(initialTimeoutId);
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
        intervalRef.current = null;
      }
    };
  }, [sfu, enabled]);

  return stats;
}
