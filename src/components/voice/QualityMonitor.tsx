
import { formatQuality } from "@/lib/voice/utils";
import React, { useEffect, useState } from "react";

interface QualityMonitorProps {
  track?: MediaStreamTrack | null;
  signaledQuality?: string | null;
  sfu?: any;
  userId?: string;
  type?: 'cam' | 'screen';
}

export const QualityMonitor: React.FC<QualityMonitorProps> = ({
  track,
  signaledQuality,
  sfu,
  userId,
  type
}) => {
  const [qualityText, setQualityText] = useState("HD");

  useEffect(() => {
    let timeoutId: number;
    let intervalId: number | null = null;
    let cancelled = false;

    if (!track) {
      timeoutId = window.setTimeout(() => {
        setQualityText(formatQuality(signaledQuality, null));
      }, 0);
      return () => window.clearTimeout(timeoutId);
    }

    const update = () => {
      if (cancelled) return;
      let stats = null;
      if (sfu && userId && type && typeof sfu.getStatsByClerkId === "function") {
        stats = sfu.getStatsByClerkId(userId, type);
      }
      setQualityText(formatQuality(signaledQuality, track, stats));
    };

    const syncPolling = () => {
      if (intervalId !== null) {
        window.clearInterval(intervalId);
        intervalId = null;
      }

      if (document.visibilityState === "visible") {
        intervalId = window.setInterval(update, 5000);
      }
    };

    timeoutId = window.setTimeout(update, 0);
    syncPolling();
    document.addEventListener("visibilitychange", syncPolling);
    return () => {
      cancelled = true;
      window.clearTimeout(timeoutId);
      if (intervalId !== null) {
        window.clearInterval(intervalId);
      }
      document.removeEventListener("visibilitychange", syncPolling);
    };
  }, [track, signaledQuality, sfu, userId, type]);

  return <>{qualityText}</>;
};
