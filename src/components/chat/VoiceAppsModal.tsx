import type { SFUClient } from "@/lib/sfu-client";
import { cn } from "@/lib/utils";
import { type ActivityType, useActivityStore } from "@/stores/useActivityStore";
import { Icon } from "@/components/ui/icon";
import { useMemo, useState } from "react";
import { DialogPortal, DialogSurface } from "@/components/ui/dialog";
import {
  ResponsiveDialog,
  ResponsiveDialogContent,
  ResponsiveDialogHeader,
  ResponsiveDialogTitle,
} from "@/components/ui/responsive-dialog";
import { useIsMobile } from "@/hooks/useMediaQuery";

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

function WordleLogo() {
  return (
    <div className="grid h-11 w-11 grid-cols-3 gap-[2px] rounded-sm bg-white p-[3px] shadow-sm">
      {Array.from({ length: 9 }).map((_, index) => (
        <div
          key={index}
          className={cn(
            "rounded-[1px] border border-black/80",
            index >= 6
              ? "bg-[#6aaa64]"
              : index === 3 || index === 4
                ? "bg-[#c9b458]"
                : "bg-white",
          )}
        />
      ))}
    </div>
  );
}

function WarpRushLogo() {
  return (
    <div className="relative h-11 w-11 overflow-hidden rounded-xl border border-cyan-300/40 bg-[radial-gradient(circle_at_top,#34d399_0%,#0f172a_45%,#020617_100%)] shadow-[0_0_28px_rgba(56,189,248,0.28)]">
      <div className="absolute inset-x-2 top-2 h-[2px] rotate-[-14deg] bg-cyan-200/90 shadow-[0_0_10px_rgba(34,211,238,0.95)]" />
      <div className="absolute inset-x-3 top-4 h-[2px] rotate-[-14deg] bg-sky-400/80 shadow-[0_0_12px_rgba(56,189,248,0.9)]" />
      <div className="absolute bottom-2 left-1/2 h-5 w-5 -translate-x-1/2 rounded-full border border-cyan-300/50 bg-cyan-400/10" />
      <div className="absolute bottom-3 left-1/2 h-3 w-3 -translate-x-1/2 rounded-full border border-cyan-200/70" />
      <div className="absolute inset-x-4 bottom-2 h-[2px] rounded-full bg-amber-300/80 shadow-[0_0_14px_rgba(251,191,36,0.9)]" />
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
  const isMobile = useIsMobile();
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

  const body = (
    <div className="min-h-0 flex-1 overflow-y-auto">
      {tab === "menu" && (
        <div className="p-4 grid grid-cols-1 sm:grid-cols-2 gap-3">
          <button
            onClick={() => setTab("activities")}
            className="flex flex-col items-start gap-2 rounded-xl border border-rm-border bg-rm-bg-surface p-4 text-left transition-ui pointer-fine:hover:bg-rm-bg-hover pointer-fine:hover:border-primary/50 group"
          >
            <div className="rounded-lg bg-primary/10 p-2 text-primary transition-transform">
              <Icon name="activities" size="xl" />
            </div>
            <div>
              <div className="font-bold text-rm-text">Activities</div>
              <div className="mt-1 text-ui-xs text-rm-text-muted leading-relaxed">
                Play games, watch videos, and hang out with friends in the voice
                channel.
              </div>
            </div>
          </button>
        </div>
      )}

      {tab === "activities" && (
        <div className="p-4">
          <button
            onClick={() => startActivity("wordle")}
            className="flex w-full items-center gap-4 rounded-lg border border-rm-border bg-rm-bg-surface p-4 text-left pointer-fine:hover:bg-rm-bg-hover"
          >
            <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-lg bg-white">
              <WordleLogo />
            </div>
            <div className="min-w-0 flex-1">
              <div className="text-ui-sm font-semibold text-rm-text">
                Daily Wordle
              </div>
              <div className="mt-1 text-ui-xs leading-5 text-rm-text-muted">
                Play the shared daily puzzle in the voice stage with group
                progress and streaks.
              </div>
            </div>
          </button>
          <button
            onClick={() => startActivity("warp-rush")}
            className="mt-3 flex w-full items-center gap-4 rounded-lg border border-cyan-400/20 bg-[linear-gradient(135deg,rgba(14,116,144,0.16),rgba(15,23,42,0.9))] p-4 text-left pointer-fine:hover:border-cyan-300/40 pointer-fine:hover:bg-[linear-gradient(135deg,rgba(8,145,178,0.18),rgba(15,23,42,0.98))]"
          >
            <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-lg bg-slate-950/80">
              <WarpRushLogo />
            </div>
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2 text-ui-sm font-semibold text-rm-text">
                Warp Rush 3D
                <span className="rounded-full border border-cyan-300/40 bg-cyan-400/10 px-2 py-0.5 text-ui-2xs font-semibold uppercase tracking-[0.08em] text-cyan-100">
                  GPU Stress
                </span>
              </div>
              <div className="mt-1 text-ui-xs leading-5 text-rm-text-muted">
                A hardware-acceleration workout with instanced debris, bloom,
                live FPS telemetry, and a shared voice-session leaderboard.
              </div>
            </div>
          </button>
          {participants.length > 1 && (
            <div className="mt-3 text-ui-xs text-rm-text-muted">
              {participants.length} people are in this voice session.
            </div>
          )}
        </div>
      )}
    </div>
  );

  const backButton =
    tab !== "menu" ? (
      <button
        type="button"
        onClick={() => setTab("menu")}
        aria-label="Back to Voice Apps"
        className="-ml-1 rounded-md p-1 text-rm-text-muted transition-colors pointer-fine:hover:bg-rm-bg-hover pointer-fine:hover:text-rm-text max-md:flex max-md:min-h-11 max-md:min-w-11 max-md:items-center max-md:justify-center"
      >
        <Icon name="chevronLeft" size="lg" />
      </button>
    ) : null;
  const title = tab === "menu" ? "Voice Apps" : "Activities";

  return (
    <ResponsiveDialog
      open={isOpen}
      onOpenChange={(nextOpen) => !nextOpen && handleClose()}
    >
      {isMobile ? (
        <ResponsiveDialogContent>
          <ResponsiveDialogHeader className="flex-row items-center gap-1">
            {backButton}
            <ResponsiveDialogTitle>{title}</ResponsiveDialogTitle>
          </ResponsiveDialogHeader>
          {body}
        </ResponsiveDialogContent>
      ) : (
        <DialogPortal>
          <div
            data-state={isOpen ? "open" : "closed"}
            className={cn(
              "fixed inset-0 z-50 flex items-center justify-center bg-black/55 p-4 backdrop-blur-sm duration-200",
              "animate-in fade-in",
            )}
          >
            <DialogSurface
              showCloseButton={false}
              aria-labelledby="voice-apps-title"
              className={cn(
                "flex min-h-0 h-[85dvh] sm:h-[600px] w-full max-w-xl flex-col overflow-hidden rounded-xl border border-rm-border bg-rm-bg-elevated shadow-2xl outline-none duration-200",
                "animate-in zoom-in-95",
              )}
            >
              <div className="flex shrink-0 items-center justify-between border-b border-rm-border px-4 py-3 bg-rm-bg-surface/50 backdrop-blur-md">
                <div className="flex items-center gap-2">
                  {backButton}
                  <h2
                    id="voice-apps-title"
                    className="text-ui-sm font-semibold text-rm-text"
                  >
                    {title}
                  </h2>
                </div>
                <button
                  type="button"
                  onClick={handleClose}
                  aria-label="Close"
                  className="-mr-1.5 rounded-md p-1.5 text-rm-text-muted transition-colors pointer-fine:hover:bg-rm-bg-hover pointer-fine:hover:text-rm-text"
                >
                  <Icon name="close" size="lg" />
                </button>
              </div>

              {body}
            </DialogSurface>
          </div>
        </DialogPortal>
      )}
    </ResponsiveDialog>
  );
}
