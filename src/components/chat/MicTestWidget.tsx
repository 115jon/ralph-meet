import { clog } from "@/lib/console-logger";
import {
  createLocalAudioProcessor,
  resolveCaptureAudioProcessing,
  type LocalAudioProcessorHandle,
  type VoiceAudioProcessingSettings,
} from "@/lib/voice/noise-reduction";
import { Activity, Headphones, Mic2, Square } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

const log = clog("MicTest");
const METER_BARS = 24;
const RMS_SMOOTHING = 0.28;
const SPEAKING_HOLD_MS = 220;
const SPEAKING_EXIT_RATIO = 0.82;

interface DetachedTestResources {
  stream: MediaStream | null;
  analysisStream: MediaStream | null;
  previewStream: MediaStream | null;
  previewAudio: HTMLAudioElement | null;
  processor: LocalAudioProcessorHandle | null;
  audioContext: AudioContext | null;
}

interface MicTestWidgetProps {
  sensitivity: number;
  autoSensitivity: boolean;
  inputDeviceId: string;
  outputDeviceId: string;
  processing: VoiceAudioProcessingSettings;
}

/** Convert the dB sensitivity slider value to the same RMS threshold the VAD uses. */
function dbToThreshold(sensitivity: number): number {
  const threshold = Math.pow(10, sensitivity / 20) * 100;
  return Math.max(0.1, Math.min(50, threshold));
}

