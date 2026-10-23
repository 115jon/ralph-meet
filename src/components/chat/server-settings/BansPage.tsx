/**
 * Server settings → Bans. Loads on mount; unban asks first (reversible, so
 * the red-tint confirm) and a failure stays on its row.
 */

import { Button } from "@/components/ui/button";
import { apiDelete, apiGet } from "@/lib/api-client";
import { describeApiError } from "@/lib/api-errors";
import { useClientDateFormatter } from "@/lib/client-date-format";
import { getAuthAssetUrl } from "@/lib/platform";
import { useCallback, useEffect, useState } from "react";
import InlineEmojiText from "../InlineEmojiText";
import { ConfirmStrip, SettingsCard, useConfirm } from "../settings/primitives";
import { LoadError, PageState, RowAvatar, SkeletonRows } from "./states";

export type ServerBan = {
  server_id: string;
  user_id: string;
  username?: string;
  avatar_url?: string;
  reason?: string;
  banned_by_username?: string;
  created_at: string;
};

function BanRow({
  ban,
  onUnban,
}: {
  ban: ServerBan;
  onUnban: (userId: string) => Promise<void>;
}) {
  const { armed, arm, cancel, done, triggerRef } = useConfirm();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const formatDate = useClientDateFormatter();
  const name = ban.username ?? ban.user_id;
  const date = formatDate(ban.created_at, {
    year: "numeric",
    month: "short",
    day: "numeric",
  });

  return (
    <li className="px-4 py-3 @min-[560px]:px-5">
      <div className="flex items-center gap-3">
        <RowAvatar
          src={ban.avatar_url ? getAuthAssetUrl(ban.avatar_url) : null}
          initial={(name[0] ?? "?").toUpperCase()}
        />
        <div className="min-w-0 flex-1">
          <p className="truncate text-ui-base font-medium text-rm-text">
            <InlineEmojiText text={name} />
          </p>
          {ban.reason ? (
            <p className="text-pretty text-ui-sm text-rm-text-secondary">
              <InlineEmojiText text={ban.reason} />
            </p>
          ) : null}
          <p className="text-ui-xs text-rm-text-secondary">
            Banned by {ban.banned_by_username ?? "a moderator"}
            {date ? ` on ${date}` : ""}
          </p>
        </div>
        {armed ? null : (
          <Button
            ref={triggerRef}
            type="button"
            variant="secondary"
            size="sm"
            className="max-md:min-h-11"
            onClick={() => {
              setError(null);
              arm();
            }}
          >
            Unban
          </Button>
        )}
      </div>
      {armed ? (
        <ConfirmStrip
          consequence={`Unban ${name}? They can rejoin with an invite link.`}
          confirmLabel="Unban"
          busy={busy}
          error={error}
          onCancel={() => {
            setError(null);
            cancel();
          }}
          onConfirm={() => {
            setBusy(true);
            setError(null);
            onUnban(ban.user_id)
              .then(() => done())
              .catch((err: unknown) =>
                setError(describeApiError(err, `unban ${name}`)),
              )
              .finally(() => setBusy(false));
          }}
        />
      ) : null}
    </li>
  );
}

export function BansPage({ serverId }: { serverId: string }) {
  const [bans, setBans] = useState<ServerBan[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setBans(await apiGet<ServerBan[]>(`/api/servers/${serverId}/bans`));
    } catch (err) {
      setError(describeApiError(err, "load the ban list"));
    } finally {
      setLoading(false);
    }
  }, [serverId]);

  useEffect(() => {
    void load();
  }, [load]);

  /** Throws on failure; the row keeps its confirm open with the error. */
  const unban = async (userId: string) => {
    await apiDelete(`/api/servers/${serverId}/bans`, { user_id: userId });
    setBans((prev) => prev?.filter((ban) => ban.user_id !== userId) ?? prev);
  };

  if (error && !bans) {
    return (
      <LoadError
        title="Ban list didn't load"
        message={error}
        retrying={loading}
        onRetry={() => void load()}
      />
    );
  }
  if (!bans) return <SkeletonRows label="Loading bans" rows={2} />;
  if (bans.length === 0) {
    return (
      <PageState icon="ban" title="No one is banned">
        People you ban from the member list show here, so you can let them back
        in later.
      </PageState>
    );
  }
  return (
    <SettingsCard
      title="Banned members"
      description="They can't rejoin, even with an invite, until you unban them."
    >
      {bans.map((ban) => (
        <BanRow key={ban.user_id} ban={ban} onUnban={unban} />
      ))}
    </SettingsCard>
  );
}
