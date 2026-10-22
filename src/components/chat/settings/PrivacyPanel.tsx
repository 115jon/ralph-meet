import InlineEmojiText from "@/components/chat/InlineEmojiText";
import { Button } from "@/components/ui/button";
import { Icon } from "@/components/ui/icon";
import { apiDelete, apiGet, apiPatch } from "@/lib/api-client";
import {
  MEDIA_CONTENT_FILTER_OPTIONS,
  type MediaContentFilter,
} from "@/lib/media-content-filter";
import { cn } from "@/lib/utils";
import { useChatStore } from "@/stores/chat-store";
import { useMediaSafetySettingsStore } from "@/stores/useMediaSafetySettingsStore";
import { useUser } from "@kova/react";
import { useCallback, useEffect, useState } from "react";
import {
  ConfirmStrip,
  RadioList,
  RowError,
  SettingsCard,
  SettingsRow,
  useConfirm,
} from "./primitives";

/* ------------------------------------------------------------------ */
/* Media filter                                                         */
/* ------------------------------------------------------------------ */

function MediaFilterRow() {
  const { user } = useUser();
  const chatUser = useChatStore((state) => state.user);
  const dispatch = useChatStore((state) => state.dispatch);
  const loadCurrentUser = useChatStore(
    (state) => state.actions.loadCurrentUser,
  );
  const settingsUserId = chatUser?.id ?? user?.id ?? null;
  const mediaSafetySettings = useMediaSafetySettingsStore((state) =>
    state.getSettings(settingsUserId),
  );
  const updateMediaSafetySettings = useMediaSafetySettingsStore(
    (state) => state.updateSettings,
  );
  const hydrateMediaSafetySettings = useMediaSafetySettingsStore(
    (state) => state.hydrateSettings,
  );
  const setCurrentUser = useMediaSafetySettingsStore(
    (state) => state.setCurrentUser,
  );
  const [savingFilter, setSavingFilter] = useState<MediaContentFilter | null>(
    null,
  );
  const [saveError, setSaveError] = useState<string | null>(null);

  useEffect(() => {
    setCurrentUser(settingsUserId);
  }, [settingsUserId, setCurrentUser]);

  useEffect(() => {
    if (!chatUser?.id) return;
    if (!chatUser.media_content_filter) return;
    hydrateMediaSafetySettings(
      { contentFilter: chatUser.media_content_filter },
      chatUser.id,
    );
  }, [
    chatUser?.id,
    chatUser?.media_content_filter,
    hydrateMediaSafetySettings,
  ]);

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
      updateMediaSafetySettings(
        { contentFilter: previousFilter },
        settingsUserId,
      );
      await loadCurrentUser();
      setSaveError(
        error instanceof Error
          ? error.message
          : "Couldn't save your media filter. Try again.",
      );
    } finally {
      setSavingFilter(null);
    }
  };

  return (
    <SettingsRow
      id="media-filter"
      layout="block"
      footer={saveError ? <RowError>{saveError}</RowError> : null}
    >
      {(ids) => (
        <RadioList
          ids={ids}
          name="media-content-filter"
          value={mediaSafetySettings.contentFilter}
          options={MEDIA_CONTENT_FILTER_OPTIONS.map((option) => ({
            value: option.value,
            label: option.label,
            badge: option.badge,
            desc: option.description,
          }))}
          busyValue={savingFilter}
          onChange={(value) => void handleFilterChange(value)}
        />
      )}
    </SettingsRow>
  );
}

/* ------------------------------------------------------------------ */
/* Shared messages                                                      */
/* ------------------------------------------------------------------ */

interface ShareListItem {
  id: string;
  token: string;
  content: string;
  author: {
    username: string;
    display_name: string | null;
  };
  created_at: string;
  expires_at: string | null;
  revoked_at: string | null;
  status: "active" | "revoked" | "deleted" | "expired";
  view_count: number;
}

const dateFormat = new Intl.DateTimeFormat(undefined, {
  month: "short",
  day: "numeric",
  year: "numeric",
});

function formatDate(value: string | null): string {
  if (!value) return "Never";
  return dateFormat.format(new Date(value));
}

function effectiveStatus(share: ShareListItem): ShareListItem["status"] {
  if (share.status !== "active") return share.status;
  if (share.revoked_at) return "revoked";
  if (share.expires_at && new Date(share.expires_at).getTime() <= Date.now())
    return "expired";
  return "active";
}

const STATUS_LABEL: Record<ShareListItem["status"], string> = {
  active: "Live",
  revoked: "Revoked",
  deleted: "Deleted",
  expired: "Expired",
};

const viewsFormat = new Intl.PluralRules(undefined);
function formatViews(count: number) {
  return viewsFormat.select(count) === "one"
    ? `${count} view`
    : `${count} views`;
}

