import type { Icon as PhosphorIcon } from "phosphor-react-native";

import { useTheme } from "@/theme";

interface IconProps {
  icon: PhosphorIcon;
  /** Bold when idle, fill when active. */
  active?: boolean;
  size?: number;
  color?: string;
}

/** The only place Phosphor weights are chosen. */
export function Icon({
  icon: Glyph,
  active = false,
  size = 24,
  color,
}: IconProps) {
  const theme = useTheme();
  return (
    <Glyph
      size={size}
      color={color ?? theme.ink1}
      weight={active ? "fill" : "bold"}
    />
  );
}
