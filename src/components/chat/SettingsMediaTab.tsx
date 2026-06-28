import {
  MEDIA_CONTENT_FILTER_OPTIONS,
  type MediaContentFilter,
} from "@/lib/media-content-filter";
import { cn } from "@/lib/utils";
import { apiPatch } from "@/lib/api-client";
import { useMediaSafetySettingsStore } from "@/stores/useMediaSafetySettingsStore";
import { useChatStore } from "@/stores/chat-store";
import { useUser } from "@kova/react";
import { Shield, Sparkles, UserRound } from "lucide-react";
import { useEffect, useState } from "react";

const FILTER_ACCENT_STYLES: Record<
  MediaContentFilter,
  {
    badge: string;
    border: string;
    ring: string;
  }
> = {
  high: {
    badge: "bg-emerald-500/12 text-emerald-300 border-emerald-500/20",
    border: "border-emerald-500/25",
    ring: "ring-emerald-500/25",
  },
  medium: {
    badge: "bg-sky-500/12 text-sky-300 border-sky-500/20",
    border: "border-sky-500/25",
    ring: "ring-sky-500/25",
  },
  low: {
    badge: "bg-amber-500/12 text-amber-300 border-amber-500/20",
    border: "border-amber-500/25",
    ring: "ring-amber-500/25",
  },
  off: {
    badge: "bg-rose-500/12 text-rose-300 border-rose-500/20",
    border: "border-rose-500/25",
    ring: "ring-rose-500/25",
  },
};

