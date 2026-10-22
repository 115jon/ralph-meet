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
import { Icon } from "@/components/ui/icon";
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
  const [rms, setRms] = useState(0);
  const [isSpeaking, setIsSpeaking] = useState(false);
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
  const barPercent = getVoiceActivityLevelPercent(rms);
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
    setRms(0);
    setIsSpeaking(false);
  }, []);

  const stopTest = useCallback(
    (options?: { preserveUi?: boolean; cancelPendingStart?: boolean }) => {
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
          if (!analyserRef.current) return;
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

          setRms(smoothedRms);
          setIsSpeaking((previous) =>
            previous === nextSpeaking ? previous : nextSpeaking,
          );
          rafRef.current = requestAnimationFrame(tick);
        };

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

  return (
    <div className="flex min-w-0 items-center gap-3">
      <button
        type="button"
        onClick={() => {
          if (isPlaybackActive) {
            stopTest({ cancelPendingStart: true });
          } else {
            startTest({ playback: true }).catch(() => {});
          }
        }}
        className={`shrink-0 rounded-lg border px-4 py-2 text-sm font-semibold transition-colors active:scale-[0.96] ${
          isPlaybackActive
            ? "border-destructive/30 bg-destructive/10 text-destructive hover:bg-destructive/20"
            : "border-rm-accent bg-rm-accent text-white hover:bg-rm-accent/90"
        }`}
      >
        <span className="flex items-center gap-1.5">
          {isPlaybackActive ? (
            <Icon name="stop" size="xs" />
          ) : (
            <Icon name="mic" size="xs" />
          )}
          {isPlaybackActive ? "Stop testing" : "Mic Test"}
        </span>
      </button>

      <div
        className="flex min-w-0 flex-1 items-center gap-1.5"
        aria-label="Microphone test level"
      >
        {Array.from({ length: METER_BARS }, (_, index) => {
          const start = (index / METER_BARS) * 100;
          const end = ((index + 1) / METER_BARS) * 100;
          const isFilled = isActive && barPercent >= start;
          const marksThreshold =
            isActive &&
            thresholdPercent >= start &&
            (thresholdPercent < end ||
              (index === METER_BARS - 1 && thresholdPercent === 100));

          return (
            <div
              key={index}
              className={`h-1.5 flex-1 rounded-sm transition-colors ${
                !isActive
                  ? "bg-rm-bg-elevated"
                  : marksThreshold
                    ? "bg-amber-400/90"
                    : isFilled
                      ? isSpeaking
                        ? "bg-emerald-400/90"
                        : "bg-sky-400/80"
                      : "bg-rm-bg-surface"
              }`}
            />
          );
        })}
      </div>
    </div>
  );
}
