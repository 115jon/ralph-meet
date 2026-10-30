/**
 * Server settings → Invites: pause switch, create form, and the active links
 * as a row list that fits every width (no table to clip at 390). Every
 * failure shows next to its control; a list failure is an in-card error
 * with Retry.
 *
 * Countdowns share one module-level ticker (server-settings/invite-clock)
 * and read in minutes above an hour. While invites are paused the rows dim
 * to 50% under a "Paused" badge; their actions stay live (flow 11).
 */

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { Icon } from "@/components/ui/icon";
import { Num } from "@/components/ui/num";
import { copyToClipboard } from "@/components/ui/toast";
import { apiDelete, apiGet, apiPatch, apiPost } from "@/lib/api-client";
import { describeApiError } from "@/lib/api-errors";
import { getDisplayName } from "@/lib/display-name";
import { getAuthAssetUrl, getWebOrigin } from "@/lib/platform";
import type { Invite } from "@/lib/types";
import { cn } from "@/lib/utils";
import { useChatStore } from "@/stores/chat-store";
import { useCallback, useEffect, useRef, useState } from "react";
import InlineEmojiText from "./InlineEmojiText";
import { SettingsSwitch } from "./SettingsSwitch";
import {
  ConfirmStrip,
  RowError,
  SettingsCard,
  SettingsRow,
  SettingsSelect,
  useConfirm,
} from "./settings/primitives";
import { useRemaining } from "./server-settings/invite-clock";
import { ListError, RowAvatar, SkeletonRows } from "./server-settings/states";

interface InvitesTabProps {
  serverId: string;
  serverName: string;
}

const inviteLink = (code: string) => `${getWebOrigin()}/invite/${code}`;

function Countdown({ expiresAt }: { expiresAt: string }) {
  const left = useRemaining(expiresAt);
  if (!left) return <span className="text-danger-ink">Expired</span>;
  return (
    <span>
      Expires in <Num size="sm">{left}</Num>
    </span>
  );
}