export default function SettingsMediaTab() {
  const { user } = useUser();
  const chatUser = useChatStore((state) => state.user);
  const dispatch = useChatStore((state) => state.dispatch);
  const loadCurrentUser = useChatStore((state) => state.actions.loadCurrentUser);
  const settingsUserId = chatUser?.id ?? user?.id ?? null;
  const mediaSafetySettings = useMediaSafetySettingsStore((state) => state.getSettings(settingsUserId));
  const updateMediaSafetySettings = useMediaSafetySettingsStore((state) => state.updateSettings);
  const hydrateMediaSafetySettings = useMediaSafetySettingsStore((state) => state.hydrateSettings);
  const setCurrentUser = useMediaSafetySettingsStore((state) => state.setCurrentUser);
  const [savingFilter, setSavingFilter] = useState<MediaContentFilter | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);

  useEffect(() => {
    setCurrentUser(settingsUserId);
  }, [settingsUserId, setCurrentUser]);

  useEffect(() => {
    if (!chatUser?.id) return;
    if (!chatUser.media_content_filter) return;
    hydrateMediaSafetySettings({ contentFilter: chatUser.media_content_filter }, chatUser.id);
  }, [chatUser?.id, chatUser?.media_content_filter, hydrateMediaSafetySettings]);

  const handleFilterChange = async (nextFilter: MediaContentFilter) => {
    if (!settingsUserId) return;
    if (mediaSafetySettings.contentFilter === nextFilter) return;

    const previousFilter = mediaSafetySettings.contentFilter;
    setSaveError(null);
    setSavingFilter(nextFilter);
    updateMediaSafetySettings({ contentFilter: nextFilter }, settingsUserId);

    if (chatUser?.id) {
      dispatch({
        type: "UPDATE_MEMBER_PROFILE",
        userId: chatUser.id,
        media_content_filter: nextFilter,
      });
    }

    try {
      await apiPatch("/api/update-profile", {
        mediaContentFilter: nextFilter,
      });
    } catch (error) {
      updateMediaSafetySettings({ contentFilter: previousFilter }, settingsUserId);
      await loadCurrentUser();
      setSaveError(error instanceof Error ? error.message : "Unable to save your media filter.");
    } finally {
      setSavingFilter(null);
    }
  };

  return (
    <div className="animate-in fade-in slide-in-from-right-4 duration-300">
      <h1 className="text-2xl font-bold text-rm-text mb-2 hidden md:block">
        Media & Content
      </h1>
      <p className="text-sm text-rm-text-muted mb-6 md:mb-10">
        Control how broad media results can be when browsing trending content or searching for GIFs,
        stickers, clips, and memes.
      </p>

      <div className="space-y-12">
        <section className="space-y-6">
          <div className="flex items-center gap-2">
            <Shield size={16} className="text-emerald-400" />
            <h3 className="text-[11px] font-black uppercase tracking-[0.2em] text-rm-text-muted">
              Content Filtering
            </h3>
          </div>

          <div className="rounded-2xl border border-rm-border bg-rm-bg-surface p-5 shadow-sm">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
              <div className="max-w-[520px]">
                <p className="text-sm font-semibold text-rm-text">
                  Your current media filter is set to {mediaSafetySettings.contentFilter}.
                </p>
                <p className="mt-1 text-sm leading-relaxed text-rm-text-muted">
                  Ralph Meet passes this level through to supported provider requests so your search and
                  trending results stay consistent with your preference.
                </p>
              </div>
              <div
                className={cn(
                  "inline-flex items-center rounded-full border px-3 py-1 text-[11px] font-black uppercase tracking-[0.18em]",
                  FILTER_ACCENT_STYLES[mediaSafetySettings.contentFilter].badge
                )}
              >
                {mediaSafetySettings.contentFilter}
              </div>
            </div>
          </div>

          <div role="radiogroup" aria-label="Media content filter" className="grid gap-3">
            {MEDIA_CONTENT_FILTER_OPTIONS.map((option) => {
              const selected = mediaSafetySettings.contentFilter === option.value;

              return (
                <button
                  key={option.value}
                  type="button"
                  role="radio"
                  aria-checked={selected}
                  onClick={() => {
                    void handleFilterChange(option.value);
                  }}
                  className={cn(
                    "w-full rounded-2xl border bg-rm-bg-surface p-4 text-left transition-all",
                    selected
                      ? cn(
                          "shadow-lg ring-1",
                          FILTER_ACCENT_STYLES[option.value].border,
                          FILTER_ACCENT_STYLES[option.value].ring
                        )
                      : "border-rm-border hover:border-rm-text-muted/20 hover:bg-rm-bg-elevated/40"
                  )}
                >
                  <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                    <div className="min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="text-base font-black text-rm-text">{option.label}</span>
                        <span
                          className={cn(
                            "inline-flex rounded-full border px-2.5 py-1 text-[10px] font-black uppercase tracking-[0.16em]",
                            FILTER_ACCENT_STYLES[option.value].badge
                          )}
                        >
                          {option.badge}
                        </span>
                      </div>
                      <p className="mt-1 text-sm leading-relaxed text-rm-text-muted">
                        {option.description}
                      </p>
                    </div>
                    <div
                      className={cn(
                        "flex h-5 w-5 shrink-0 items-center justify-center rounded-full border transition-colors",
                        selected
                          ? cn("border-transparent text-white", FILTER_ACCENT_STYLES[option.value].badge)
                          : "border-rm-border bg-rm-bg-primary text-transparent"
                      )}
                    >
                      <span className="text-[11px] leading-none">•</span>
                    </div>
                  </div>
                  {savingFilter === option.value ? (
                    <p className="mt-2 text-[11px] font-semibold uppercase tracking-[0.14em] text-rm-text-muted">
                      Saving…
                    </p>
                  ) : null}
                </button>
              );
            })}
          </div>
          {saveError ? (
            <div className="rounded-2xl border border-destructive/25 bg-destructive/10 px-4 py-3 text-sm font-medium text-destructive">
              {saveError}
            </div>
          ) : null}
        </section>

        <section className="space-y-6">
          <div className="flex items-center gap-2">
            <Sparkles size={16} className="text-sky-400" />
            <h3 className="text-[11px] font-black uppercase tracking-[0.2em] text-rm-text-muted">
              How It Applies
            </h3>
          </div>

          <div className="grid gap-3 md:grid-cols-2">
            <div className="rounded-2xl border border-rm-border bg-rm-bg-surface p-4">
              <div className="mb-3 flex h-10 w-10 items-center justify-center rounded-xl border border-sky-500/20 bg-sky-500/10 text-sky-400">
                <Sparkles size={18} />
              </div>
              <h4 className="text-sm font-bold text-rm-text">Search + Trending</h4>
              <p className="mt-1 text-sm leading-relaxed text-rm-text-muted">
                The selected level is forwarded with GIF, sticker, clip, and meme search requests, including the
                new trending surface in the picker.
              </p>
            </div>

            <div className="rounded-2xl border border-rm-border bg-rm-bg-surface p-4">
              <div className="mb-3 flex h-10 w-10 items-center justify-center rounded-xl border border-rm-accent/20 bg-rm-accent/10 text-rm-accent">
                <UserRound size={18} />
              </div>
              <h4 className="text-sm font-bold text-rm-text">Account-aware Requests</h4>
              <p className="mt-1 text-sm leading-relaxed text-rm-text-muted">
                When the provider supports personalization, Ralph Meet sends your current account ID with those
                fetches so media browsing can stay tied to the right user context.
              </p>
            </div>
          </div>
        </section>
      </div>
    </div>
  );
}
