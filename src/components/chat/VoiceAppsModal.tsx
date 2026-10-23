import type { SFUClient } from "@/lib/sfu-client";
import { cn } from "@/lib/utils";
import { type ActivityType, useActivityStore } from "@/stores/useActivityStore";
import { Icon } from "@/components/ui/icon";
import { IconButton } from "@/components/ui/IconButton";
import { PRESS } from "@/components/ui/interaction";
import { useMemo, useState } from "react";
import {
  ResponsiveDialog,
  ResponsiveDialogContent,
  ResponsiveDialogHeader,
  ResponsiveDialogTitle,
} from "@/components/ui/responsive-dialog";

type Tab = "menu" | "activities";

interface VoiceAppsModalProps {
  isOpen: boolean;
  initialTab: Tab;
  onClose: () => void;
  sfu: SFUClient | null;
  serverId?: string | null;
  channelId?: string | null;
  localUserId?: string | null;
  gridItems: Array<{ userId: string; name: string; isLocal?: boolean }>;
}

/** A card row: the whole card is the button. */
const CARD = cn(
  "flex w-full items-center gap-4 rounded-lg border border-rm-border bg-rm-bg-surface p-4 text-left outline-none",
  PRESS,
  "[--hover-o:0.04] [--press-o:0.08]",
);

/** Illustration: a 3x3 Wordle board on the activity's own palette. */
function WordleLogo() {
  return (
    <div
      aria-hidden="true"
      className="grid size-11 grid-cols-3 gap-0.5 rounded-sm bg-rm-activity-wordle-ink p-0.5"
    >
      {Array.from({ length: 9 }).map((_, index) => (
        <div
          key={index}
          className={cn(
            index >= 6
              ? "bg-rm-activity-wordle-correct"
              : index === 3 || index === 4
                ? "bg-rm-activity-wordle-present"
                : "border border-rm-activity-wordle-tile",
          )}
        />
      ))}
    </div>
  );
}

/** Illustration: the tunnel, two speed lines and a ring, on the stage colour. */
function WarpRushLogo() {
  return (
    <div
      aria-hidden="true"
      className="relative size-11 overflow-hidden rounded-md bg-rm-activity-warp-bg"
    >
      <div className="absolute inset-x-2 top-2 h-0.5 -rotate-12 bg-rm-activity-warp-cyan" />
      <div className="absolute inset-x-3 top-4 h-0.5 -rotate-12 bg-rm-activity-warp-cyan/60" />
      <div className="absolute bottom-2 left-1/2 size-5 -translate-x-1/2 rounded-full border border-rm-activity-warp-cyan/60" />
      <div className="absolute bottom-3 left-1/2 size-3 -translate-x-1/2 rounded-full border border-rm-activity-warp-cyan" />
      <div className="absolute inset-x-4 bottom-2 h-0.5 rounded-full bg-rm-activity-warp-amber" />
    </div>
  );
}

export function VoiceAppsModal({
  isOpen,
  initialTab,
  onClose,
  sfu,
  channelId,
  localUserId,
  gridItems,
}: VoiceAppsModalProps) {
  const [tab, setTab] = useState<Tab>(initialTab);
  const setUserActivity = useActivityStore((s) => s.setUserActivity);

  const participants = useMemo(() => {
    const byId = new Map<string, { userId: string; name: string }>();
    for (const item of gridItems) {
      if (item.userId)
        byId.set(item.userId, { userId: item.userId, name: item.name });
    }
    return [...byId.values()];
  }, [gridItems]);

  const handleClose = () => {
    setTab(initialTab);
    onClose();
  };

  const startActivity = (activity: ActivityType) => {
    if (!localUserId || !channelId) return;
    const presence = {
      userId: localUserId,
      channelId,
      activity,
      startedAt: Date.now(),
    };
    setUserActivity(presence);
    sfu?.voiceGW.sendAppEvent({ type: "activity.start", ...presence });
    handleClose();
  };

  const title = tab === "menu" ? "Voice Apps" : "Activities";

  return (
    <ResponsiveDialog
      open={isOpen}
      onOpenChange={(nextOpen) => !nextOpen && handleClose()}
    >
      <ResponsiveDialogContent
        className="gap-0"
        dialogClassName="flex h-[600px] max-h-[calc(100dvh-2rem)] flex-col overflow-hidden p-0 md:max-w-xl"
      >
        <ResponsiveDialogHeader className="flex-row items-center gap-1 md:border-b md:border-rm-border md:px-4 md:py-3">
          {tab !== "menu" ? (
            <IconButton
              icon="chevronLeft"
              variant="muted"
              aria-label="Back to Voice Apps"
              onClick={() => setTab("menu")}
              className="-ml-1"
            />
          ) : null}
          <ResponsiveDialogTitle className="text-ui-lg font-semibold">
            {title}
          </ResponsiveDialogTitle>
        </ResponsiveDialogHeader>

        <div className="min-h-0 flex-1 overflow-y-auto py-4 md:p-4">
          {tab === "menu" && (
            <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
              <button
                type="button"
                onClick={() => setTab("activities")}
                className={cn(CARD, "flex-col items-start gap-2")}
              >
                <span className="rounded-md bg-rm-accent-tint p-2 text-rm-accent-ink">
                  <Icon name="activities" size="xl" />
                </span>
                <span>
                  <span className="block text-ui-md font-semibold text-rm-text">
                    Activities
                  </span>
                  <span className="mt-1 block text-pretty text-ui-sm text-rm-text-secondary">
                    Play games, watch videos, and hang out with friends in the
                    voice channel.
                  </span>
                </span>
              </button>
            </div>
          )}

          {tab === "activities" && (
            <div className="flex flex-col gap-3">
              <button
                type="button"
                onClick={() => startActivity("wordle")}
                className={CARD}
              >
                <WordleLogo />
                <span className="min-w-0 flex-1">
                  <span className="block text-ui-base font-semibold text-rm-text">
                    Daily Wordle
                  </span>
                  <span className="mt-1 block text-pretty text-ui-sm text-rm-text-secondary">
                    Play the shared daily puzzle in the voice stage with group
                    progress and streaks.
                  </span>
                </span>
              </button>
              <button
                type="button"
                onClick={() => startActivity("warp-rush")}
                className={CARD}
              >
                <WarpRushLogo />
                <span className="min-w-0 flex-1">
                  <span className="flex flex-wrap items-center gap-2 text-ui-base font-semibold text-rm-text">
                    Warp Rush 3D
                    <span className="rounded-full bg-rm-tint-2 px-2 py-0.5 text-ui-2xs font-semibold text-rm-text-secondary">
                      GPU stress
                    </span>
                  </span>
                  <span className="mt-1 block text-pretty text-ui-sm text-rm-text-secondary">
                    A hardware-acceleration workout with instanced debris,
                    bloom, live FPS telemetry, and a shared voice-session
                    leaderboard.
                  </span>
                </span>
              </button>
              {participants.length > 1 && (
                <p className="text-ui-xs text-rm-text-muted">
                  {participants.length} people are in this voice session.
                </p>
              )}
            </div>
          )}
        </div>
      </ResponsiveDialogContent>
    </ResponsiveDialog>
  );
}