function ShareItem({
  share,
  onRevoke,
}: {
  share: ShareListItem;
  onRevoke: (id: string) => Promise<void>;
}) {
  const {
    armed: confirmArmed,
    arm: armConfirm,
    cancel: cancelConfirm,
    done: finishConfirm,
    triggerRef: confirmTriggerRef,
  } = useConfirm();
  const [revoking, setRevoking] = useState(false);
  const [copied, setCopied] = useState(false);
  const [revokeError, setRevokeError] = useState<string | null>(null);
  const url = `${window.location.origin}/share/${share.token}`;
  const status = effectiveStatus(share);
  const active = status === "active";

  const copy = async () => {
    await navigator.clipboard.writeText(url);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1800);
  };

  return (
    <li className="py-3 first:pt-0 last:pb-0">
      <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-2">
        <div className="min-w-0 flex-1">
          <p className="text-ui-sm font-medium text-rm-text">
            <InlineEmojiText
              text={share.author.display_name ?? share.author.username}
            />
          </p>
          <p className="mt-0.5 line-clamp-2 text-ui-sm text-rm-text-secondary">
            <InlineEmojiText text={share.content || "(Attachment only)"} />
          </p>
          <p className="mt-1 flex flex-wrap gap-x-3 gap-y-0.5 text-ui-xs text-rm-text-secondary">
            <span
              className={cn(
                "font-medium",
                active ? "text-rm-success-ink" : "text-rm-text-secondary",
              )}
            >
              {STATUS_LABEL[status]}
            </span>
            <span>Shared {formatDate(share.created_at)}</span>
            <span>Expires {formatDate(share.expires_at)}</span>
            <span>{formatViews(share.view_count)}</span>
          </p>
        </div>
        {active && !confirmArmed ? (
          <div className="flex shrink-0 gap-1.5">
            <Button
              type="button"
              variant="secondary"
              size="sm"
              onClick={() => void copy()}
            >
              <Icon name={copied ? "check" : "copy"} size="sm" />
              {copied ? "Copied" : "Copy link"}
            </Button>
            <Button asChild variant="secondary" size="sm">
              <a href={url} target="_blank" rel="noreferrer">
                <Icon name="externalLink" size="sm" />
                Open
              </a>
            </Button>
            <Button
              ref={confirmTriggerRef}
              type="button"
              variant="destructive"
              size="sm"
              onClick={armConfirm}
            >
              Revoke
            </Button>
          </div>
        ) : null}
      </div>
      {confirmArmed ? (
        <ConfirmStrip
          consequence="Anyone with this link will see that it's gone. You can't undo this."
          confirmLabel="Revoke link"
          busy={revoking}
          onCancel={cancelConfirm}
          onConfirm={() => {
            setRevoking(true);
            setRevokeError(null);
            void onRevoke(share.id)
              .catch(() =>
                setRevokeError("Couldn't revoke this link. Try again."),
              )
              .finally(() => {
                setRevoking(false);
                finishConfirm();
              });
          }}
        />
      ) : null}
      {revokeError ? <RowError>{revokeError}</RowError> : null}
    </li>
  );
}

function SharedMessagesRow() {
  const [shares, setShares] = useState<ShareListItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState<"current" | "all">("current");

  const loadShares = useCallback(() => {
    let cancelled = false;
    apiGet<{ shares: ShareListItem[] }>("/api/shares")
      .then((data) => {
        if (!cancelled) setShares(data.shares);
      })
      .catch((err: any) => {
        if (!cancelled) {
          setShares([]);
          setError(err?.message || "Couldn't load shared messages. Try again.");
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => loadShares(), [loadShares]);

  const revoke = async (shareId: string) => {
    await apiDelete(`/api/shares/${shareId}`);
    setShares((prev) =>
      prev.map((share) =>
        share.id === shareId
          ? {
              ...share,
              status: "revoked",
              revoked_at: new Date().toISOString(),
            }
          : share,
      ),
    );
  };

  const currentShares = shares.filter(
    (share) => effectiveStatus(share) === "active",
  );
  const visibleShares = filter === "current" ? currentShares : shares;

  return (
    <SettingsRow id="shared-messages" layout="block" hideLabel>
      {(ids) => (
        <div className="flex flex-col gap-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div
              role="group"
              aria-labelledby={ids.labelId}
              className="inline-flex rounded-md bg-rm-tint-1 p-0.5"
            >
              {(
                [
                  ["current", `Live (${currentShares.length})`],
                  ["all", `All (${shares.length})`],
                ] as const
              ).map(([id, label]) => (
                <button
                  key={id}
                  type="button"
                  aria-pressed={filter === id}
                  onClick={() => setFilter(id)}
                  className={cn(
                    "h-7 rounded-[6px] px-3 text-ui-sm font-medium transition-colors duration-150",
                    filter === id
                      ? "bg-rm-bg-surface text-rm-text shadow-[var(--rm-shadow-1)] dark:bg-rm-tint-3"
                      : "text-rm-text-secondary pointer-fine:hover:text-rm-text",
                  )}
                >
                  {label}
                </button>
              ))}
            </div>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => {
                setLoading(true);
                setError(null);
                loadShares();
              }}
              disabled={loading}
            >
              <Icon
                name="refresh"
                size="sm"
                className={cn(loading && "animate-spin")}
              />
              Refresh
            </Button>
          </div>

          {loading ? (
            <p
              role="status"
              className="flex items-center gap-2 text-ui-sm text-rm-text-secondary"
            >
              <Icon name="loader" size="sm" className="animate-spin" />
              Loading shared messages…
            </p>
          ) : error ? (
            <RowError>{error}</RowError>
          ) : visibleShares.length === 0 ? (
            <p className="text-ui-sm text-rm-text-secondary">
              {filter === "current"
                ? "No live links. Share a message from its menu to make one."
                : "You haven't shared any messages yet."}
            </p>
          ) : (
            <ul className="divide-y divide-rm-border">
              {visibleShares.map((share) => (
                <ShareItem key={share.id} share={share} onRevoke={revoke} />
              ))}
            </ul>
          )}
        </div>
      )}
    </SettingsRow>
  );
}

export default function PrivacyPanel() {
  return (
    <>
      <SettingsCard id="media-filter">
        <MediaFilterRow />
      </SettingsCard>
      <SettingsCard id="shared-messages">
        <SharedMessagesRow />
      </SettingsCard>
    </>
  );
}
