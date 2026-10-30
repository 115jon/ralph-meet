/**
 * Web screen share: pick a quality and audio, then the browser shows its own
 * source picker (getDisplayMedia). The same shell as the desktop app's
 * picker (ScreenSharePickerShell): the source area is one "Choose what to
 * share" row that hands off to the browser. Centred dialog on desktop, bottom
 * drawer on phones (13.1).
 */

import {
  ScreenSharePickerFooter,
  ScreenSharePickerShell,
} from "@/components/ScreenSharePickerShell";
import { Icon } from "@/components/ui/icon";
import { useVoiceSettingsStore } from "@/stores/useVoiceSettingsStore";
import { useState } from "react";

interface ScreenShareModalProps {
  isOpen: boolean;
  onClose: () => void;
  onStart: (options: { quality: string; withAudio: boolean }) => void;
  availableQualities: string[];
}

export function ScreenShareModal({
  isOpen,
  onClose,
  onStart,
  availableQualities,
}: ScreenShareModalProps) {
  const settings = useVoiceSettingsStore((s) => s.getSettings());
  const setScreenShareDefaults = useVoiceSettingsStore(
    (s) => s.setScreenShareDefaults,
  );
  const initialQuality = availableQualities.includes(
    settings.screenShareQuality,
  )
    ? settings.screenShareQuality
    : (availableQualities[0] ?? "720p30");
  const [selectedQuality, setSelectedQuality] = useState(initialQuality);
  const [withAudio, setWithAudio] = useState(settings.screenShareWithAudio);

  const start = () => {
    setScreenShareDefaults({ quality: selectedQuality, withAudio });
    onStart({ quality: selectedQuality, withAudio });
  };

  return (
    <ScreenSharePickerShell
      open={isOpen}
      onClose={onClose}
      size="compact"
      description="Pick a quality, then choose what to share. Higher settings use more bandwidth."
      footer={
        <ScreenSharePickerFooter
          quality={selectedQuality}
          onQualityChange={setSelectedQuality}
          availableQualities={availableQualities}
          withAudio={withAudio}
          onWithAudioChange={setWithAudio}
          audioDescription="A whole screen shares system sound. A window or tab shares only its own sound, where the browser allows it."
          onClose={onClose}
          onStart={start}
        />
      }
    >
      <div className="flex items-center gap-3 rounded-lg border border-line bg-ply-2 p-3">
        <span className="flex size-10 shrink-0 items-center justify-center rounded-md bg-tint-2 text-ink-2">
          <Icon name="screenShare" size="lg" />
        </span>
        <div className="min-w-0">
          <p className="text-ui-row font-semibold text-ink-1">
            Choose what to share
          </p>
          <p className="text-ui-sm text-pretty text-ink-2">
            After you press Go live, your browser asks which screen, window or
            tab to share.
          </p>
        </div>
      </div>
    </ScreenSharePickerShell>
  );
}
