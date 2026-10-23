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
  handleServerMute: () => void;
  handleServerDeafen: () => void;
  serverSoundboardMuted?: boolean;
  toggleServerSoundboardMute?: () => void;
  onClose: () => void;
  voiceChannels: any[];
  handleMove: (channelId: string) => void;
  handleCopyId: () => void;
  showDisconnect?: boolean;
}

const ID_BADGE = (
  <span className="rounded-sm bg-rm-bg-active px-1 text-ui-2xs font-semibold text-rm-text-muted">
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
  handleServerMute,
  handleServerDeafen,
  serverSoundboardMuted,
  toggleServerSoundboardMute,
  onClose,
  voiceChannels,
  handleMove,
  handleCopyId,
  showDisconnect = true,
}: RemoteMenuOptions): StreamMenuEntry[] {
  const alwaysHear: StreamMenuEntry = {
    type: "item",
    key: "always-hear",
    label: "Always Hear Stream Audio",
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
    label: "Mute Soundboard",
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
                  ? "Unmute Soundboard for Server"
                  : "Mute Soundboard for Server",
                danger: serverSoundboardMuted,
                onSelect: toggleServerSoundboardMute,
              },
            ]
          : []),
        {
          type: "item",
          key: "server-mute",
          label: "Server Mute",
          danger: true,
          onSelect: handleServerMute,
        },
        {
          type: "item",
          key: "server-deafen",
          label: "Server Deafen",
          danger: true,
          onSelect: handleServerDeafen,
        },
      ]
    : [];
  const disconnect: StreamMenuEntry = {
    type: "item",
    key: "disconnect",
    label: "Disconnect",
    danger: true,
    onSelect: onClose,
  };

  if (isStreaming && !watchedStreams[userId]) {
    return [
      {
        type: "item",
        key: "watch",
        label: "Watch Stream",
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
        label: "Stop Watching",
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
        label: "Stream Volume",
        value: peerSetting.streamVolume,
        onChange: (val) => setPeerStreamVolume(userId, val),
      },
      alwaysHear,
      divider("audio"),
      {
        type: "item",
        key: "attenuation",
        label: "Stream Attenuation",
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
              label: "Stream Attenuation Strength",
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
        label: "More Options",
        entries: [
          profile,
          message,
          divider("message"),
          {
            type: "submenu",
            key: "streaming-apps",
            label: "Apps",
            entries: [
              {
                type: "item",
                key: "no-apps",
                label: "No Apps",
                disabled: true,
              },
            ],
          },
          divider("apps"),
          ...moderatorItems,
          ...(showDisconnect ? [disconnect] : []),
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
      label: "User Volume",
      value: peerSetting.volume,
      onChange: (val) => setPeerVolume(userId, val),
    },
    divider("volume"),
    mute,
    muteSoundboard,
    divider("mute"),
    {
      type: "submenu",
      key: "apps",
      label: "Apps",
      entries: [
        { type: "item", key: "no-apps", label: "No Apps", disabled: true },
      ],
    },
    ...(isModerator
      ? [
          {
            type: "submenu" as const,
            key: "move-to",
            label: "Move to",
            entries: voiceChannels.map(
              (ch): StreamMenuEntry => ({
                type: "item",
                key: ch.id,
                label: ch.name,
                onSelect: () => handleMove(ch.id),
              }),
            ),
          },
        ]
      : []),
    divider("apps"),
    ...(isModerator ? [...moderatorItems, divider("moderator")] : []),
    ...(showDisconnect ? [disconnect, divider("disconnect")] : []),
    {
      type: "item",
      key: "copy-id",
      label: "Copy User ID",
      onSelect: handleCopyId,
      trailing: ID_BADGE,
    },
  ];
}
