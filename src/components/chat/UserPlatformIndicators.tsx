import {
  type PresencePlatform,
  normalizePresencePlatforms,
} from "@/lib/presence-platform";
import type { User } from "@/lib/types";
import { cn } from "@/lib/utils";
import { useChatStore } from "@/stores/chat-store";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { Icon, type IconName, type IconSize } from "@/components/ui/icon";
import type { CSSProperties } from "react";

const PLATFORM_ORDER: PresencePlatform[] = ["desktop", "mobile", "web"];

const PLATFORM_META: Record<
  PresencePlatform,
  { icon: IconName; label: string }
> = {
  desktop: { icon: "monitor", label: "Desktop" },
  mobile: { icon: "mobile", label: "Mobile" },
  web: { icon: "globe", label: "Web" },
};

interface UserPlatformIndicatorsProps {
  userId?: string | null;
  platforms?: PresencePlatform[] | null;
  status?: User["status"] | null;
  className?: string;
  iconClassName?: string;
  iconSize?: IconSize;
  variant?: "default" | "nameplate";
  color?: string | null;
  offlineColor?: string | null;
  style?: CSSProperties;
}

export function UserPlatformIndicators({
  userId,
  platforms,
  status,
  className,
  iconClassName,
  iconSize = "sm",
  variant: _variant = "default",
  color,
  offlineColor,
  style,
}: UserPlatformIndicatorsProps) {
  const livePlatforms = useChatStore((state) =>
    userId ? state.presencePlatformsByUserId[userId] : undefined,
  );

  const resolvedPlatforms = normalizePresencePlatforms(
    livePlatforms?.length ? livePlatforms : (platforms ?? []),
  ).sort((left, right) => {
    return PLATFORM_ORDER.indexOf(left) - PLATFORM_ORDER.indexOf(right);
  });

  if (resolvedPlatforms.length === 0) return null;

  const isOffline = status === "offline";
  const hasExplicitColor = Boolean(color || offlineColor);
  const toneClassName = hasExplicitColor
    ? undefined
    : isOffline
      ? "text-rm-text-muted/75"
      : "text-primary";
  const resolvedColor = isOffline ? (offlineColor ?? color) : color;

  return (
    <div
      className={cn("flex items-center gap-1.5", toneClassName, className)}
      style={{
        ...(resolvedColor ? { color: resolvedColor } : {}),
        ...style,
      }}
      aria-label={`Active on ${resolvedPlatforms
        .map((platform) => PLATFORM_META[platform].label.toLowerCase())
        .join(", ")}`}
    >
      {resolvedPlatforms.map((platform) => {
        return (
          <Tooltip key={platform}>
            <TooltipTrigger asChild>
              <span className="flex items-center justify-center">
                <Icon
                  name={PLATFORM_META[platform].icon}
                  size={iconSize}
                  className={iconClassName}
                />
              </span>
            </TooltipTrigger>
            <TooltipContent side="top" sideOffset={8}>
              {PLATFORM_META[platform].label}
            </TooltipContent>
          </Tooltip>
        );
      })}
    </div>
  );
}
