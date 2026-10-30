import {
  createLocalAudioProcessor,
  resolveCaptureAudioProcessing,
  type LocalAudioProcessorHandle,
  type VoiceAudioProcessingSettings,
} from "@/lib/voice/noise-reduction";
import { getAudioCaptureStream } from "@/lib/audio-capture";
import {
  calculateTimeDomainRms,
  getVoiceActivityLevelPercent,
} from "@/lib/voice/vad";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { useAppActive } from "@/hooks/useAppActive";
import { cn } from "@/lib/utils";
import { useEffect, useMemo, useRef, useState } from "react";

/** The level bar is written at most this often (30fps). */
const METER_FRAME_MS = 1000 / 30;

interface InputSensitivityMeterProps {
  autoSensitivity: boolean;
  inputDeviceId: string;
  processing: VoiceAudioProcessingSettings;
  value: number;
  onCommit: (value: number) => void;
  /**
   * id of a visible label rendered by the caller (a settings row). When set,
   * the meter drops its own "Input sensitivity" caption.
   */
  labelledBy?: string;
}

export function InputSensitivityMeter({
  autoSensitivity,
  inputDeviceId,
  processing,
  value,
  onCommit,
  labelledBy,
}: InputSensitivityMeterProps) {
  const [draftValue, setDraftValue] = useState(value);
  /**
   * The live level is written straight to this element as
   * `transform: scaleX(level)` (at most 30fps), never through React state,
   * so the row doesn't re-render per frame. Above the marker it turns talk
   * green (a data attribute, written only on a flip).
   */
  const levelRef = useRef<HTMLDivElement | null>(null);
  const appActive = useAppActive();
  const appActiveRef = useRef(appActive);
  const loopRef = useRef<{ start: () => void; stop: () => void } | null>(null);
  const thresholdRef = useRef(draftValue);
  useEffect(() => {
    thresholdRef.current = draftValue;
  }, [draftValue]);
  const [isTooltipOpen, setIsTooltipOpen] = useState(false);
  const requestIdRef = useRef(0);
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

  useEffect(() => {
    const requestId = requestIdRef.current + 1;
    requestIdRef.current = requestId;
    let animationFrame = 0;
    let stream: MediaStream | null = null;
    let monitorStream: MediaStream | null = null;
    let processor: LocalAudioProcessorHandle | null = null;
    let context: AudioContext | null = null;
    const cleanup = () => {
      if (animationFrame) cancelAnimationFrame(animationFrame);
      animationFrame = 0;
      loopRef.current = null;
      monitorStream?.getTracks().forEach((track) => track.stop());
      processor?.destroy();
      stream?.getTracks().forEach((track) => track.stop());
      context?.close().catch(() => {});
    };

    const start = async () => {
      try {
        const capture = resolveCaptureAudioProcessing(processing);
        stream = await getAudioCaptureStream({
          deviceId: inputDeviceId,
          audio: {
            noiseSuppression: capture.noiseSuppression,
            echoCancellation: capture.echoCancellation,
            autoGainControl: capture.autoGainControl,
            channelCount: 2,
          },
        });
        if (requestIdRef.current !== requestId) {
          stream.getTracks().forEach((track) => track.stop());
          return;
        }

        processor = await createLocalAudioProcessor(stream, processing);
        if (!processor) {
          stream.getTracks().forEach((track) => track.stop());
          return;
        }
        monitorStream = processor.createMonitorStream();
        if (monitorStream.getAudioTracks().length === 0) {
          cleanup();
          return;
        }
        context = new AudioContext();
        const analyser = context.createAnalyser();
        analyser.fftSize = 512;
        analyser.smoothingTimeConstant = 0.3;
        const source = context.createMediaStreamSource(monitorStream);
        source.connect(analyser);
        const silentOutput = context.createGain();
        silentOutput.gain.value = 0;
        analyser.connect(silentOutput);
        silentOutput.connect(context.destination);
        context.resume().catch(() => {});

        const data = new Float32Array(analyser.frequencyBinCount);
        let lastPaint = 0;
        let over: boolean | null = null;
        const tick = () => {
          animationFrame = 0;
          if (requestIdRef.current !== requestId) return;
          if (!appActiveRef.current) return;
          let currentRms: number;
          if (typeof analyser.getFloatTimeDomainData === "function") {
            analyser.getFloatTimeDomainData(data);
            currentRms = calculateTimeDomainRms(data);
          } else {
            const byteData = new Uint8Array(data.length);
            analyser.getByteTimeDomainData(byteData);
            currentRms = calculateTimeDomainRms(byteData);
          }
          const now = performance.now();
          const node = levelRef.current;
          if (node && now - lastPaint >= METER_FRAME_MS) {
            lastPaint = now;
            const level = getVoiceActivityLevelPercent(currentRms);
            node.style.transform = `scaleX(${(level / 100).toFixed(3)})`;
            const nextOver = level >= thresholdRef.current + 100;
            if (nextOver !== over) {
              over = nextOver;
              node.toggleAttribute("data-over", nextOver);
            }
          }
          animationFrame = requestAnimationFrame(tick);
        };
        loopRef.current = {
          start: () => {
            if (!animationFrame) animationFrame = requestAnimationFrame(tick);
          },
          stop: () => {
            if (animationFrame) cancelAnimationFrame(animationFrame);
            animationFrame = 0;
          },
        };
        if (appActiveRef.current) loopRef.current.start();
      } catch {
        if (levelRef.current) levelRef.current.style.transform = "scaleX(0)";
        cleanup();
      }
    };

    void start();
    return cleanup;
  }, [inputDeviceId, processing, processingSignature]);

  /* Stop the loop while the app isn't drawn (hidden, behind a game). */
  useEffect(() => {
    appActiveRef.current = appActive;
    if (appActive) loopRef.current?.start();
    else loopRef.current?.stop();
  }, [appActive]);

  const sensitivityPercent = Math.min(100, Math.max(0, draftValue + 100));

  const sensitivitySlider = (
    <input
      id="input-sensitivity"
      type="range"
      min="-100"
      max="0"
      value={draftValue}
      disabled={autoSensitivity}
      onChange={(event) => {
        const nextValue = Number(event.target.value);
        setDraftValue(nextValue);
      }}
      onPointerEnter={() => setIsTooltipOpen(true)}
      onPointerLeave={() => setIsTooltipOpen(false)}
      onPointerDown={() => setIsTooltipOpen(true)}
      onPointerUp={() => {
        onCommit(draftValue);
      }}
      onFocus={() => setIsTooltipOpen(true)}
      onBlur={() => setIsTooltipOpen(false)}
      onKeyUp={(event) => {
        if (["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) {
          onCommit(draftValue);
        }
      }}
      aria-label={labelledBy ? undefined : "Input sensitivity"}
      aria-labelledby={labelledBy}
      aria-valuetext={autoSensitivity ? "Automatic" : `${draftValue} dB`}
      // The box is the fader's travel: 28 high so the 12x28 ink-1 cap (the
      // kit's slider cap) sits centred on the 8px track without margins.
      className={`absolute inset-x-0 top-1/2 h-7 w-full -translate-y-1/2 appearance-none bg-transparent focus-visible:outline-none ${
        autoSensitivity
          ? "pointer-events-none cursor-default opacity-0 [&::-moz-range-thumb]:hidden [&::-webkit-slider-thumb]:hidden"
          : "cursor-ew-resize"
      } [&::-moz-range-thumb]:h-7 [&::-moz-range-thumb]:w-3 [&::-moz-range-thumb]:cursor-ew-resize [&::-moz-range-thumb]:rounded-[2px] [&::-moz-range-thumb]:border-0 [&::-moz-range-thumb]:bg-ink-1 [&::-webkit-slider-thumb]:h-7 [&::-webkit-slider-thumb]:w-3 [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:cursor-ew-resize [&::-webkit-slider-thumb]:rounded-[2px] [&::-webkit-slider-thumb]:bg-ink-1 [&:focus-visible::-moz-range-thumb]:outline-2 [&:focus-visible::-moz-range-thumb]:outline-offset-2 [&:focus-visible::-moz-range-thumb]:outline-focus [&:focus-visible::-webkit-slider-thumb]:outline-2 [&:focus-visible::-webkit-slider-thumb]:outline-offset-2 [&:focus-visible::-webkit-slider-thumb]:outline-focus`}
    />
  );

  const Wrapper = labelledBy ? "div" : "label";
  return (
    <Wrapper
      className={cn(
        "block space-y-3",
        labelledBy ? "py-3" : "py-4",
        autoSensitivity && "cursor-default",
      )}
      {...(labelledBy ? {} : { htmlFor: "input-sensitivity" })}
    >
      {labelledBy ? null : (
        <span className="silkscreen text-ink-2">Input sensitivity</span>
      )}
      <div
        className={cn(
          "relative h-2 overflow-visible rounded-[1px]",
          autoSensitivity ? "cursor-default bg-tint-2" : "bg-tint-3",
        )}
      >
        {!autoSensitivity && (
          <div
            aria-hidden="true"
            className="absolute inset-0 overflow-hidden rounded-[1px]"
          >
            {/* Zones: below the marker you're silent (idle), above it
                people hear you (talk). Static; only the level moves. */}
            <div
              className="absolute inset-y-0 left-0 bg-warning-tint"
              style={{ width: `${sensitivityPercent}%` }}
            />
            <div
              className="absolute inset-y-0 right-0 bg-talk-tint"
              style={{ width: `${100 - sensitivityPercent}%` }}
            />
            <div
              ref={levelRef}
              className="absolute inset-0 origin-left bg-idle data-over:bg-talk"
              style={{ transform: "scaleX(0)" }}
            />
          </div>
        )}
        {autoSensitivity ? (
          sensitivitySlider
        ) : (
          <Tooltip open={isTooltipOpen} onOpenChange={setIsTooltipOpen}>
            <TooltipTrigger asChild>
              <span
                className="pointer-events-none absolute top-1/2 z-20 h-7 w-3 -translate-x-1/2 -translate-y-1/2 rounded-[2px]"
                style={{ left: `${sensitivityPercent}%` }}
                aria-hidden="true"
              />
            </TooltipTrigger>
            <TooltipContent side="top" sideOffset={8}>
              {draftValue} dB
            </TooltipContent>
            {sensitivitySlider}
          </Tooltip>
        )}
      </div>
    </Wrapper>
  );
}
