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
import { useEffect, useMemo, useRef, useState } from "react";

interface InputSensitivityMeterProps {
  autoSensitivity: boolean;
  inputDeviceId: string;
  processing: VoiceAudioProcessingSettings;
  value: number;
  onCommit: (value: number) => void;
}

export function InputSensitivityMeter({
  autoSensitivity,
  inputDeviceId,
  processing,
  value,
  onCommit,
}: InputSensitivityMeterProps) {
  const [rms, setRms] = useState(0);
  const [draftValue, setDraftValue] = useState(value);
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
        if (requestIdRef.current !== requestId) {
          processor?.destroy();
          stream.getTracks().forEach((track) => track.stop());
          return;
        }
        monitorStream =
          processor?.createMonitorStream() ??
          new MediaStream([stream.getAudioTracks()[0].clone()]);
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
        const tick = () => {
          if (requestIdRef.current !== requestId) return;
          let currentRms: number;
          if (typeof analyser.getFloatTimeDomainData === "function") {
            analyser.getFloatTimeDomainData(data);
            currentRms = calculateTimeDomainRms(data);
          } else {
            const byteData = new Uint8Array(data.length);
            analyser.getByteTimeDomainData(byteData);
            currentRms = calculateTimeDomainRms(byteData);
          }
          setRms(currentRms);
          animationFrame = requestAnimationFrame(tick);
        };
        animationFrame = requestAnimationFrame(tick);
      } catch {
        setRms(0);
        cleanup();
      }
    };

    void start();
    return cleanup;
  }, [inputDeviceId, processing, processingSignature]);

  const sensitivityPercent = Math.min(100, Math.max(0, draftValue + 100));
  const levelPercent = getVoiceActivityLevelPercent(rms);
  const levelDb = rms > 0 ? Math.max(-100, 20 * Math.log10(rms / 100)) : -100;

  return (
    <label className="block space-y-3 py-3" htmlFor="input-sensitivity">
      <span className="flex items-center justify-between gap-3 text-sm font-semibold text-rm-text">
        <span>Input sensitivity</span>
        <span className="flex items-center gap-2 tabular-nums text-xs font-medium text-rm-text-muted">
          <span className="text-rm-text" title="Measured microphone level">
            {levelDb <= -99 ? "< -99 dB" : `${Math.round(levelDb)} dB`}
          </span>
          <span>
            Threshold {autoSensitivity ? "Automatic" : `${draftValue} dB`}
          </span>
        </span>
      </span>
      <div className="relative h-2 overflow-hidden rounded-full bg-rm-bg-elevated">
        <div
          className="absolute inset-0"
          style={{
            background: `linear-gradient(to right, color-mix(in srgb, var(--rm-status-idle) 88%, var(--rm-bg-surface)) 0%, color-mix(in srgb, var(--rm-status-idle) 88%, var(--rm-bg-surface)) ${sensitivityPercent}%, color-mix(in srgb, var(--rm-status-online) 88%, var(--rm-bg-surface)) ${sensitivityPercent}%, color-mix(in srgb, var(--rm-status-online) 88%, var(--rm-bg-surface)) 100%)`,
          }}
        />
        <div
          className="absolute inset-y-0 right-0"
          style={{
            width: `${100 - levelPercent}%`,
            backgroundColor:
              "color-mix(in srgb, var(--rm-bg-primary) 56%, transparent)",
          }}
          aria-hidden="true"
        />
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
          onPointerUp={() => onCommit(draftValue)}
          onKeyUp={(event) => {
            if (
              ["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)
            ) {
              onCommit(draftValue);
            }
          }}
          className="absolute inset-0 h-2 w-full cursor-ew-resize appearance-none bg-transparent accent-rm-accent disabled:cursor-not-allowed disabled:opacity-40 [&::-moz-range-thumb]:h-4 [&::-moz-range-thumb]:w-4 [&::-moz-range-thumb]:cursor-ew-resize [&::-moz-range-thumb]:rounded-full [&::-moz-range-thumb]:border-0 [&::-moz-range-thumb]:bg-white [&::-webkit-slider-thumb]:h-4 [&::-webkit-slider-thumb]:w-4 [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:cursor-ew-resize [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-white"
          aria-label="Input sensitivity"
        />
      </div>
    </label>
  );
}
