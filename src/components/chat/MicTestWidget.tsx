import { clog } from "@/lib/console-logger";
import { getAudioCaptureStream } from "@/lib/audio-capture";
import {
  createLocalAudioProcessor,
  resolveCaptureAudioProcessing,
  type LocalAudioProcessorHandle,
  type VoiceAudioProcessingSettings,
} from "@/lib/voice/noise-reduction";
import {
  getVoiceActivityLevelPercent,
  getVoiceActivityThreshold,
} from "@/lib/voice/vad";
import { Button } from "@/components/ui/button";
import { Icon } from "@/components/ui/icon";
import { useAppActive } from "@/hooks/useAppActive";
import { cn } from "@/lib/utils";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

const log = clog("MicTest");
/** The level bar is written at most this often (30fps). */
const METER_FRAME_MS = 1000 / 30;
/** The level reads as a ladder of this many cells (the kit's bar meter). */
const METER_CELLS = 16;
const METER_GAP_PX = 3;
/** Cuts the track and fill into cells; static, so only the fill moves. */
const METER_CELL_MASK = `repeating-linear-gradient(to right, #000 0, #000 calc(100% / ${METER_CELLS} - ${METER_GAP_PX}px), transparent calc(100% / ${METER_CELLS} - ${METER_GAP_PX}px), transparent calc(100% / ${METER_CELLS}))`;
/** Whole cells only: the fill steps from cell to cell. */
const quantizeLevel = (level: number) =>
  Math.round(level * METER_CELLS) / METER_CELLS;
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

interface StartTestOptions {
  playback?: boolean;
  preserveUi?: boolean;
}

