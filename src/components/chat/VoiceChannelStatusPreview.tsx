import { getAuthAssetUrl, getMediaUrl } from "@/lib/platform";
import type { VoiceChannelStatus } from "@/lib/types";
import { cn } from "@/lib/utils";
import { isVoiceChannelStatusVideo } from "@/lib/voice-channel-status";

interface VoiceChannelStatusPreviewProps {
  status: VoiceChannelStatus;
  compact?: boolean;
  className?: string;
}

export default function VoiceChannelStatusPreview({
  status,
  compact = false,
  className,
}: VoiceChannelStatusPreviewProps) {
  const media = status.media;
  const text = status.text?.trim();
  const mediaOnly = Boolean(media && !text);

  if (!media && !text) return null;

  return (
    <div className={cn(mediaOnly ? "w-full" : "flex min-w-0 items-center gap-2.5", className)}>
      {media && (
        <div
          style={mediaOnly ? { aspectRatio: `${Math.max(1, media.preview_width)} / ${Math.max(1, media.preview_height)}` } : undefined}
          className={cn(
            "overflow-hidden border border-white/8 bg-black/20 shadow-sm",
            mediaOnly
              ? "w-full rounded-[18px] shadow-[0_18px_36px_rgba(0,0,0,0.24)]"
              : compact
                ? "h-11 w-11 shrink-0 rounded-xl"
                : "h-16 w-16 shrink-0 rounded-xl"
          )}
        >
          {isVoiceChannelStatusVideo(media) ? (
            <video
              src={getMediaUrl(media.preview_url)}
              autoPlay
              loop
              muted
              playsInline
              className="h-full w-full object-contain"
            />
          ) : (
            <img
              src={getAuthAssetUrl(media.preview_url)}
              alt={media.alt_text ?? "Voice channel status media"}
              className="h-full w-full object-contain"
              loading="lazy"
            />
          )}
        </div>
      )}
      {text ? (
        <p className={cn("min-w-0 break-words text-rm-text-secondary", compact ? "text-[12px] leading-4" : "text-sm leading-5")}>
          {text}
        </p>
      ) : null}
    </div>
  );
}
