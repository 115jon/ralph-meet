import { getDisplayName } from "@/lib/display-name";
import type { DisplayNameStyle } from "@/lib/profile-customization";
import type { CSSProperties } from "react";
import { ProfileDisplayName } from "./ProfileDisplayName";

type UserDisplayNameUser = {
  display_name?: string | null;
  username?: string | null;
  name?: string | null;
  display_name_style?: DisplayNameStyle | string | null;
};

interface UserDisplayNameProps {
  user?: UserDisplayNameUser | null;
  fallback?: string;
  text?: string;
  displayNameStyle?: DisplayNameStyle | string | null;
  className?: string;
  style?: CSSProperties;
}

export function UserDisplayName({
  user,
  fallback,
  text,
  displayNameStyle,
  className,
  style,
}: UserDisplayNameProps) {
  const resolvedText = text ?? getDisplayName(user, fallback ?? "Unknown");
  const resolvedStyle = displayNameStyle ?? user?.display_name_style ?? null;

  return (
    <ProfileDisplayName
      text={resolvedText}
      displayNameStyle={resolvedStyle}
      className={className}
      style={style}
    />
  );
}
