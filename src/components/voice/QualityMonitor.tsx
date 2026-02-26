"use client";

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
    if (!track) {
      setQualityText(formatQuality(signaledQuality, null));
      return;
    }

    const update = () => {
      let stats = null;
      if (sfu && userId && type) {
        stats = sfu.getStatsByClerkId(userId, type);
      }
      setQualityText(formatQuality(signaledQuality, track, stats));
    };

    update();
    const interval = setInterval(update, 2000); // Polling for hardware constraint changes
    return () => clearInterval(interval);
  }, [track, signaledQuality]);

  return <>{qualityText}</>;
};
