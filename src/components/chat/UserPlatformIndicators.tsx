import { type PresencePlatform, normalizePresencePlatforms } from "@/lib/presence-platform";
import type { User } from "@/lib/types";
import { cn } from "@/lib/utils";
import { useChatStore } from "@/stores/chat-store";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { Globe, Monitor, Smartphone } from "lucide-react";

const PLATFORM_ORDER: PresencePlatform[] = ["desktop", "mobile", "web"];

const PLATFORM_META: Record<
  PresencePlatform,
  { icon: typeof Monitor; label: string }
> = {
  desktop: { icon: Monitor, label: "Desktop" },
  mobile: { icon: Smartphone, label: "Mobile" },
  web: { icon: Globe, label: "Web" },
};

interface UserPlatformIndicatorsProps {
  userId?: string | null;
  platforms?: PresencePlatform[] | null;
  status?: User["status"] | null;
  className?: string;
  iconClassName?: string;
}

export function UserPlatformIndicators({
  userId,
  platforms,
  status,
  className,
  iconClassName,
}: UserPlatformIndicatorsProps) {
  const livePlatforms = useChatStore((state) =>
    userId ? state.presencePlatformsByUserId[userId] : undefined,
  );

  const resolvedPlatforms = normalizePresencePlatforms(
    livePlatforms?.length ? livePlatforms : platforms ?? [],
  ).sort((left, right) => {
    return PLATFORM_ORDER.indexOf(left) - PLATFORM_ORDER.indexOf(right);
  });

  if (resolvedPlatforms.length === 0) return null;

  const isOffline = status === "offline";

  return (
    <div
      className={cn(
        "flex items-center gap-1.5",
        isOffline ? "text-rm-text-muted/75" : "text-primary",
        className,
      )}
      aria-label={`Active on ${resolvedPlatforms
        .map((platform) => PLATFORM_META[platform].label.toLowerCase())
        .join(", ")}`}
    >
      {resolvedPlatforms.map((platform) => {
        const Icon = PLATFORM_META[platform].icon;

        return (
          <Tooltip key={platform}>
            <TooltipTrigger asChild>
              <span className="flex items-center justify-center">
                <Icon className={cn("h-3.5 w-3.5", iconClassName)} aria-hidden="true" />
              </span>
            </TooltipTrigger>
            <TooltipContent
              side="top"
              sideOffset={8}
              className="rounded-lg border-none bg-rm-bg-floating px-3 py-2 text-[12px] font-bold text-rm-text-primary shadow-xl"
            >
              {PLATFORM_META[platform].label}
            </TooltipContent>
          </Tooltip>
        );
      })}
    </div>
  );
}
