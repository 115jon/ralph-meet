import type { SFUClient, VoiceConnectionStats } from "@/lib/sfu-client";
import { useEffect, useRef, useState } from "react";

/**
 * Subscribes to SFU connection stats updates via the monitor's push API.
 *
 * The stats monitor calls registered listeners on every successful tick
 * (~2s) and also delivers the current snapshot synchronously when a new
 * listener subscribes. This means the hook gets data instantly on mount
 * (if stats are already available) rather than waiting for its own polling
 * interval to fire.
 *
 * When `enabled` becomes false (panel hidden), the subscription is dropped
 * but the last known snapshot is KEPT — so the panel shows data immediately
 * on the next open instead of showing "Collecting connection data…" and
 * waiting up to 2 s for the next tick.
 *
 * @param sfu      – The SFUClient instance (may be null when disconnected)
 * @param enabled  – Set false when the panel is hidden to unsubscribe the
 *                   listener (the monitor keeps running regardless)
 */
export function useVoiceStats(
  sfu: SFUClient | null,
  enabled: boolean,
): VoiceConnectionStats | null {
  const [stats, setStats] = useState<VoiceConnectionStats | null>(null);
  // Track the last sfu instance so we can clear stats when sfu changes
  // (e.g. disconnect → reconnect), but NOT when only `enabled` changes.
  const sfuRef = useRef<SFUClient | null>(null);

  useEffect(() => {
    // When the SFU instance changes (or goes null), discard stale stats.
    if (sfu !== sfuRef.current) {
      sfuRef.current = sfu;
      if (!sfu) {
        setStats(null);
      }
    }
    if (!sfu) {
      // Panel hidden: keep the last snapshot so it shows instantly on reopen.
      // Or SFU is null, so we can't subscribe anyway.
      return;
    }

    if (!enabled) {
      return;
    }

    // subscribeConnectionStats delivers the current snapshot synchronously
    // (if one exists) and then pushes future snapshots as they arrive.
    const unsubscribe = sfu.subscribeConnectionStats(setStats);
    return unsubscribe;
  }, [sfu, enabled]);

  return stats;
}
