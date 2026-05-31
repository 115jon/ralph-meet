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
import {
  captureModeDisplay,
  computeFps,
  connectionStateLabel,
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

/** Shared text styling for the connection-state / mode label. */
function labelClass(emphasized: boolean): string {
  return cn(
    "text-[10px] font-black uppercase tracking-widest",
    emphasized ? "text-white/60" : "text-rm-text-muted/40",
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
      setFps(0);
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
      <span className={cn(labelClass(emphasized), className)}>
        {connectionStateLabel(connectionState, joined)}
      </span>
    );
  }

  return (
    <StreamingStatsContent
      data={data}
      stale={stale}
      fps={fps}
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
      ? "text-emerald-400"
      : mode.tone === "unavailable"
        ? "text-rose-400"
        : "text-amber-400";

  const mutedClass = emphasized ? "text-white/60" : "text-rm-text-muted/70";
  const valueClass = emphasized ? "text-white/90" : "text-rm-text/90";
  const dividerClass = emphasized ? "bg-white/20" : "bg-rm-border";

  return (
    <div
      className={cn(
        "flex items-center gap-2 text-[10px] font-bold uppercase tracking-wider",
        className,
      )}
      title={`Capture ${mode.text}${backend ? ` (${backend})` : ""} · encoder ${data.encoder_backend}`}
    >
      {/* Capture mode (Req 8.2) */}
      <span className={cn("font-black", toneClass)}>{mode.text}</span>

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
        <span className={valueClass}>{fps.toFixed(0)}</span> fps
      </span>
      <span className={mutedClass}>
        <span className={valueClass}>{data.captured_frames}</span> fwd
      </span>
      <span className={mutedClass}>
        <span className={valueClass}>{data.dropped_frames}</span> drop
      </span>

      {/* Capture (fused-GPU) + encode timing in ms (Req 8.6) */}
      <Divider className={dividerClass} />
      <span className={mutedClass}>
        gpu <span className={valueClass}>{usToMs(data.last_fused_gpu_us)}</span>
        ms
      </span>
      <span className={mutedClass}>
        enc{" "}
        <span className={valueClass}>{usToMs(data.last_encode_submit_us)}</span>
        ms
      </span>

      {/* Negotiated resolution + fps, or a pending indicator (Req 9.2, 9.5) */}
      <Divider className={dividerClass} />
      {resolution && negotiatedFps ? (
        <span className={valueClass}>
          {resolution}
          <span className={mutedClass}>@{negotiatedFps}</span>
        </span>
      ) : (
        <span className={cn("italic normal-case", mutedClass)}>
          negotiating…
        </span>
      )}

      {/* Fallback reason when non-`none` (Req 8.7) */}
      {showFallback && (
        <>
          <Divider className={dividerClass} />
          <span className="text-amber-400">{data.fallback_reason}</span>
        </>
      )}

      {/* Stale indicator (Req 8.10) */}
      {stale && (
        <>
          <Divider className={dividerClass} />
          <span className="text-amber-400/80" title="Stats refresh failed — showing last known values">
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