export function MicTestWidget({
  sensitivity,
  autoSensitivity,
  inputDeviceId,
  outputDeviceId,
  processing,
}: MicTestWidgetProps) {
  const [isActive, setIsActive] = useState(false);
  const [rms, setRms] = useState(0);
  const [isSpeaking, setIsSpeaking] = useState(false);
  const [heardAudio, setHeardAudio] = useState(false);
  const streamRef = useRef<MediaStream | null>(null);
  const analysisStreamRef = useRef<MediaStream | null>(null);
  const previewStreamRef = useRef<MediaStream | null>(null);
  const previewAudioRef = useRef<HTMLAudioElement | null>(null);
  const audioCtxRef = useRef<AudioContext | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const processorRef = useRef<LocalAudioProcessorHandle | null>(null);
  const rafRef = useRef<number>(0);
  const startRequestRef = useRef(0);
  const meterStateRef = useRef({
    smoothedRms: 0,
    isSpeaking: false,
    lastSpeechAt: 0,
  });

  const threshold = autoSensitivity ? 3.0 : dbToThreshold(sensitivity);
  const barPercent = Math.min(100, (rms / 50) * 100);
  const thresholdPercent = Math.min(100, (threshold / 50) * 100);

  const processingSignature = useMemo(
    () => [
      processing.noiseSuppression,
      processing.echoCancellation,
      processing.autoSensitivity,
      processing.streamHighFidelity,
      processing.noiseReductionEnabled,
      processing.noiseReductionProvider,
    ].join(":"),
    [
      processing.autoSensitivity,
      processing.echoCancellation,
      processing.noiseReductionEnabled,
      processing.noiseReductionProvider,
      processing.noiseSuppression,
      processing.streamHighFidelity,
    ],
  );

  const clearDetachedResources = useCallback((resources: DetachedTestResources) => {
    resources.previewAudio?.pause();
    if (resources.previewAudio) {
      resources.previewAudio.srcObject = null;
    }
    resources.previewStream?.getTracks().forEach((track) => track.stop());
    resources.analysisStream?.getTracks().forEach((track) => track.stop());
    resources.processor?.destroy();
    resources.stream?.getTracks().forEach((track) => track.stop());
    resources.audioContext?.close().catch(() => { });
  }, []);

  const resetMeterState = useCallback(() => {
    meterStateRef.current = {
      smoothedRms: 0,
      isSpeaking: false,
      lastSpeechAt: 0,
    };
    setRms(0);
    setIsSpeaking(false);
  }, []);

  const stopTest = useCallback((options?: { preserveUi?: boolean; cancelPendingStart?: boolean }) => {
    if (options?.cancelPendingStart) {
      startRequestRef.current += 1;
    }
    if (rafRef.current) cancelAnimationFrame(rafRef.current);
    rafRef.current = 0;
    if (previewAudioRef.current) {
      previewAudioRef.current.pause();
      previewAudioRef.current.srcObject = null;
    }
    previewAudioRef.current = null;
    previewStreamRef.current?.getTracks().forEach((track) => track.stop());
    previewStreamRef.current = null;
    analysisStreamRef.current?.getTracks().forEach((track) => track.stop());
    analysisStreamRef.current = null;
    processorRef.current?.destroy();
    processorRef.current = null;
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
    audioCtxRef.current?.close().catch(() => { });
    audioCtxRef.current = null;
    analyserRef.current = null;
    if (!options?.preserveUi) {
      resetMeterState();
      setHeardAudio(false);
      setIsActive(false);
    }
  }, [resetMeterState]);

  const startTest = useCallback(async (options?: { preserveUi?: boolean }) => {
    const requestId = startRequestRef.current + 1;
    startRequestRef.current = requestId;

    // Keep the loopback panel visually stable while we rebuild the processing path.
    stopTest({ preserveUi: options?.preserveUi, cancelPendingStart: false });
    if (!options?.preserveUi) {
      setHeardAudio(false);
    }

    const resources: DetachedTestResources = {
      stream: null,
      analysisStream: null,
      previewStream: null,
      previewAudio: null,
      processor: null,
      audioContext: null,
    };

    try {
      const capture = resolveCaptureAudioProcessing(processing);
      const useExact = inputDeviceId && inputDeviceId !== "default" && !inputDeviceId.startsWith("native:");
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          deviceId: useExact ? { exact: inputDeviceId } : undefined,
          noiseSuppression: capture.noiseSuppression,
          echoCancellation: capture.echoCancellation,
          autoGainControl: capture.autoGainControl,
          channelCount: 2,
        },
      });
      resources.stream = stream;

      const processor = await createLocalAudioProcessor(stream, processing);
      resources.processor = processor;
      const analysisStream = processor?.createMonitorStream()
        ?? new MediaStream([stream.getAudioTracks()[0].clone()]);
      const previewStream = processor?.createMonitorStream()
        ?? new MediaStream([stream.getAudioTracks()[0].clone()]);
      resources.analysisStream = analysisStream;
      resources.previewStream = previewStream;

      const ctx = new AudioContext();
      const analyser = ctx.createAnalyser();
      analyser.fftSize = 512;
      analyser.smoothingTimeConstant = 0.3;
      const source = ctx.createMediaStreamSource(analysisStream);
      source.connect(analyser);
      ctx.resume().catch(() => { });
      resources.audioContext = ctx;

      const previewAudio = new Audio();
      previewAudio.autoplay = true;
      previewAudio.muted = false;
      (previewAudio as HTMLAudioElement & { playsInline?: boolean }).playsInline = true;
      previewAudio.srcObject = previewStream;
      resources.previewAudio = previewAudio;

      const sinkId = outputDeviceId === "default" || outputDeviceId.startsWith("native:")
        ? ""
        : outputDeviceId;
      const sinkable = previewAudio as HTMLAudioElement & { setSinkId?: (nextSinkId: string) => Promise<void> };
      if (typeof sinkable.setSinkId === "function") {
        await sinkable.setSinkId(sinkId).catch(() => { });
      }
      await previewAudio.play().then(() => {
        if (startRequestRef.current === requestId) {
          setHeardAudio(true);
        }
      }).catch(() => {
        if (!options?.preserveUi && startRequestRef.current === requestId) {
          setHeardAudio(false);
        }
      });

      if (startRequestRef.current !== requestId) {
        clearDetachedResources(resources);
        return;
      }

      streamRef.current = stream;
      processorRef.current = processor;
      analysisStreamRef.current = analysisStream;
      previewStreamRef.current = previewStream;
      previewAudioRef.current = previewAudio;
      audioCtxRef.current = ctx;
      analyserRef.current = analyser;

      const dataArray = new Uint8Array(analyser.frequencyBinCount);
      const tick = () => {
        if (!analyserRef.current) return;
        analyserRef.current.getByteTimeDomainData(dataArray);
        let sum = 0;
        for (let i = 0; i < dataArray.length; i++) {
          const value = (dataArray[i] - 128) / 128.0;
          sum += value * value;
        }
        const currentRms = Math.sqrt(sum / dataArray.length) * 100;
        const previousMeterState = meterStateRef.current;
        const smoothedRms = previousMeterState.smoothedRms > 0
          ? (previousMeterState.smoothedRms * (1 - RMS_SMOOTHING)) + (currentRms * RMS_SMOOTHING)
          : currentRms;
        const now = performance.now();
        const exitThreshold = threshold * SPEAKING_EXIT_RATIO;
        let nextSpeaking = previousMeterState.isSpeaking;
        let lastSpeechAt = previousMeterState.lastSpeechAt;

        if (smoothedRms >= threshold) {
          nextSpeaking = true;
          lastSpeechAt = now;
        } else if (previousMeterState.isSpeaking && (now - previousMeterState.lastSpeechAt) < SPEAKING_HOLD_MS) {
          nextSpeaking = true;
        } else if (smoothedRms <= exitThreshold) {
          nextSpeaking = false;
        }

        meterStateRef.current = {
          smoothedRms,
          isSpeaking: nextSpeaking,
          lastSpeechAt,
        };

        setRms(smoothedRms);
        setIsSpeaking((previous) => previous === nextSpeaking ? previous : nextSpeaking);
        rafRef.current = requestAnimationFrame(tick);
      };

      rafRef.current = requestAnimationFrame(tick);
      setIsActive(true);
    } catch (error) {
      if (startRequestRef.current === requestId) {
        log.error("Failed to start mic test:", error);
        stopTest({ cancelPendingStart: true });
      } else {
        clearDetachedResources(resources);
      }
    }
  }, [clearDetachedResources, inputDeviceId, outputDeviceId, processing, stopTest, threshold]);

  useEffect(() => {
    if (!isActive) return;

    const timeoutId = window.setTimeout(() => {
      startTest({ preserveUi: true }).catch(() => { });
    }, 120);

    return () => window.clearTimeout(timeoutId);
  }, [inputDeviceId, outputDeviceId, processingSignature, isActive, startTest]);

  useEffect(() => {
    return () => {
      stopTest({ cancelPendingStart: true });
    };
  }, [stopTest]);

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <Activity size={14} className="text-emerald-400" />
          <span className="text-[11px] font-bold uppercase tracking-wider text-rm-text-muted">
            Mic Test
          </span>
        </div>
        <div className="flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-wider text-rm-text-muted/80">
          <Headphones size={12} className="text-rm-text-muted/70" />
          Headphones Recommended
        </div>
      </div>

      <div className="rounded-xl border border-rm-border bg-rm-bg-elevated/40 p-3">
        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={() => {
              if (isActive) {
                stopTest({ cancelPendingStart: true });
              } else {
                startTest().catch(() => { });
              }
            }}
            className={`shrink-0 rounded-lg border px-3 py-2 text-xs font-bold transition-all ${
              isActive
                ? "border-red-500/30 bg-red-500/10 text-red-300 hover:bg-red-500/20"
                : "border-rm-border bg-rm-bg-surface text-rm-text hover:bg-rm-bg-hover"
            }`}
          >
            <span className="flex items-center gap-1.5">
              {isActive ? <Square size={12} /> : <Mic2 size={12} />}
              {isActive ? "Stop" : "Test"}
            </span>
          </button>

          <div className="flex min-w-0 flex-1 items-center gap-1.5">
            {Array.from({ length: METER_BARS }, (_, index) => {
              const start = (index / METER_BARS) * 100;
              const end = ((index + 1) / METER_BARS) * 100;
              const isFilled = isActive && barPercent >= start;
              const marksThreshold = !autoSensitivity && thresholdPercent >= start && thresholdPercent < end;

              return (
                <div
                  key={index}
                  className={`h-5 flex-1 rounded-full transition-all ${
                    marksThreshold
                      ? "bg-amber-400/90 shadow-[0_0_10px_rgba(251,191,36,0.28)]"
                      : isFilled
                        ? isSpeaking
                          ? "bg-emerald-400/90 shadow-[0_0_10px_rgba(74,222,128,0.28)]"
                          : "bg-sky-400/80"
                        : "bg-rm-bg-surface"
                  }`}
                />
              );
            })}
          </div>
        </div>

        <div className="mt-3 flex items-center justify-between gap-3 text-[11px]">
          <span className="text-rm-text-muted">
            {isActive
              ? heardAudio
                ? "You are hearing the current outbound mic processing in real time."
                : "Live meter running. Browser blocked local playback, but the processing path is active."
              : "Start a loopback test to hear how your microphone sounds after cleanup."}
          </span>
          <span className={`shrink-0 font-bold uppercase tracking-wider ${
            isActive
              ? isSpeaking
                ? "text-emerald-300"
                : "text-sky-300"
              : "text-rm-text-muted/70"
          }`}>
            {isActive ? (isSpeaking ? "Speaking" : "Listening") : "Idle"}
          </span>
        </div>
      </div>
    </div>
  );
}
