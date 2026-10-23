/**
 * Web screen share: pick a quality and audio, then the browser shows its own
 * source picker (getDisplayMedia). Centred dialog on desktop, bottom drawer
 * on phones (13.1); the quality list scrolls, the footer stays put.
 */

import { SettingsSwitch } from "@/components/chat/SettingsSwitch";
import { RadioList } from "@/components/chat/settings/primitives";
import { Button } from "@/components/ui/button";
import {
  ResponsiveDialog,
  ResponsiveDialogContent,
  ResponsiveDialogDescription,
  ResponsiveDialogFooter,
  ResponsiveDialogHeader,
  ResponsiveDialogTitle,
} from "@/components/ui/responsive-dialog";
import { SCREEN_SHARE_QUALITY_PRESETS } from "@/lib/screen-share-support";
import { useVoiceSettingsStore } from "@/stores/useVoiceSettingsStore";
import { useId, useState } from "react";

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
  const qualityLabelId = useId();
  const audioLabelId = useId();
  const audioDescId = useId();

  const qualities = SCREEN_SHARE_QUALITY_PRESETS.filter((q) =>
    availableQualities.includes(q.id),
  ).map((q) => ({
    value: q.id,
    label: `${q.label} · ${q.fps} FPS`,
    desc: q.desc,
  }));

  const start = () => {
    setScreenShareDefaults({ quality: selectedQuality, withAudio });
    onStart({ quality: selectedQuality, withAudio });
  };

  return (
    <ResponsiveDialog open={isOpen} onOpenChange={(open) => !open && onClose()}>
      <ResponsiveDialogContent
        className="md:max-w-lg"
        dialogClassName="flex max-h-[calc(100dvh-32px)] flex-col"
      >
        <ResponsiveDialogHeader>
          <ResponsiveDialogTitle>Share your screen</ResponsiveDialogTitle>
          <ResponsiveDialogDescription>
            Pick a quality, then choose a screen, window or tab. Higher settings
            use more bandwidth.
          </ResponsiveDialogDescription>
        </ResponsiveDialogHeader>

        <div className="@container flex min-h-0 flex-col gap-4 overflow-y-auto overscroll-contain md:-mx-6 md:px-6">
          <section className="flex flex-col gap-2">
            <h3
              id={qualityLabelId}
              className="text-ui-sm font-semibold text-rm-text"
            >
              Quality
            </h3>
            <RadioList
              ids={{ labelId: qualityLabelId }}
              name="screen-share-quality"
              value={selectedQuality}
              options={qualities}
              onChange={setSelectedQuality}
            />
          </section>

          <div className="flex items-center justify-between gap-4 rounded-md border border-rm-border-strong px-3 py-2.5">
            <div className="min-w-0">
              <p
                id={audioLabelId}
                className="text-ui-sm font-medium text-rm-text"
              >
                Share audio
              </p>
              <p
                id={audioDescId}
                className="mt-0.5 text-ui-xs text-rm-text-secondary"
              >
                A whole screen shares system sound. A window or tab shares only
                its own sound, where the browser allows it.
              </p>
            </div>
            <SettingsSwitch
              checked={withAudio}
              onChange={() => setWithAudio((on) => !on)}
              labelledBy={audioLabelId}
              describedBy={audioDescId}
            />
          </div>
        </div>

        <ResponsiveDialogFooter>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={start}>Go live</Button>
        </ResponsiveDialogFooter>
      </ResponsiveDialogContent>
    </ResponsiveDialog>
  );
}
