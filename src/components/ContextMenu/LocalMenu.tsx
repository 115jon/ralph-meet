import type { ScreenShareOptions } from "@/lib/screen-share-types";
import type { ScreenShareSourceState } from "@/lib/screen-share-types";
import { Icon } from "@/components/ui/icon";
import { divider, type StreamMenuEntry } from "./ContextMenuItems";

export interface LocalMenuOptions {
  isStreaming?: boolean;
  onToggleScreenShare?: (options?: ScreenShareOptions) => void;
  onClose: () => void;
  onChangeSource?: () => void;
  availableQualities: string[];
  currentScreenQuality?: string;
  currentScreenSource?: ScreenShareSourceState | null;
  isStreamingAudio?: boolean;
  onToggleStreamAudio?: () => void;
  onLeave?: () => void;
  handleProfile: () => void;
  isMuted?: boolean;
  onToggleMute?: () => void;
  isDeafened?: boolean;
  onToggleDeafen?: () => void;
  handleCopyId: () => void;
  showDisconnect?: boolean;
  alwaysShowStreamPreview?: boolean;
  onToggleAlwaysShowStreamPreview?: () => void;
}

const ID_BADGE = (
  <span className="rounded-xs bg-tint-2 px-1 text-ui-2xs font-semibold text-ink-3">
    ID
  </span>
);

/** Entries for the menu on your own tile or voice row. */
export function buildLocalMenu({
  isStreaming,
  onToggleScreenShare,
  onClose,
  onChangeSource,
  availableQualities,
  currentScreenQuality,
  currentScreenSource,
  isStreamingAudio,
  onToggleStreamAudio,
  onLeave,
  handleProfile,
  isMuted,
  onToggleMute,
  isDeafened,
  onToggleDeafen,
  handleCopyId,
  showDisconnect = true,
  alwaysShowStreamPreview,
  onToggleAlwaysShowStreamPreview,
}: LocalMenuOptions): StreamMenuEntry[] {
  const disconnect: StreamMenuEntry = {
    type: "item",
    key: "disconnect",
    label: "Leave call",
    danger: true,
    onSelect: () => {
      onLeave?.();
      onClose();
    },
  };

  if (isStreaming) {
    return [
      {
        type: "item",
        key: "stop-streaming",
        label: "Stop streaming",
        danger: true,
        onSelect: () => {
          onToggleScreenShare?.();
          onClose();
        },
        trailing: <Icon name="streamOff" size="sm" />,
      },
      {
        type: "item",
        key: "change-stream",
        label: "Change stream",
        onSelect: () => {
          onChangeSource?.();
          onClose();
        },
        trailing: <Icon name="screenShare" size="sm" />,
      },
      {
        type: "submenu",
        key: "stream-quality",
        label: "Stream quality",
        entries: availableQualities.map((q) => ({
          type: "item",
          key: q,
          label: q.replace("p", "p "),
          checked: currentScreenQuality === q,
          onSelect: () => {
            onToggleScreenShare?.({
              quality: q,
              withAudio: !!isStreamingAudio,
              sourceId: currentScreenSource?.sourceId ?? undefined,
              captureId: currentScreenSource?.captureId ?? undefined,
              sourceName: currentScreenSource?.sourceName ?? undefined,
              sourceKind: currentScreenSource?.sourceKind ?? undefined,
            });
            onClose();
          },
        })),
      },
      {
        type: "item",
        key: "share-stream-audio",
        label: "Share stream audio",
        checked: !!isStreamingAudio,
        onSelect: () => {
          onToggleStreamAudio?.();
          onClose();
        },
      },
      ...(onToggleAlwaysShowStreamPreview
        ? [
            divider("preview"),
            {
              type: "item" as const,
              key: "always-show-preview",
              label: "Always show stream preview",
              checked: !!alwaysShowStreamPreview,
              onSelect: () => {
                onToggleAlwaysShowStreamPreview?.();
                onClose();
              },
            },
          ]
        : []),
      ...(showDisconnect ? [divider("disconnect"), disconnect] : []),
    ];
  }

  return [
    {
      type: "item",
      key: "profile",
      label: "Profile",
      onSelect: handleProfile,
    },
    divider("profile"),
    {
      type: "item",
      key: "mute",
      label: "Mute",
      checked: !!isMuted,
      onSelect: onToggleMute,
    },
    {
      type: "item",
      key: "deafen",
      label: "Deafen",
      checked: !!isDeafened,
      onSelect: onToggleDeafen,
    },
    divider("deafen"),
    ...(showDisconnect ? [disconnect, divider("disconnect")] : []),
    {
      type: "item",
      key: "copy-id",
      label: "Copy user ID",
      onSelect: handleCopyId,
      trailing: ID_BADGE,
    },
  ];
}
