import type { SFUClient, VoiceConnectionStats } from "@/lib/sfu-client";
import { useEffect, useState } from "react";

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
 * Pass `enabled` true only while a surface that shows the numbers is open
 * (a latency tooltip, the details panel): every snapshot re-renders the
 * caller. For an always-visible indicator use `useVoiceQuality()` instead.
 *
 * @param sfu      – The SFUClient instance (may be null when disconnected)
 * @param enabled  – Set false when the panel is hidden to unsubscribe the
 *                   listener (the stats hub keeps running regardless)
 */
export function useVoiceStats(
  sfu: SFUClient | null,
  enabled: boolean,
): VoiceConnectionStats | null {
  const [snapshot, setSnapshot] = useState<{
    sfu: SFUClient | null;
    stats: VoiceConnectionStats | null;
  }>({ sfu: null, stats: null });

  useEffect(() => {
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
    const unsubscribe = sfu.subscribeConnectionStats((stats) => {
      setSnapshot({ sfu, stats });
    });
    return unsubscribe;
  }, [sfu, enabled]);

  return snapshot.sfu === sfu ? snapshot.stats : null;
}

/** Three-level call quality for the always-visible signal glyph. */
export type VoiceQualityLevel = "connecting" | "good" | "warn" | "bad";

/**
 * Map one snapshot to a quality level. Media-path RTT (0 until the first
 * receiver report) and outbound loss decide it; a failed or disconnected
 * transport is always "bad".
 */
export function classifyVoiceQuality(
  stats: VoiceConnectionStats | null,
): VoiceQualityLevel {
  if (!stats) return "connecting";
  if (
    stats.connectionState === "failed" ||
    stats.connectionState === "disconnected"
  ) {
    return "bad";
  }
  if (stats.packetLossRate >= 0.05 || stats.ping >= 300) return "bad";
  if (stats.packetLossRate >= 0.02 || stats.ping >= 150) return "warn";
  return "good";
}

/**
 * The quality level only. It listens to every stats snapshot but re-renders
 * its caller only when the level changes (rarely), so a dashboard can colour
 * its signal glyph without re-rendering every 2 s. Pair it with
 * `useVoiceStats(sfu, tooltipOrPanelOpen)` for the numbers.
 */
export function useVoiceQuality(sfu: SFUClient | null): VoiceQualityLevel {
  const [state, setState] = useState<{
    sfu: SFUClient | null;
    level: VoiceQualityLevel;
  }>({ sfu: null, level: "connecting" });

  useEffect(() => {
    if (!sfu) return;
    return sfu.subscribeConnectionStats((stats) => {
      const level = classifyVoiceQuality(stats);
      setState((prev) =>
        prev.sfu === sfu && prev.level === level ? prev : { sfu, level },
      );
    });
  }, [sfu]);

  return state.sfu === sfu ? state.level : "connecting";
}