function InviteRow({
  invite,
  paused,
  onRevoke,
}: {
  invite: Invite;
  /** Invites are paused: the row dims, its actions stay live. */
  paused: boolean;
  onRevoke: (code: string) => Promise<void>;
}) {
  const members = useChatStore((s) => s.members);
  const { armed, arm, cancel, done, triggerRef } = useConfirm();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const copiedTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(
    () => () => {
      if (copiedTimer.current) clearTimeout(copiedTimer.current);
    },
    [],
  );

  const member = members.find((m) => m.user.id === invite.inviter_id);
  const inviter = member?.user ?? invite.inviter;
  const inviterName = getDisplayName(inviter, "Unknown");
  const avatar = inviter?.avatar_url ?? null;

  const copy = async () => {
    setError(null);
    // The shared "Link copied" toast, and the button flips for 2s.
    if (await copyToClipboard(inviteLink(invite.code), "Link copied")) {
      setCopied(true);
      if (copiedTimer.current) clearTimeout(copiedTimer.current);
      copiedTimer.current = setTimeout(() => setCopied(false), 2000);
    } else {
      setError(
        `Unable to copy the link. Copy it by hand: ${inviteLink(invite.code)}`,
      );
    }
  };

  const uses = invite.max_uses
    ? `${invite.uses} of ${invite.max_uses} uses`
    : invite.uses === 1
      ? "1 use"
      : `${invite.uses} uses`;

  return (
    <li className="px-4 py-3">
      <div className="flex flex-col gap-3 @min-[560px]:flex-row @min-[560px]:items-center">
        <div
          data-paused={paused || undefined}
          className="flex min-w-0 flex-1 items-center gap-3 transition-opacity duration-(--dur-2) ease-out data-paused:opacity-50"
        >
          <RowAvatar
            src={avatar ? getAuthAssetUrl(avatar) : null}
            name={inviterName}
          />
          <div className="min-w-0">
            <p className="truncate font-mono text-ui-sm leading-5 text-ink-1">
              {invite.code}
            </p>
            <p className="text-ui-xs text-ink-3">
              {invite.channel_name ? (
                <>
                  <InlineEmojiText text={`#${invite.channel_name}`} />
                  {" · "}
                </>
              ) : null}
              by <InlineEmojiText text={inviterName} />
              {" · "}
              {uses}
              {invite.temporary ? " · Temporary" : ""}
              {" · "}
              {invite.expires_at ? (
                <Countdown expiresAt={invite.expires_at} />
              ) : (
                "Never expires"
              )}
            </p>
          </div>
        </div>
        {armed ? null : (
          <div className="flex shrink-0 items-center gap-2 pl-12 @min-[560px]:pl-0">
            <Button
              type="button"
              variant="secondary"
              size="sm"
              className="max-md:min-h-11"
              aria-label={copied ? undefined : `Copy link for ${invite.code}`}
              onClick={() => void copy()}
            >
              <Icon
                name={copied ? "check" : "copy"}
                size="sm"
                className={cn(copied && "text-success-ink")}
              />
              {copied ? "Copied" : "Copy link"}
            </Button>
            <Button
              ref={triggerRef}
              type="button"
              variant="ghost"
              size="sm"
              className="max-md:min-h-11"
              aria-label={`Revoke ${invite.code}`}
              onClick={() => {
                setError(null);
                arm();
              }}
            >
              Revoke
            </Button>
          </div>
        )}
      </div>
      {armed ? (
        <ConfirmStrip
          irreversible
          consequence={`Revoke ${invite.code}? Anyone holding this link can no longer join with it.`}
          confirmLabel="Revoke link"
          busy={busy}
          error={error}
          onCancel={() => {
            setError(null);
            cancel();
          }}
          onConfirm={() => {
            setBusy(true);
            setError(null);
            onRevoke(invite.code)
              .then(() => done())
              .catch((err: unknown) =>
                setError(describeApiError(err, "revoke this invite")),
              )
              .finally(() => setBusy(false));
          }}
        />
      ) : error ? (
        <RowError>{error}</RowError>
      ) : null}
    </li>
  );
}

const EXPIRY_OPTIONS = [
  { value: "1800", label: "30 minutes" },
  { value: "3600", label: "1 hour" },
  { value: "21600", label: "6 hours" },
  { value: "43200", label: "12 hours" },
  { value: "86400", label: "1 day" },
  { value: "604800", label: "7 days" },
  { value: "0", label: "Never" },
];

const USES_OPTIONS = [
  { value: "0", label: "No limit" },
  { value: "1", label: "1 use" },
  { value: "5", label: "5 uses" },
  { value: "10", label: "10 uses" },
  { value: "25", label: "25 uses" },
  { value: "50", label: "50 uses" },
  { value: "100", label: "100 uses" },
];

const SERVER_DEFAULT = "__server_default__";

