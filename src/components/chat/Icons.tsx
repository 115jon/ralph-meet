import {
  ChevronDown as ChevronDownIcon,
  Headphones as HeadphonesIcon,
  Mic as MicIcon,
  MicOff as MicOffIcon,
  Settings as SettingsIcon,
  type LucideProps,
} from "lucide-react";
import { memo } from "react";

/**
 * Temporary Lucide shim. The app's icons are `<Icon>` from
 * `@/components/ui/icon` (Phosphor). These five exports remain only for
 * UserPanel.tsx, which is mid-edit elsewhere; migrate it with
 * `node scripts/codemod-lucide-to-icon.mjs --write src/components/chat/UserPanel.tsx`
 * and delete this file.
 */

export const ChevronDown = memo((props: LucideProps) => (
  <ChevronDownIcon {...props} />
));
export const Headphones = memo((props: LucideProps) => (
  <HeadphonesIcon {...props} />
));
export const Mic = memo((props: LucideProps) => <MicIcon {...props} />);
export const MicOff = memo((props: LucideProps) => <MicOffIcon {...props} />);
export const Settings = memo((props: LucideProps) => (
  <SettingsIcon {...props} />
));

ChevronDown.displayName = "MemoChevronDown";
Headphones.displayName = "MemoHeadphones";
Mic.displayName = "MemoMic";
MicOff.displayName = "MemoMicOff";
Settings.displayName = "MemoSettings";
