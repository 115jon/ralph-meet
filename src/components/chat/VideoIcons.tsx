import { Icon } from "@/components/ui/icon";

/**
 * Glyphs for the video player controls, all through the one `Icon` adapter
 * (Phosphor: Fill for the transport glyphs, Bold for the rest). Sized by the
 * caller's class where one is passed (MemberList), else 20px.
 */

type GlyphProps = { className?: string };

export const PlayIcon = ({ className }: GlyphProps) => (
  <Icon name="play" state="active" size="lg" className={className} />
);
export const PlayAgainIcon = ({ className }: GlyphProps) => (
  <Icon name="reset" size="lg" className={className} />
);
export const PauseIcon = ({ className }: GlyphProps) => (
  <Icon name="pause" state="active" size="lg" className={className} />
);
export const BigPlayIcon = () => <PlayIcon />;
export const VolumeHighIcon = ({ className }: GlyphProps) => (
  <Icon name="speakerHigh" size="lg" className={className} />
);
export const VolumeLowIcon = ({ className }: GlyphProps) => (
  <Icon name="speakerLow" size="lg" className={className} />
);
export const VolumeMuteIcon = ({ className }: GlyphProps) => (
  <Icon name="speakerOff" size="lg" className={className} />
);
export const ExpandIcon = ({ className }: GlyphProps) => (
  <Icon name="maximize" size="lg" className={className} />
);
export const DownloadIcon = ({ className }: GlyphProps) => (
  <Icon name="download" size="lg" className={className} />
);