function CreateInviteCard({
  serverId,
  onCreated,
  onCancel,
}: {
  serverId: string;
  onCreated: (code: string) => Promise<void>;
  onCancel: () => void;
}) {
  const channels = useChatStore((s) => s.channels);
  const textChannels = channels.filter((c) => c.channel_type === "text");
  const [channelId, setChannelId] = useState("");
  const [maxAge, setMaxAge] = useState(604800);
  const [maxUses, setMaxUses] = useState(0);
  const [temporary, setTemporary] = useState(false);
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const create = async () => {
    if (creating) return;
    setCreating(true);
    setError(null);
    try {
      const data = await apiPost<{ code: string }>(
        `/api/servers/${serverId}/invites`,
        {
          channel_id: channelId || undefined,
          max_age: maxAge || undefined,
          max_uses: maxUses || undefined,
          temporary: temporary || undefined,
        },
      );
      await onCreated(data.code);
    } catch (err) {
      setError(describeApiError(err, "create the invite link"));
    } finally {
      setCreating(false);
    }
  };

  return (
    <SettingsCard
      title="New invite link"
      description="The link is copied once it's created."
    >
      <SettingsRow id="invite-channel" label="Channel">
        {(ids) => (
          <SettingsSelect
            ids={ids}
            value={channelId || SERVER_DEFAULT}
            onValueChange={(value) =>
              setChannelId(value === SERVER_DEFAULT ? "" : value)
            }
            options={[
              { value: SERVER_DEFAULT, label: "Server default" },
              ...textChannels.map((channel) => ({
                value: channel.id,
                label: `#${channel.name}`,
              })),
            ]}
            renderLabel={(option) => <InlineEmojiText text={option.label} />}
          />
        )}
      </SettingsRow>
      <SettingsRow id="invite-expiry" label="Expires after">
        {(ids) => (
          <SettingsSelect
            ids={ids}
            value={String(maxAge)}
            onValueChange={(value) => setMaxAge(Number(value))}
            options={EXPIRY_OPTIONS}
          />
        )}
      </SettingsRow>
      <SettingsRow id="invite-uses" label="Maximum uses">
        {(ids) => (
          <SettingsSelect
            ids={ids}
            value={String(maxUses)}
            onValueChange={(value) => setMaxUses(Number(value))}
            options={USES_OPTIONS}
          />
        )}
      </SettingsRow>
      <SettingsRow
        id="invite-temporary"
        label="Temporary membership"
        description="People who join with this link get temporary membership."
        layout="inline"
      >
        {({ labelId, descId }) => (
          <SettingsSwitch
            checked={temporary}
            labelledBy={labelId}
            describedBy={descId}
            onChange={() => setTemporary((value) => !value)}
          />
        )}
      </SettingsRow>
      <li className="px-4 py-3.5">
        {error ? <RowError className="mt-0 mb-3">{error}</RowError> : null}
        <div className="flex justify-end gap-2">
          <Button
            type="button"
            variant="ghost"
            className="max-md:min-h-11"
            disabled={creating}
            onClick={onCancel}
          >
            Cancel
          </Button>
          <Button
            type="button"
            className="max-md:min-h-11"
            loading={creating}
            onClick={() => void create()}
          >
            Create link
          </Button>
        </div>
      </li>
    </SettingsCard>
  );
}