export function MicTestWidget({
  sensitivity,
  autoSensitivity,
  inputDeviceId,
  outputDeviceId,
  processing,
}: MicTestWidgetProps) {
  const [isActive, setIsActive] = useState(false);
  const [isSpeaking, setIsSpeaking] = useState(false);
  const appActive = useAppActive();
  const appActiveRef = useRef(appActive);
  /** The level bar: written directly (transform only), never through state. */
  const fillRef = useRef<HTMLDivElement | null>(null);
  const lastPaintRef = useRef(0);
  const tickRef = useRef<(() => void) | null>(null);
  const [isPlaybackActive, setIsPlaybackActive] = useState(false);
  const streamRef = useRef<MediaStream | null>(null);
  const analysisStreamRef = useRef<MediaStream | null>(null);
  const previewStreamRef = useRef<MediaStream | null>(null);
  const previewAudioRef = useRef<HTMLAudioElement | null>(null);
  const audioCtxRef = useRef<AudioContext | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const processorRef = useRef<LocalAudioProcessorHandle | null>(null);
  const rafRef = useRef<number>(0);
  const startRequestRef = useRef(0);
  const activeConfigRef = useRef<string | null>(null);
  const meterStateRef = useRef({
    smoothedRms: 0,
    isSpeaking: false,
    lastSpeechAt: 0,
  });

  const threshold = getVoiceActivityThreshold(autoSensitivity, sensitivity);
  const thresholdRef = useRef(threshold);
  useEffect(() => {
    thresholdRef.current = threshold;
  }, [threshold]);
  const thresholdPercent = getVoiceActivityLevelPercent(threshold);

  const processingSignature = useMemo(
    () =>
      [
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

  const clearDetachedResources = useCallback(
    (resources: DetachedTestResources) => {
      resources.previewAudio?.pause();
      if (resources.previewAudio) {
        resources.previewAudio.srcObject = null;
      }
      resources.previewStream?.getTracks().forEach((track) => track.stop());
      resources.analysisStream?.getTracks().forEach((track) => track.stop());
      resources.processor?.destroy();
      resources.stream?.getTracks().forEach((track) => track.stop());
      resources.audioContext?.close().catch(() => {});
    },
    [],
  );

  const resetMeterState = useCallback(() => {
    meterStateRef.current = {
      smoothedRms: 0,
      isSpeaking: false,
      lastSpeechAt: 0,
    };
    if (fillRef.current) fillRef.current.style.transform = "scaleX(0)";
    setIsSpeaking(false);
  }, []);

  const stopTest = useCallback(
    (options?: { preserveUi?: boolean; cancelPendingStart?: boolean }) => {
      if (options?.cancelPendingStart) {
        startRequestRef.current += 1;
      }
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
      rafRef.current = 0;
      tickRef.current = null;
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
      audioCtxRef.current?.close().catch(() => {});
      audioCtxRef.current = null;
      analyserRef.current = null;
      if (!options?.preserveUi) {
        resetMeterState();
        setIsActive(false);
      }
      setIsPlaybackActive(false);
      if (!options?.preserveUi) activeConfigRef.current = null;
    },
    [resetMeterState],
  );

  const startTest = useCallback(
    async (options?: StartTestOptions) => {
      const requestId = startRequestRef.current + 1;
      startRequestRef.current = requestId;
      const shouldPlay = options?.playback ?? false;

      // Keep the loopback panel visually stable while we rebuild the processing path.
      stopTest({ preserveUi: options?.preserveUi, cancelPendingStart: false });
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
        const stream = await getAudioCaptureStream({
          deviceId: inputDeviceId,
          audio: {
            noiseSuppression: capture.noiseSuppression,
            echoCancellation: capture.echoCancellation,
            autoGainControl: capture.autoGainControl,
            channelCount: 2,
          },
        });
        resources.stream = stream;

        const processor = await createLocalAudioProcessor(stream, processing);
        resources.processor = processor;
        const analysisStream =
          processor?.createMonitorStream() ??
          new MediaStream([stream.getAudioTracks()[0].clone()]);
        resources.analysisStream = analysisStream;
        const previewStream = shouldPlay
          ? (processor?.createMonitorStream() ??
            new MediaStream([stream.getAudioTracks()[0].clone()]))
          : null;
        resources.previewStream = previewStream;

        const ctx = new AudioContext();
        resources.audioContext = ctx;
        const analyser = ctx.createAnalyser();
        analyser.fftSize = 512;
        analyser.smoothingTimeConstant = 0.3;
        const source = ctx.createMediaStreamSource(analysisStream);
        source.connect(analyser);
        const silentOutput = ctx.createGain();
        silentOutput.gain.value = 0;
        analyser.connect(silentOutput);
        silentOutput.connect(ctx.destination);
        ctx.resume().catch(() => {});

        if (shouldPlay && previewStream) {
          const previewAudio = new Audio();
          resources.previewAudio = previewAudio;
          previewAudio.autoplay = true;
          previewAudio.muted = false;
          (
            previewAudio as HTMLAudioElement & { playsInline?: boolean }
          ).playsInline = true;
          previewAudio.srcObject = previewStream;

          const sinkId =
            outputDeviceId === "default" || outputDeviceId.startsWith("native:")
              ? ""
              : outputDeviceId;
          const sinkable = previewAudio as HTMLAudioElement & {
            setSinkId?: (nextSinkId: string) => Promise<void>;
          };
          if (typeof sinkable.setSinkId === "function") {
            await sinkable.setSinkId(sinkId).catch(() => {});
          }
          await previewAudio
            .play()
            .then(() => {
              if (startRequestRef.current === requestId) {
                setIsPlaybackActive(true);
              }
            })
            .catch(() => {
              if (startRequestRef.current === requestId) {
                setIsPlaybackActive(false);
              }
            });
        } else {
          setIsPlaybackActive(false);
        }

        if (startRequestRef.current !== requestId) {
          clearDetachedResources(resources);
          return;
        }

        streamRef.current = stream;
        processorRef.current = processor;
        analysisStreamRef.current = analysisStream;
        previewStreamRef.current = previewStream;
        previewAudioRef.current = resources.previewAudio;
        audioCtxRef.current = ctx;
        analyserRef.current = analyser;

        const dataArray = new Uint8Array(analyser.frequencyBinCount);
        const tick = () => {
          rafRef.current = 0;
          if (!analyserRef.current) return;
          // Hidden or behind a fullscreen game: stop; the effect below
          // restarts the loop when the app is drawn again.
          if (!appActiveRef.current) return;
          analyserRef.current.getByteTimeDomainData(dataArray);
          let sum = 0;
          for (let i = 0; i < dataArray.length; i++) {
            const value = (dataArray[i] - 128) / 128.0;
            sum += value * value;
          }
          const currentRms = Math.sqrt(sum / dataArray.length) * 100;
          const previousMeterState = meterStateRef.current;
          const smoothedRms =
            previousMeterState.smoothedRms > 0
              ? previousMeterState.smoothedRms * (1 - RMS_SMOOTHING) +
                currentRms * RMS_SMOOTHING
              : currentRms;
          const now = performance.now();
          const currentThreshold = thresholdRef.current;
          const exitThreshold = currentThreshold * SPEAKING_EXIT_RATIO;
          let nextSpeaking = previousMeterState.isSpeaking;
          let lastSpeechAt = previousMeterState.lastSpeechAt;

          if (smoothedRms >= currentThreshold) {
            nextSpeaking = true;
            lastSpeechAt = now;
          } else if (
            previousMeterState.isSpeaking &&
            now - previousMeterState.lastSpeechAt < SPEAKING_HOLD_MS
          ) {
            nextSpeaking = true;
          } else if (smoothedRms <= exitThreshold) {
            nextSpeaking = false;
          }

          meterStateRef.current = {
            smoothedRms,
            isSpeaking: nextSpeaking,
            lastSpeechAt,
          };

          if (now - lastPaintRef.current >= METER_FRAME_MS) {
            lastPaintRef.current = now;
            const level = getVoiceActivityLevelPercent(smoothedRms) / 100;
            if (fillRef.current) {
              fillRef.current.style.transform = `scaleX(${quantizeLevel(level).toFixed(3)})`;
            }
          }
          // Only a flip re-renders (the label and colour), never a frame.
          setIsSpeaking((previous) =>
            previous === nextSpeaking ? previous : nextSpeaking,
          );
          rafRef.current = requestAnimationFrame(tick);
        };

        tickRef.current = tick;
        rafRef.current = requestAnimationFrame(tick);
        setIsActive(true);
      } catch (error) {
        if (startRequestRef.current === requestId) {
          log.error("Failed to start mic test:", error);
          clearDetachedResources(resources);
          stopTest({ cancelPendingStart: true });
        } else {
          clearDetachedResources(resources);
        }
      }
    },
    [
      clearDetachedResources,
      inputDeviceId,
      outputDeviceId,
      processing,
      stopTest,
    ],
  );

  useEffect(() => {
    if (!isActive) return;
    const configKey = `${inputDeviceId}:${outputDeviceId}:${processingSignature}`;
    if (activeConfigRef.current === configKey) return;
    activeConfigRef.current = configKey;

    const timeoutId = window.setTimeout(() => {
      startTest({ playback: true, preserveUi: true }).catch(() => {});
    }, 120);

    return () => window.clearTimeout(timeoutId);
  }, [inputDeviceId, outputDeviceId, processingSignature, isActive, startTest]);

  useEffect(() => {
    return () => {
      stopTest({ cancelPendingStart: true });
    };
  }, [stopTest]);

  /* Pause the meter loop while the app isn't drawn; resume after. */
  useEffect(() => {
    appActiveRef.current = appActive;
    if (appActive && tickRef.current && !rafRef.current) {
      rafRef.current = requestAnimationFrame(tickRef.current);
    }
  }, [appActive]);

  return (
    <div className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-2">
      <Button
        type="button"
        variant={isPlaybackActive ? "destructive" : "secondary"}
        size="lg"
        aria-pressed={isPlaybackActive}
        onClick={() => {
          if (isPlaybackActive) {
            stopTest({ cancelPendingStart: true });
          } else {
            startTest({ playback: true }).catch(() => {});
          }
        }}
      >
        <Icon name={isPlaybackActive ? "stop" : "mic"} size="sm" />
        {isPlaybackActive ? "Stop test" : "Test mic"}
      </Button>

      <div
        className="relative h-6 min-w-40 flex-1 basis-40"
        role="img"
        aria-label={
          !isActive
            ? "Mic level, idle"
            : isSpeaking
              ? "Mic level, people can hear you"
              : "Mic level, below the sensitivity marker"
        }
      >
        {/* The cells: a tint-3 track and the moving fill, both cut by one
            static mask. Only the fill's transform changes. */}
        <div
          aria-hidden="true"
          className="absolute inset-x-0 top-1/2 h-3 -translate-y-1/2 overflow-hidden bg-tint-3"
          style={{
            maskImage: METER_CELL_MASK,
            WebkitMaskImage: METER_CELL_MASK,
          }}
        >
          <div
            ref={fillRef}
            className={cn(
              "absolute inset-0 origin-left",
              !isActive ? "opacity-0" : isSpeaking ? "bg-talk" : "bg-ink-3",
            )}
            style={{ transform: "scaleX(0)" }}
          />
        </div>
        {isActive ? (
          <span
            aria-hidden="true"
            className="absolute top-1/2 h-5 w-0.5 -translate-x-1/2 -translate-y-1/2 bg-warning-ink"
            style={{ left: `${thresholdPercent}%` }}
          />
        ) : null}
      </div>
    </div>
  );
}
