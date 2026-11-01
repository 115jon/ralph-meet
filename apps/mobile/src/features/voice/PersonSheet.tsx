import {
  CameraRotate,
  ChatCircle,
  Headphones,
  Microphone,
  MicrophoneSlash,
  SpeakerSlash,
  SpeakerX,
  UserCircle,
  VideoCamera,
  VideoCameraSlash,
  WaveformSlash,
} from "phosphor-react-native";
import { type ReactNode, useRef } from "react";
import { View } from "react-native";

import { openProfile } from "@/features/profile/store";
import { stopSoundsOf } from "@/features/soundboard/playback";
import { mediaUrl } from "@/lib/api";
import { selectionHaptic } from "@/lib/haptics";
import { Avatar, Fader, IconButton, Sheet, SheetRow, Text } from "@/ui";

import { flipCamera, toggleCamera, toggleDeafen, toggleMute } from "./actions";
import { SheetSeam, SheetToggleRow } from "./CallSheetRows";
import {
  PEER_VOLUME,
  type PeerSettings,
  setPeerSetting,
  usePeerSettings,
} from "./peer-settings";
import {
  type CallParticipant,
  useCallSummary,
  useIsSelf,
  useParticipant,
} from "./store";

const formatPercent = (value: number) => `${value}%`;

interface PersonSheetProps {
  /** The long-pressed tile's participant, or null when closed. */
  participantId: string | null;
  onClose: () => void;
  /** Message: the DM opens and the call minimises. */
  onMessage: (userId: string) => void;
}

/**
 * A tile's long-press. Someone else: how you hear them (volume 0–200% with a
 * tick at 100, their share's volume while they share, mute for you, mute
 * their soundboard), their profile and Message, as the web's RemoteMenu.
 * Your own: your microphone and camera.
 */
export function PersonSheet({
  participantId,
  onClose,
  onMessage,
}: PersonSheetProps) {
  const participant = useParticipant(participantId ?? "");
  const self = useIsSelf(participantId ?? "");
  const open = participantId !== null && participant !== null;
  return (
    <Sheet
      visible={open}
      onClose={onClose}
      label={participant ? participant.name : "Person"}
    >
      {participant ? (
        self ? (
          <SelfOptions participant={participant} onClose={onClose} />
        ) : (
          <PeerOptions
            participant={participant}
            onClose={onClose}
            onMessage={onMessage}
          />
        )
      ) : null}
    </Sheet>
  );
}

function SheetHeader({
  participant,
  trailing,
}: {
  participant: CallParticipant;
  trailing?: ReactNode;
}) {
  return (
    <View
      style={{
        flexDirection: "row",
        alignItems: "center",
        gap: 12,
        paddingLeft: 16,
        paddingRight: 8,
        paddingBottom: 8,
      }}
    >
      <Avatar
        name={participant.name}
        size={40}
        uri={mediaUrl(participant.avatarUrl)}
      />
      <View style={{ flex: 1, minWidth: 0 }}>
        <Text
          variant="title"
          numberOfLines={1}
          accessibilityRole="header"
          style={{ fontSize: 20, lineHeight: 26 }}
        >
          {participant.name}
        </Text>
        {participant.username ? (
          <Text variant="row" tone="ink3" numberOfLines={1}>
            @{participant.username}
          </Text>
        ) : null}
      </View>
      {trailing}
    </View>
  );
}

/** A labelled 0–200% fader with a light tick of haptics at 100. */
function VolumeFader({
  label,
  userId,
  field,
  settings,
}: {
  label: string;
  userId: string;
  field: "volume" | "streamVolume";
  settings: PeerSettings;
}) {
  const lastRef = useRef(settings[field]);
  const onChange = (value: number) => {
    const last = lastRef.current;
    const crossed =
      (last < PEER_VOLUME.default && value >= PEER_VOLUME.default) ||
      (last > PEER_VOLUME.default && value <= PEER_VOLUME.default);
    if (crossed) selectionHaptic();
    lastRef.current = value;
    setPeerSetting(userId, field, value);
  };
  return (
    <View style={{ paddingHorizontal: 16, paddingTop: 4 }}>
      <Text variant="silk" tone="ink3">
        {label}
      </Text>
      <Fader
        value={settings[field]}
        min={PEER_VOLUME.min}
        max={PEER_VOLUME.max}
        ticks={[PEER_VOLUME.default]}
        onChange={onChange}
        onCommit={(value) => {
          lastRef.current = value;
          setPeerSetting(userId, field, value);
        }}
        format={formatPercent}
        accessibilityLabel={label}
      />
    </View>
  );
}

function PeerOptions({
  participant,
  onClose,
  onMessage,
}: {
  participant: CallParticipant;
  onClose: () => void;
  onMessage: (userId: string) => void;
}) {
  const userId = participant.userId;
  const settings = usePeerSettings(userId);
  if (!userId) {
    return (
      <>
        <SheetHeader participant={participant} />
        <Text
          variant="row"
          tone="ink3"
          style={{ paddingHorizontal: 16, paddingBottom: 8 }}
        >
          This person&apos;s settings can&apos;t be saved.
        </Text>
      </>
    );
  }
  return (
    <>
      <SheetHeader
        participant={participant}
        trailing={
          <IconButton
            icon={UserCircle}
            label={`${participant.name}'s profile`}
            onPress={() => {
              onClose();
              openProfile(userId);
            }}
          />
        }
      />
      <VolumeFader
        label="User volume"
        userId={userId}
        field="volume"
        settings={settings}
      />
      {participant.sharing ? (
        <VolumeFader
          label="Stream volume"
          userId={userId}
          field="streamVolume"
          settings={settings}
        />
      ) : null}
      <SheetSeam />
      <SheetToggleRow
        icon={SpeakerX}
        label="Mute for me"
        description="Only you stop hearing them"
        value={settings.muted}
        onValueChange={(value) => setPeerSetting(userId, "muted", value)}
      />
      <SheetToggleRow
        icon={WaveformSlash}
        label="Mute their soundboard"
        value={settings.soundboardMuted}
        onValueChange={(value) => {
          setPeerSetting(userId, "soundboardMuted", value);
          if (value) stopSoundsOf(userId);
        }}
      />
      <SheetSeam />
      <SheetRow
        icon={ChatCircle}
        label="Message"
        onPress={() => {
          onClose();
          onMessage(userId);
        }}
      />
    </>
  );
}

function SelfOptions({
  participant,
  onClose,
}: {
  participant: CallParticipant;
  onClose: () => void;
}) {
  const call = useCallSummary();
  if (!call) return null;
  const act = (run: () => void) => () => {
    onClose();
    run();
  };
  return (
    <>
      <SheetHeader participant={participant} />
      <SheetRow
        icon={call.muted ? Microphone : MicrophoneSlash}
        label={call.muted ? "Unmute your microphone" : "Mute your microphone"}
        onPress={act(toggleMute)}
      />
      <SheetRow
        icon={call.deafened ? Headphones : SpeakerSlash}
        label={call.deafened ? "Undeafen" : "Deafen"}
        onPress={act(toggleDeafen)}
      />
      <SheetRow
        icon={call.camera ? VideoCameraSlash : VideoCamera}
        label={call.camera ? "Turn off your camera" : "Turn on your camera"}
        onPress={act(() => void toggleCamera())}
      />
      {call.camera ? (
        <SheetRow
          icon={CameraRotate}
          label="Switch camera"
          onPress={act(flipCamera)}
        />
      ) : null}
    </>
  );
}