export default function InvitesTab({ serverId, serverName }: InvitesTabProps) {
  const [invites, setInvites] = useState<Invite[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [paused, setPaused] = useState(false);
  const [pauseBusy, setPauseBusy] = useState(false);
  const [pauseError, setPauseError] = useState<string | null>(null);
  const [showCreate, setShowCreate] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const createTriggerRef = useRef<HTMLButtonElement>(null);

  const fetchInvites = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    try {
      setInvites(await apiGet<Invite[]>(`/api/servers/${serverId}/invites`));
    } catch (err) {
      setLoadError(describeApiError(err, "load the invite links"));
    } finally {
      setLoading(false);
    }
  }, [serverId]);

  useEffect(() => {
    void fetchInvites();
    apiGet<{ invites_paused?: number | boolean }>(
      `/api/servers/${serverId}/settings`,
    )
      .then((data) => setPaused(Boolean(data.invites_paused)))
      // Older servers have no GET here; treat invites as running.
      .catch(() => {});
  }, [fetchInvites, serverId]);

  // Live use counts from the gateway.
  useEffect(() => {
    const handler = (e: Event) => {
      const detail = (e as CustomEvent).detail;
      if (
        detail?.event === "INVITE_UPDATED" &&
        detail.data.server_id === serverId
      ) {
        setInvites(
          (prev) =>
            prev?.map((inv) =>
              inv.code === detail.data.code
                ? { ...inv, uses: detail.data.uses }
                : inv,
            ) ?? prev,
        );
      }
    };
    window.addEventListener("chat-gateway-event", handler);
    return () => window.removeEventListener("chat-gateway-event", handler);
  }, [serverId]);

  const togglePause = async () => {
    if (pauseBusy) return;
    const next = !paused;
    setPauseBusy(true);
    setPauseError(null);
    setPaused(next);
    try {
      await apiPatch(`/api/servers/${serverId}/settings`, {
        invites_paused: next,
      });
    } catch (err) {
      setPaused(!next);
      setPauseError(
        describeApiError(err, next ? "pause invites" : "resume invites"),
      );
    } finally {
      setPauseBusy(false);
    }
  };

  const onCreated = async (code: string) => {
    setShowCreate(false);
    await fetchInvites();
    try {
      await navigator.clipboard.writeText(inviteLink(code));
      setNotice(`Invite ${code} created and copied.`);
    } catch {
      setNotice(`Invite ${code} created. Use Copy link to share it.`);
    }
    requestAnimationFrame(() => createTriggerRef.current?.focus());
  };

  /** Throws on failure; the row keeps its confirm open with the error. */
  const revoke = async (code: string) => {
    await apiDelete(`/api/servers/${serverId}/invites/${code}`);
    setInvites((prev) => prev?.filter((i) => i.code !== code) ?? prev);
  };

  let rows;
  if (loadError) {
    rows = (
      <ListError
        title="Invite links didn't load"
        message={loadError}
        retrying={loading}
        onRetry={() => void fetchInvites()}
      />
    );
  } else if (!invites) {
    rows = null;
  } else if (invites.length === 0) {
    rows = (
      <li>
        <EmptyState
          size="sm"
          art={null}
          title="No active invite links"
          description={
            <>
              Create a link to let people join{" "}
              <InlineEmojiText text={serverName} />.
            </>
          }
        />
      </li>
    );
  } else {
    rows = invites.map((invite) => (
      <InviteRow
        key={invite.code}
        invite={invite}
        paused={paused}
        onRevoke={revoke}
      />
    ));
  }

  const list =
    !invites && !loadError ? (
      <SkeletonRows label="Loading invite links" rows={3} />
    ) : (
      <SettingsCard
        title={
          <span className="flex items-center gap-2">
            Active links
            {paused ? <Badge variant="secondary">Paused</Badge> : null}
          </span>
        }
      >
        {rows}
      </SettingsCard>
    );

  return (
    <>
      <SettingsCard
        title="Invite links"
        description={
          <>
            Links that let people join <InlineEmojiText text={serverName} />.
          </>
        }
        actions={
          showCreate ? null : (
            <Button
              ref={createTriggerRef}
              type="button"
              className="max-md:min-h-11"
              onClick={() => {
                setNotice(null);
                setShowCreate(true);
              }}
            >
              <Icon name="add" size="sm" />
              Create link
            </Button>
          )
        }
      >
        <SettingsRow
          id="invites-paused"
          label="Pause invites"
          layout="inline"
          description="Stops every link from working until you turn this off."
          footer={pauseError ? <RowError>{pauseError}</RowError> : undefined}
        >
          {({ labelId, descId }) => (
            <SettingsSwitch
              checked={paused}
              disabled={pauseBusy}
              labelledBy={labelId}
              describedBy={descId}
              onChange={() => void togglePause()}
            />
          )}
        </SettingsRow>
      </SettingsCard>

      <p role="status" className="sr-only">
        {notice ?? ""}
      </p>
      {notice ? (
        <p className="flex items-center gap-2 text-ui-sm text-success-ink">
          <Icon name="success" size="sm" className="shrink-0" />
          {notice}
        </p>
      ) : null}

      {showCreate ? (
        <CreateInviteCard
          serverId={serverId}
          onCreated={onCreated}
          onCancel={() => {
            setShowCreate(false);
            requestAnimationFrame(() => createTriggerRef.current?.focus());
          }}
        />
      ) : null}

      {list}
    </>
  );
}
