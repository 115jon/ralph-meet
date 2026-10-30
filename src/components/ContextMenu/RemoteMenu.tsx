import { Icon } from "@/components/ui/icon";
import { divider, type StreamMenuEntry } from "./ContextMenuItems";

export interface RemoteMenuOptions {
  userId: string;
  isStreaming?: boolean;
  watchedStreams: Record<string, boolean>;
  stopWatching: () => void;
  peerSetting: {
    volume: number;
    streamVolume: number;
    muted: boolean;
    alwaysHear: boolean;
    attenuationEnabled: boolean;
    attenuationStrength: number;
    soundboardMuted?: boolean;
  };
  toggleMutePeer: () => void;
  toggleSoundboardMute: () => void;
  setPeerVolume: (userId: string, val: number) => void;
  setPeerStreamVolume: (userId: string, val: number) => void;
  toggleAlwaysHear: () => void;
  toggleAttenuation: () => void;
  setPeerAttenuationStrength: (userId: string, val: number) => void;
  handleProfile: () => void;
  handleMessage: () => void;
  isModerator: boolean;
  serverSoundboardMuted?: boolean;
  toggleServerSoundboardMute?: () => void;
  onClose: () => void;
  handleCopyId: () => void;
  showDisconnect?: boolean;
}

const ID_BADGE = (
  <span className="rounded-xs bg-tint-2 px-1 text-ui-2xs font-semibold text-ink-3">
    ID
  </span>
);

/** Entries for the menu on someone else's tile or voice row. */
export function buildRemoteMenu({
  userId,
  isStreaming,
  watchedStreams,
  stopWatching,
  peerSetting,
  toggleMutePeer,
  toggleSoundboardMute,
  setPeerVolume,
  setPeerStreamVolume,
  toggleAlwaysHear,
  toggleAttenuation,
  setPeerAttenuationStrength,
  handleProfile,
  handleMessage,
  isModerator,
  serverSoundboardMuted,
  toggleServerSoundboardMute,
  handleCopyId,
}: RemoteMenuOptions): StreamMenuEntry[] {
  const alwaysHear: StreamMenuEntry = {
    type: "item",
    key: "always-hear",
    label: "Always hear stream audio",
    checked: peerSetting.alwaysHear,
    onSelect: toggleAlwaysHear,
  };
  const mute: StreamMenuEntry = {
    type: "item",
    key: "mute",
    label: "Mute",
    checked: peerSetting.muted,
    onSelect: toggleMutePeer,
  };
  const muteSoundboard: StreamMenuEntry = {
    type: "item",
    key: "mute-soundboard",
    label: "Mute soundboard",
    checked: !!peerSetting.soundboardMuted,
    onSelect: toggleSoundboardMute,
  };
  const profile: StreamMenuEntry = {
    type: "item",
    key: "profile",
    label: "Profile",
    onSelect: handleProfile,
  };
  const message: StreamMenuEntry = {
    type: "item",
    key: "message",
    label: "Message",
    onSelect: handleMessage,
  };
  const moderatorItems: StreamMenuEntry[] = isModerator
    ? [
        ...(toggleServerSoundboardMute
          ? [
              {
                type: "item" as const,
                key: "server-soundboard",
                label: serverSoundboardMuted
                  ? "Unmute soundboard for server"
                  : "Mute soundboard for server",
                danger: serverSoundboardMuted,
                onSelect: toggleServerSoundboardMute,
              },
            ]
          : []),
      ]
    : [];

  if (isStreaming && !watchedStreams[userId]) {
    return [
      {
        type: "item",
        key: "watch",
        label: "Watch stream",
        bold: true,
        onSelect: stopWatching,
        trailing: <Icon name="stream" size="sm" />,
      },
      divider("watch"),
      alwaysHear,
    ];
  }

  if (isStreaming) {
    return [
      {
        type: "item",
        key: "stop-watching",
        label: "Stop watching",
        bold: true,
        onSelect: stopWatching,
        trailing: <Icon name="streamOff" size="sm" />,
      },
      divider("watch"),
      mute,
      muteSoundboard,
      {
        type: "slider",
        key: "stream-volume",
        label: "Stream volume",
        value: peerSetting.streamVolume,
        onChange: (val) => setPeerStreamVolume(userId, val),
      },
      alwaysHear,
      divider("audio"),
      {
        type: "item",
        key: "attenuation",
        label: "Stream attenuation",
        description:
          "Automatically reduce stream volume when people are talking.",
        checked: peerSetting.attenuationEnabled,
        onSelect: toggleAttenuation,
      },
      ...(peerSetting.attenuationEnabled
        ? [
            {
              type: "slider" as const,
              key: "attenuation-strength",
              label: "Stream attenuation strength",
              value: peerSetting.attenuationStrength,
              max: 100,
              onChange: (val: number) =>
                setPeerAttenuationStrength(userId, val),
            },
          ]
        : []),
      divider("attenuation"),
      {
        type: "submenu",
        key: "more-options",
        label: "More options",
        entries: [
          profile,
          message,
          ...(moderatorItems.length > 0
            ? [divider("message"), ...moderatorItems]
            : []),
        ],
      },
    ];
  }

  return [
    profile,
    message,
    divider("message"),
    {
      type: "slider",
      key: "user-volume",
      label: "User volume",
      value: peerSetting.volume,
      onChange: (val) => setPeerVolume(userId, val),
    },
    divider("volume"),
    mute,
    muteSoundboard,
    divider("mute"),
    ...(moderatorItems.length > 0
      ? [...moderatorItems, divider("moderator")]
      : []),
    {
      type: "item",
      key: "copy-id",
      label: "Copy user ID",
      onSelect: handleCopyId,
      trailing: ID_BADGE,
    },
  ];
}
