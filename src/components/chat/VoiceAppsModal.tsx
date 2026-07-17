import type { SFUClient } from "@/lib/sfu-client";
import { cn } from "@/lib/utils";
import { type ActivityType, useActivityStore } from "@/stores/useActivityStore";
import { ChevronLeft, Gamepad2, X } from "lucide-react";
import { useMemo, useState } from "react";

type Tab = "menu" | "activities";

interface VoiceAppsModalProps {
  isOpen: boolean;
  isClosing?: boolean;
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
  isClosing,
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

  if (!isOpen) return null;

  return (
    <div
      className={cn(
        "fixed inset-0 z-[1000] flex items-center justify-center bg-black/55 p-4 backdrop-blur-sm duration-200",
        isClosing ? "animate-out fade-out" : "animate-in fade-in",
      )}
    >
      <div
        className={cn(
          "flex h-[85vh] sm:h-[600px] w-full max-w-xl flex-col overflow-hidden rounded-xl border border-rm-border bg-rm-bg-elevated shadow-2xl duration-200",
          isClosing
            ? "animate-out fade-out zoom-out-95"
            : "animate-in zoom-in-95",
        )}
      >
        <div className="flex shrink-0 items-center justify-between border-b border-rm-border px-4 py-3 bg-rm-bg-surface/50 backdrop-blur-md">
          <div className="flex items-center gap-2">
            {tab !== "menu" && (
              <button
                onClick={() => setTab("menu")}
                className="rounded-md p-1 -ml-1 text-rm-text-muted hover:bg-rm-bg-hover hover:text-rm-text transition-colors"
              >
                <ChevronLeft size={20} />
              </button>
            )}
            <h2 className="text-sm font-bold text-rm-text">
              {tab === "menu" ? "Voice Apps" : "Activities"}
            </h2>
          </div>
          <button
            onClick={handleClose}
            className="rounded-md p-1.5 -mr-1.5 text-rm-text-muted hover:bg-rm-bg-hover hover:text-rm-text transition-colors"
          >
            <X size={20} />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto">
          {tab === "menu" && (
            <div className="p-4 grid grid-cols-1 sm:grid-cols-2 gap-3">
              <button
                onClick={() => setTab("activities")}
                className="flex flex-col items-start gap-2 rounded-xl border border-rm-border bg-rm-bg-surface p-4 text-left transition-all hover:bg-rm-bg-hover hover:border-primary/50 group"
              >
                <div className="rounded-lg bg-primary/10 p-2 text-primary group-hover:scale-110 transition-transform">
                  <Gamepad2 size={24} />
                </div>
                <div>
                  <div className="font-bold text-rm-text">Activities</div>
                  <div className="mt-1 text-xs text-rm-text-muted leading-relaxed">
                    Play games, watch videos, and hang out with friends in the
                    voice channel.
                  </div>
                </div>
              </button>
            </div>
          )}

          {tab === "activities" && (
            <div className="p-4">
              <button
                onClick={() => startActivity("wordle")}
                className="flex w-full items-center gap-4 rounded-lg border border-rm-border bg-rm-bg-surface p-4 text-left hover:bg-rm-bg-hover"
              >
                <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-lg bg-white">
                  <WordleLogo />
                </div>
                <div className="min-w-0 flex-1">
                  <div className="text-sm font-black text-rm-text">
                    Daily Wordle
                  </div>
                  <div className="mt-1 text-xs leading-5 text-rm-text-muted">
                    Play the shared daily puzzle in the voice stage with group
                    progress and streaks.
                  </div>
                </div>
              </button>
              <button
                onClick={() => startActivity("warp-rush")}
                className="mt-3 flex w-full items-center gap-4 rounded-lg border border-cyan-400/20 bg-[linear-gradient(135deg,rgba(14,116,144,0.16),rgba(15,23,42,0.9))] p-4 text-left hover:border-cyan-300/40 hover:bg-[linear-gradient(135deg,rgba(8,145,178,0.18),rgba(15,23,42,0.98))]"
              >
                <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-lg bg-slate-950/80">
                  <WarpRushLogo />
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2 text-sm font-black text-rm-text">
                    Warp Rush 3D
                    <span className="rounded-full border border-cyan-300/40 bg-cyan-400/10 px-2 py-0.5 text-[10px] font-bold uppercase tracking-[0.18em] text-cyan-100">
                      GPU Stress
                    </span>
                  </div>
                  <div className="mt-1 text-xs leading-5 text-rm-text-muted">
                    A hardware-acceleration workout with instanced debris,
                    bloom, live FPS telemetry, and a shared voice-session
                    leaderboard.
                  </div>
                </div>
              </button>
              {participants.length > 1 && (
                <div className="mt-3 text-xs text-rm-text-muted">
                  {participants.length} people are in this voice session.
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
