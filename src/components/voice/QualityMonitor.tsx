import { formatQuality } from "@/lib/voice/utils";
import React, { useEffect, useState } from "react";

interface QualityMonitorProps {
  track?: MediaStreamTrack | null;
  signaledQuality?: string | null;
  sfu?: any;
  userId?: string;
  type?: "cam" | "screen";
}

/**
 * Resolution and frame-rate label for a video tile ("1080P / 60 FPS").
 *
 * It owns no timer. It re-reads the label after each shared stats snapshot
 * (`sfu.subscribeTrackStats`, fed by the SFU client's StatsHub every 2 s),
 * and React bails out when the text is unchanged, so a steady stream costs
 * one string comparison per snapshot and no re-render. Static text, no
 * animation.
 */
export const QualityMonitor: React.FC<QualityMonitorProps> = ({
  track,
  signaledQuality,
  sfu,
  userId,
  type,
}) => {
  const [qualityText, setQualityText] = useState("HD");

  useEffect(() => {
    if (!track) {
      const timeoutId = window.setTimeout(() => {
        setQualityText(formatQuality(signaledQuality, null));
      }, 0);
      return () => window.clearTimeout(timeoutId);
    }

    const update = () => {
      let stats = null;
      if (
        sfu &&
        userId &&
        type &&
        typeof sfu.getStatsByClerkId === "function"
      ) {
        stats = sfu.getStatsByClerkId(userId, type);
      }
      setQualityText(formatQuality(signaledQuality, track, stats));
    };

    const timeoutId = window.setTimeout(update, 0);
    let unsubscribe: (() => void) | null = null;
    let intervalId: number | null = null;
    if (sfu && typeof sfu.subscribeTrackStats === "function") {
      unsubscribe = sfu.subscribeTrackStats(update);
    } else {
      // No stats hub (preview or a bare track): follow hardware constraint
      // changes at the hub's cadence.
      intervalId = window.setInterval(update, 2000);
    }
    return () => {
      window.clearTimeout(timeoutId);
      unsubscribe?.();
      if (intervalId !== null) window.clearInterval(intervalId);
    };
  }, [track, signaledQuality, sfu, userId, type]);

  return <>{qualityText}</>;
};
