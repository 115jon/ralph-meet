import type { SFUClient } from "@/lib/sfu-client";
import { cn } from "@/lib/utils";
import { type ActivityType, useActivityStore } from "@/stores/useActivityStore";
import { DISABLED, PRESS } from "@/components/ui/interaction";
import { type ReactNode, useMemo } from "react";
import {
  ResponsiveDialog,
  ResponsiveDialogContent,
  ResponsiveDialogDescription,
  ResponsiveDialogHeader,
  ResponsiveDialogTitle,
} from "@/components/ui/responsive-dialog";

interface VoiceAppsModalProps {
  isOpen: boolean;
  /**
   * Which list the caller wants. There is one list now ("Activities"), so
   * this is accepted for the callers that still pass their mode and ignored.
   */
  initialTab?: "menu" | "activities";
  onClose: () => void;
  sfu: SFUClient | null;
  serverId?: string | null;
  channelId?: string | null;
  localUserId?: string | null;
  gridItems: Array<{ userId: string; name: string; isLocal?: boolean }>;
}

/**
 * One activity: the whole cell is the button (ply-2, 1px line, radius 10, an
 * ink overlay on hover, the global focus ring). PRESS draws the overlay, so
 * hover is the tint-1 ink at 6% rather than a colour.
 */
const CARD = cn(
  "flex w-full flex-col items-start gap-3 rounded-lg border border-line bg-ply-2 p-3 text-left text-ink-1 outline-none",
  PRESS,
  DISABLED,
  "[--hover-o:0.06] [--press-o:0.1]",
);

/** The preview well both cards share: ply-1 so the art sits one step down from the card. */
const ART =
  "h-20 w-full overflow-hidden rounded-md border border-line bg-ply-1";

type Tile = "correct" | "present" | "absent";

/** Three guesses of a five-letter board, drawn from the LED tokens. */
const WORDLE_ROWS: Tile[][] = [
  ["absent", "present", "absent", "absent", "absent"],
  ["correct", "correct", "absent", "present", "absent"],
  ["correct", "correct", "correct", "correct", "correct"],
];

const TILE_FILL: Record<Tile, string> = {
  correct: "bg-talk",
  present: "bg-idle",
  absent: "bg-tint-3",
};

function WordleArt() {
  return (
    <div aria-hidden="true" className={cn(ART, "grid place-items-center")}>
      <div className="grid grid-cols-5 gap-0.5">
        {WORDLE_ROWS.flat().map((tile, index) => (
          <div
            key={index}
            className={cn("size-3.5 rounded-xs", TILE_FILL[tile])}
          />
        ))}
      </div>
    </div>
  );
}

/** The tunnel: three rings receding, two speed lines and the ship's bar. */
function WarpRushArt() {
  return (
    <div aria-hidden="true" className={cn(ART, "relative bg-ply-0")}>
      <div className="absolute top-1/2 left-1/2 size-16 -translate-x-1/2 -translate-y-1/2 rounded-full border border-live/25" />
      <div className="absolute top-1/2 left-1/2 size-11 -translate-x-1/2 -translate-y-1/2 rounded-full border border-live/50" />
      <div className="absolute top-1/2 left-1/2 size-6 -translate-x-1/2 -translate-y-1/2 rounded-full border border-live" />
      <div className="absolute top-3 left-5 h-0.5 w-8 -rotate-12 rounded-full bg-live/60" />
      <div className="absolute right-5 bottom-4 h-0.5 w-10 -rotate-12 rounded-full bg-live/40" />
      <div className="absolute bottom-3 left-1/2 h-0.5 w-5 -translate-x-1/2 rounded-full bg-idle" />
    </div>
  );
}

const ACTIVITIES: Array<{
  id: ActivityType;
  title: string;
  description: string;
  art: ReactNode;
}> = [
  {
    id: "wordle",
    title: "Daily Word",
    description:
      "One shared puzzle a day. Everyone in the call sees how the others are doing.",
    art: <WordleArt />,
  },
  {
    id: "warp-rush",
    title: "Warp Rush",
    description:
      "Fly the same tunnel as everyone in the call and see who scores highest.",
    art: <WarpRushArt />,
  },
];

/** The presence record an activity start broadcasts; the clock read lives outside render. */
function createPresence(
  userId: string,
  channelId: string,
  activity: ActivityType,
) {
  return { userId, channelId, activity, startedAt: Date.now() };
}

export function VoiceAppsModal({
  isOpen,
  onClose,
  sfu,
  channelId,
  localUserId,
  gridItems,
}: VoiceAppsModalProps) {
  const setUserActivity = useActivityStore((s) => s.setUserActivity);
  const canStart = !!localUserId && !!channelId;

  const participantCount = useMemo(() => {
    const ids = new Set<string>();
    for (const item of gridItems) if (item.userId) ids.add(item.userId);
    return ids.size;
  }, [gridItems]);

  const startActivity = (activity: ActivityType) => {
    if (!localUserId || !channelId) return;
    const presence = createPresence(localUserId, channelId, activity);
    setUserActivity(presence);
    sfu?.voiceGW.sendAppEvent({ type: "activity.start", ...presence });
    onClose();
  };

  const description = !canStart
    ? "Join a voice channel to start one."
    : participantCount > 1
      ? `Starts for all ${participantCount} people in this call.`
      : "Starts for everyone in this call.";

  return (
    <ResponsiveDialog
      open={isOpen}
      onOpenChange={(nextOpen) => !nextOpen && onClose()}
    >
      <ResponsiveDialogContent dialogClassName="max-h-[min(560px,calc(100dvh-2rem))] overflow-y-auto md:max-w-md">
        <ResponsiveDialogHeader>
          <ResponsiveDialogTitle>Activities</ResponsiveDialogTitle>
          <ResponsiveDialogDescription>
            {description}
          </ResponsiveDialogDescription>
        </ResponsiveDialogHeader>

        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
          {ACTIVITIES.map((activity) => (
            <button
              key={activity.id}
              type="button"
              disabled={!canStart}
              onClick={() => startActivity(activity.id)}
              className={CARD}
            >
              {activity.art}
              <span className="min-w-0">
                <span className="block text-ui-row font-semibold">
                  {activity.title}
                </span>
                <span className="mt-0.5 block text-ui-sm text-pretty text-ink-2">
                  {activity.description}
                </span>
              </span>
            </button>
          ))}
        </div>
      </ResponsiveDialogContent>
    </ResponsiveDialog>
  );
}
