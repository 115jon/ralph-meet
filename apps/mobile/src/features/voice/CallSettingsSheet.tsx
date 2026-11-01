import {
  SignIn,
  SlidersHorizontal,
  WaveformSlash,
  X,
} from "phosphor-react-native";

import {
  setCallPreference,
  useCallPreferences,
} from "@/features/preferences/call-preferences";
import {
  setMuteAllSoundboards,
  useSoundboardStore,
} from "@/features/soundboard/playback";
import { IconButton, Sheet, SheetRow } from "@/ui";

import { SheetSeam, SheetTitle, SheetToggleRow } from "./CallSheetRows";

interface CallSettingsSheetProps {
  visible: boolean;
  onClose: () => void;
  /** Settings › Calls, for the rest. */
  onVoiceSettings: () => void;
}

/**
 * The call header's overflow: join and leave tones (the same setting as
 * Settings › Calls) and muting every soundboard for this call only.
 */
export function CallSettingsSheet({
  visible,
  onClose,
  onVoiceSettings,
}: CallSettingsSheetProps) {
  const tones = useCallPreferences((s) => s.joinLeaveTones);
  const muteAll = useSoundboardStore((s) => s.muteAll);
  return (
    <Sheet visible={visible} onClose={onClose} label="Call settings">
      <SheetTitle
        title="Call settings"
        trailing={<IconButton icon={X} label="Close" onPress={onClose} />}
      />
      <SheetToggleRow
        icon={SignIn}
        label="Join and leave tones"
        description="A short tone when someone joins or leaves"
        value={tones}
        onValueChange={(value) => setCallPreference("joinLeaveTones", value)}
      />
      <SheetToggleRow
        icon={WaveformSlash}
        label="Mute all soundboards"
        description="In this call only"
        value={muteAll}
        onValueChange={setMuteAllSoundboards}
      />
      <SheetSeam />
      <SheetRow
        icon={SlidersHorizontal}
        label="Voice settings"
        onPress={() => {
          onClose();
          onVoiceSettings();
        }}
      />
    </Sheet>
  );
}
