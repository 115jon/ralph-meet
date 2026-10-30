// ============================================================================
// StreamingStatsPanel — live native screen-share stats surface
//
// Replaces the static "Stable" connection label (owned-game-capture-hook spec,
// Req 8). It is a presentational component: it takes the connection/joined
// state as props and pulls live native stats from `useNativeShareStats()`.
//
// Behavior:
//  - No native data (off-desktop via isDesktop=false, or no active share):
//    render just the connection state, exactly what the old "Stable" label did
//    (Req 8.9, 8.11, 13.3).
//  - Native data + an active share: render the capture mode (hook / wgc /
//    capture-unavailable — Req 8.2), the Graphics_API_Backend ONLY when the
//    mode is `hook` (Req 8.3), the encoder backend (Req 8.4), forwarded +
//    dropped frame counts and a computed fps (Req 8.5), capture (fused-GPU) and
//    encode timing in ms (Req 8.6), the negotiated resolution + fps or a
//    pending indicator (Req 9.2, 9.5), the fallback reason when non-`none`
//    (Req 8.7), and a stale indicator when the stats refresh failed (Req 8.10).
//
// The fps is computed from successive snapshots via the pure `computeFps`
// helper (Req 8.5); this component tracks the previous forwarded-frame count
// and the wall-clock time it was observed.
// ============================================================================
import { useNativeShareStats } from "@/hooks/useNativeShareStats";
import { cn } from "@/lib/utils";
import type { NativeShareStatsSnapshot } from "@/types/native-share-stats";
import { useEffect, useRef, useState } from "react";
import { LedLabel, type LedState } from "@/components/ui/led";
import { Num } from "@/components/ui/num";
import {
  connectionStatus,
  type ConnectionTone,
} from "@/lib/voice/connection-status-label";
import {
  captureModeDisplay,
  computeFps,
  formatNegotiatedFps,
  formatResolution,
  graphicsBackendLabel,
  hasLiveCaptureActivity,
  usToMs,
} from "./streamingStats";

interface StreamingStatsPanelProps {
  /** WebRTC connection state string (e.g. `"connected"`, `"new"`, `"failed"`). */
  connectionState: string;
  /** Whether the local user has joined the voice/room session. */
  joined: boolean;
  /**
   * When the focused/overlay header is active the label sits over video and
   * needs lighter colors — mirrors the existing header `focusedItem` styling.
   */
  emphasized?: boolean;
  /**
   * Optional explicit "a native share is active" override. When omitted the
   * panel infers activity from the snapshot (`hasLiveCaptureActivity`).
   */
  shareActive?: boolean;
  className?: string;
}

/**
 * The connection word is a status LED label (DESIGN.md, LED label): connected
 * lights talk green, reconnecting amber, a failure muted red, and a state
 * still on its way stays unlit. Over focused media (`emphasized`) the word
 * stays white so it reads on the black gradient; the LED still carries the
 * state.
 */
const TONE_LED: Record<ConnectionTone, LedState> = {
  good: "talk",
  pending: "off",
  warning: "idle",
  danger: "muted",
};

function ConnectionLabel({
  connectionState,
  joined,
  emphasized,
  className,
}: {
  connectionState: string;
  joined: boolean;
  emphasized: boolean;
  className?: string;
}) {
  const { label, tone } = connectionStatus(connectionState, joined);
  return (
    <LedLabel
      role="status"
      state={TONE_LED[tone]}
      className={cn(
        "whitespace-nowrap",
        emphasized && "text-white/80",
        className,
      )}
    >
      {/* A phone header has no room for "Connected": the lit LED says it and
          the word stays for screen readers. Anything else keeps its word. */}
      <span className={cn(tone === "good" && "max-sm:sr-only")}>{label}</span>
    </LedLabel>
  );
}

export function StreamingStatsPanel({
  connectionState,
  joined,
  emphasized = false,
  shareActive,
  className,
}: StreamingStatsPanelProps) {
  const { data, stale } = useNativeShareStats();

  // Track the previous forwarded-frame sample so fps can be computed from the
  // delta over the elapsed interval (Req 8.5).
  const prevSampleRef = useRef<{ forwarded: number; atMs: number } | null>(
    null,
  );
  const [fps, setFps] = useState(0);

  const forwarded = data?.captured_frames ?? 0;

  useEffect(() => {
    if (!data) {
      prevSampleRef.current = null;
      return;
    }
    const now = Date.now();
    const prev = prevSampleRef.current;
    if (prev) {
      // A reset/decrease in the cumulative counter means a new session; treat
      // it as a fresh baseline (computeFps already clamps such cases to 0).
      setFps(computeFps(prev.forwarded, prev.atMs, forwarded, now));
    }
    prevSampleRef.current = { forwarded, atMs: now };
  }, [data, forwarded]);

  const active =
    shareActive !== undefined ? shareActive : hasLiveCaptureActivity(data);

  // No native data, or no active share: render just the connection state —
  // exactly what the old "Stable" label did (Req 8.9, 8.11, 13.3).
  if (!data || !active) {
    return (
      <ConnectionLabel
        connectionState={connectionState}
        joined={joined}
        emphasized={emphasized}
        className={className}
      />
    );
  }

  return (
    <StreamingStatsContent
      data={data}
      stale={stale}
      fps={data ? fps : 0}
      emphasized={emphasized}
      className={className}
    />
  );
}

