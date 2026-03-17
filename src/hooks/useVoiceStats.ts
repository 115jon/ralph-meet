import type { SFUClient, VoiceConnectionStats } from "@/lib/sfu-client";
import { useEffect, useState } from "react";

/**
 * Subscribes to SFU connection stats updates via the monitor's push API.
 *
 * The stats monitor calls registered listeners on every successful tick
 * (~2s) and also delivers the current snapshot synchronously when a new
 * listener subscribes. This means the hook gets data instantly on mount
 * (if stats are already available) rather than waiting for its own polling
 * interval to fire — eliminating the "Connecting…" flash entirely.
 *
 * @param sfu      – The SFUClient instance (may be null when disconnected)
 * @param enabled  – Set false when the panel is hidden to avoid unnecessary
 *                   subscriptions (though the monitor always runs regardless)
 */
export function useVoiceStats(
  sfu: SFUClient | null,
  enabled: boolean,
): VoiceConnectionStats | null {
  const [stats, setStats] = useState<VoiceConnectionStats | null>(null);

  useEffect(() => {
    if (!sfu || !enabled) {
      setStats(null);
      return;
    }

    // subscribeConnectionStats delivers the current snapshot synchronously
    // (if one exists) and then pushes future snapshots as they arrive.
    const unsubscribe = sfu.subscribeConnectionStats(setStats);
    return unsubscribe;
  }, [sfu, enabled]);

  return stats;
}
