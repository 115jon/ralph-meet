import { clog } from "@/lib/console-logger";
import { Activity, Mic, MicOff } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";

const log = clog("MicTest");

interface MicTestWidgetProps {
  sensitivity: number;
  autoSensitivity: boolean;
  inputDeviceId: string;
}

/** Convert the dB sensitivity slider value to the same RMS threshold the VAD uses. */
function dbToThreshold(sensitivity: number): number {
  const threshold = Math.pow(10, sensitivity / 20) * 100;
  return Math.max(0.1, Math.min(50, threshold));
}

export function MicTestWidget({ sensitivity, autoSensitivity, inputDeviceId }: MicTestWidgetProps) {
  const [isActive, setIsActive] = useState(false);
  const [rms, setRms] = useState(0);
  const streamRef = useRef<MediaStream | null>(null);
  const audioCtxRef = useRef<AudioContext | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const rafRef = useRef<number>(0);

  const threshold = autoSensitivity ? 3.0 : dbToThreshold(sensitivity);
  const isSpeaking = rms >= threshold;

  // RMS 0-100 → visual percentage. Clamp at 50 RMS = 100% bar width for readability.
  const barPercent = Math.min(100, (rms / 50) * 100);
  const thresholdPercent = Math.min(100, (threshold / 50) * 100);

  const startTest = useCallback(async () => {
    try {
      const useExact = inputDeviceId && inputDeviceId !== "default" && !inputDeviceId.startsWith("native:");
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          deviceId: useExact ? { exact: inputDeviceId } : undefined,
          noiseSuppression: false,
          echoCancellation: false,
          autoGainControl: false,
        },
      });

      const ctx = new AudioContext();
      const analyser = ctx.createAnalyser();
      analyser.fftSize = 512;
      analyser.smoothingTimeConstant = 0.3;
      const source = ctx.createMediaStreamSource(stream);
      source.connect(analyser);

      streamRef.current = stream;
      audioCtxRef.current = ctx;
      analyserRef.current = analyser;

      const dataArray = new Uint8Array(analyser.frequencyBinCount);

      const tick = () => {
        if (!analyserRef.current) return;
        analyserRef.current.getByteTimeDomainData(dataArray);
        let sum = 0;
        for (let i = 0; i < dataArray.length; i++) {
          const val = (dataArray[i] - 128) / 128.0;
          sum += val * val;
        }
        const currentRms = Math.sqrt(sum / dataArray.length) * 100;
        setRms(currentRms);
        rafRef.current = requestAnimationFrame(tick);
      };
      rafRef.current = requestAnimationFrame(tick);
      setIsActive(true);
    } catch (err) {
      log.error("Failed to start:", err);
    }
  }, [inputDeviceId]);

  const stopTest = useCallback(() => {
    if (rafRef.current) cancelAnimationFrame(rafRef.current);
    rafRef.current = 0;
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    audioCtxRef.current?.close().catch(() => { });
    audioCtxRef.current = null;
    analyserRef.current = null;
    setRms(0);
    setIsActive(false);
  }, []);

  // Restart if device changes while active
  useEffect(() => {
    if (isActive) {
      stopTest();
      // Small delay to ensure old stream is fully released
      const t = setTimeout(() => startTest(), 200);
      return () => clearTimeout(t);
    }
  }, [inputDeviceId]); // eslint-disable-line react-hooks/exhaustive-deps

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
      streamRef.current?.getTracks().forEach((t) => t.stop());
      audioCtxRef.current?.close().catch(() => { });
    };
  }, []);

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Activity size={14} className="text-emerald-400" />
          <span className="text-[11px] font-bold uppercase tracking-wider text-rm-text-muted">
            Mic Test
          </span>
        </div>
        <button
          onClick={isActive ? stopTest : startTest}
          className={`
            flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold transition-all
            ${isActive
              ? "bg-red-500/15 text-red-400 hover:bg-red-500/25 border border-red-500/30"
              : "bg-emerald-500/15 text-emerald-400 hover:bg-emerald-500/25 border border-emerald-500/30"
            }
          `}
        >
          {isActive ? (
            <>
              <MicOff size={12} />
              Stop Test
            </>
          ) : (
            <>
              <Mic size={12} />
              Let's Check
            </>
          )}
        </button>
      </div>

      {/* Volume meter */}
      <div className="relative h-6 rounded-lg bg-rm-bg-elevated overflow-hidden border border-rm-border">
        {/* RMS level bar */}
        <div
          className={`absolute inset-y-0 left-0 transition-all duration-75 rounded-lg ${isSpeaking && isActive
              ? "bg-gradient-to-r from-emerald-500/60 to-emerald-400/80 shadow-[0_0_12px_rgba(52,211,153,0.3)]"
              : "bg-gradient-to-r from-amber-500/40 to-amber-400/60"
            }`}
          style={{ width: `${isActive ? barPercent : 0}%` }}
        />

        {/* Threshold indicator line */}
        {!autoSensitivity && (
          <div
            className="absolute inset-y-0 w-0.5 bg-red-400/80 z-10 transition-all duration-200"
            style={{ left: `${thresholdPercent}%` }}
          >
            <div className="absolute -top-0 left-1/2 -translate-x-1/2 w-1.5 h-1.5 rounded-full bg-red-400" />
            <div className="absolute -bottom-0 left-1/2 -translate-x-1/2 w-1.5 h-1.5 rounded-full bg-red-400" />
          </div>
        )}

        {/* Label overlay */}
        <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
          {!isActive ? (
            <span className="text-[10px] font-bold text-rm-text-muted/60 uppercase tracking-wider">
              Click "Let's Check" to test
            </span>
          ) : isSpeaking ? (
            <span className="text-[10px] font-black text-emerald-300 uppercase tracking-wider drop-shadow-sm">
              Speaking ●
            </span>
          ) : (
            <span className="text-[10px] font-bold text-rm-text-muted/80 uppercase tracking-wider">
              Listening…
            </span>
          )}
        </div>
      </div>

      {/* Help text */}
      {isActive && !autoSensitivity && (
        <p className="text-[10px] text-rm-text-muted/60 leading-relaxed">
          The <span className="text-red-400 font-bold">red line</span> is your gate threshold. Audio above it triggers the speaking indicator.
          Move the <span className="text-amber-600 dark:text-amber-400 font-bold">sensitivity slider</span> to adjust.
        </p>
      )}
    </div>
  );
}
