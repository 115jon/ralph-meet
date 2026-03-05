
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
    let intervalId: number;

    if (!track) {
      timeoutId = window.setTimeout(() => {
        setQualityText(formatQuality(signaledQuality, null));
      }, 0);
      return () => window.clearTimeout(timeoutId);
    }

    const update = () => {
      let stats = null;
      if (sfu && userId && type) {
        stats = sfu.getStatsByClerkId(userId, type);
      }
      setQualityText(formatQuality(signaledQuality, track, stats));
    };

    timeoutId = window.setTimeout(update, 0);
    intervalId = window.setInterval(update, 2000); // Polling for hardware constraint changes
    return () => {
      window.clearTimeout(timeoutId);
      window.clearInterval(intervalId);
    };
  }, [track, signaledQuality, sfu, userId, type]);

  return <>{qualityText}</>;
};