interface StreamingStatsContentProps {
  data: NativeShareStatsSnapshot;
  stale: boolean;
  fps: number;
  emphasized: boolean;
  className?: string;
}

/** The active-share stats row. Split out so the inactive path stays trivial. */
function StreamingStatsContent({
  data,
  stale,
  fps,
  emphasized,
  className,
}: StreamingStatsContentProps) {
  const mode = captureModeDisplay(data);
  const backend = graphicsBackendLabel(data);
  const resolution = formatResolution(
    data.negotiated_width,
    data.negotiated_height,
  );
  const negotiatedFps = formatNegotiatedFps(data.negotiated_fps);
  const showFallback = data.fallback_reason !== "none";

  const toneClass =
    mode.tone === "hook"
      ? "text-success-ink"
      : mode.tone === "unavailable"
        ? "text-danger-ink"
        : "text-warning-ink";

  // Over focused media the readout stays white; on theme surfaces it takes ink.
  const mutedClass = emphasized ? "text-white/60" : "text-ink-3";
  const valueClass = emphasized ? "text-white/90" : "text-ink-1";
  const dividerClass = emphasized ? "bg-white/20" : "bg-line-strong";

  return (
    <div
      className={cn(
        "flex items-center gap-2 text-ui-xs font-medium",
        className,
      )}
      title={`Capture ${mode.text}${backend ? ` (${backend})` : ""} · encoder ${data.encoder_backend}`}
    >
      {/* Capture mode (Req 8.2) */}
      <span className={cn("font-semibold", toneClass)}>{mode.text}</span>

      {/* Graphics_API_Backend — only while mode is hook (Req 8.3) */}
      {backend && (
        <>
          <Divider className={dividerClass} />
          <span className={valueClass}>{backend}</span>
        </>
      )}

      {/* Encoder backend (Req 8.4) */}
      <Divider className={dividerClass} />
      <span className={valueClass}>{data.encoder_backend}</span>

      {/* Forwarded / dropped counts + computed fps (Req 8.5) */}
      <Divider className={dividerClass} />
      <span className={mutedClass}>
        <Num className={valueClass}>{fps.toFixed(0)}</Num> fps
      </span>
      <span className={mutedClass}>
        <Num className={valueClass}>{data.captured_frames}</Num> fwd
      </span>
      <span className={mutedClass}>
        <Num className={valueClass}>{data.dropped_frames}</Num> drop
      </span>

      {/* Capture (fused-GPU) + encode timing in ms (Req 8.6) */}
      <Divider className={dividerClass} />
      <span className={mutedClass}>
        gpu <Num className={valueClass}>{usToMs(data.last_fused_gpu_us)}</Num>{" "}
        ms
      </span>
      <span className={mutedClass}>
        enc{" "}
        <Num className={valueClass}>{usToMs(data.last_encode_submit_us)}</Num>{" "}
        ms
      </span>

      {/* Negotiated resolution + fps, or a pending indicator (Req 9.2, 9.5) */}
      <Divider className={dividerClass} />
      {resolution && negotiatedFps ? (
        <Num className={valueClass}>
          {resolution}
          <span className={mutedClass}>@{negotiatedFps}</span>
        </Num>
      ) : (
        <span className={mutedClass}>negotiating…</span>
      )}

      {/* Fallback reason when non-`none` (Req 8.7) */}
      {showFallback && (
        <>
          <Divider className={dividerClass} />
          <span className="text-warning-ink">{data.fallback_reason}</span>
        </>
      )}

      {/* Stale indicator (Req 8.10) */}
      {stale && (
        <>
          <Divider className={dividerClass} />
          <span
            className="text-warning-ink"
            title="Stats refresh failed — showing last known values"
          >
            stale
          </span>
        </>
      )}
    </div>
  );
}

function Divider({ className }: { className?: string }) {
  return <span className={cn("h-3 w-px", className)} aria-hidden />;
}
