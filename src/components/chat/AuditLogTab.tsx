/**
 * Server settings → Audit log. The page heading is the workbench header, so
 * every state (loading, empty, error, list) keeps it; this body only swaps
 * what sits under it (design-system 14.1-14.3).
 */

import { apiGet } from "@/lib/api-client";
import { describeApiError } from "@/lib/api-errors";
import { useClientDateFormatter } from "@/lib/client-date-format";
import { getDisplayInitial, getDisplayName } from "@/lib/display-name";
import { getAuthAssetUrl } from "@/lib/platform";
import type { ServerAuditLog } from "@/lib/types";
import { useCallback, useEffect, useState } from "react";
import InlineEmojiText from "./InlineEmojiText";
import { SettingsCard } from "./settings/primitives";
import {
  LoadError,
  PageState,
  RowAvatar,
  SkeletonRows,
} from "./server-settings/states";

interface AuditLogTabProps {
  serverId: string;
}

/** "MEMBER_BAN_ADD" → "Member ban add". */
function formatActionType(type: string) {
  const words = type.toLowerCase().split("_").filter(Boolean).join(" ");
  return words.charAt(0).toUpperCase() + words.slice(1);
}

function formatValue(value: unknown) {
  if (value === null || value === undefined || value === "") return "Removed";
  if (typeof value === "object") return JSON.stringify(value);
  return String(value);
}

function AuditRow({ log }: { log: ServerAuditLog }) {
  const formatDate = useClientDateFormatter();
  const actor = getDisplayName(log.actor);
  const changes =
    log.changes && typeof log.changes === "object"
      ? Object.entries(log.changes as Record<string, unknown>)
      : [];
  return (
    <li className="flex gap-3 px-4 py-3.5 @min-[560px]:px-5">
      <RowAvatar
        src={
          log.actor?.avatar_url ? getAuthAssetUrl(log.actor.avatar_url) : null
        }
        initial={getDisplayInitial(log.actor)}
        size="sm"
      />
      <div className="min-w-0 flex-1">
        <p className="flex flex-wrap items-center gap-x-2 gap-y-1">
          <span className="text-ui-base font-medium text-rm-text">
            <InlineEmojiText text={actor} />
          </span>
          <span className="rounded-sm bg-rm-tint-2 px-1.5 text-ui-xs font-medium leading-5 text-rm-text-secondary">
            {formatActionType(log.action_type)}
          </span>
        </p>
        <p className="mt-0.5 text-ui-xs text-rm-text-secondary">
          <time dateTime={log.created_at}>
            {formatDate(log.created_at, {
              year: "numeric",
              month: "short",
              day: "numeric",
              hour: "numeric",
              minute: "2-digit",
            })}
          </time>
          {log.target_id ? (
            <>
              {" · Target "}
              <span className="break-all font-mono">{log.target_id}</span>
            </>
          ) : null}
        </p>
        {log.reason ? (
          <p className="mt-2 border-l-2 border-rm-border-strong pl-3 text-pretty text-ui-sm text-rm-text">
            <InlineEmojiText text={log.reason} />
          </p>
        ) : null}
        {changes.length > 0 ? (
          <dl className="mt-2 grid grid-cols-[auto_minmax(0,1fr)] gap-x-3 gap-y-1 rounded-md bg-rm-tint-1 px-3 py-2 text-ui-xs">
            {changes.map(([key, value]) => (
              <div key={key} className="contents">
                <dt className="font-medium text-rm-text-secondary">{key}</dt>
                <dd className="break-words text-rm-text">
                  {formatValue(value)}
                </dd>
              </div>
            ))}
          </dl>
        ) : null}
      </div>
    </li>
  );
}

export default function AuditLogTab({ serverId }: AuditLogTabProps) {
  const [logs, setLogs] = useState<ServerAuditLog[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(
    async (isCurrent: () => boolean = () => true) => {
      setLoading(true);
      setError(null);
      try {
        const data = await apiGet<ServerAuditLog[]>(
          `/api/servers/${serverId}/audit-logs`,
        );
        if (isCurrent()) setLogs(data);
      } catch (err) {
        if (isCurrent()) setError(describeApiError(err, "load the audit log"));
      } finally {
        if (isCurrent()) setLoading(false);
      }
    },
    [serverId],
  );

  useEffect(() => {
    let current = true;
    void load(() => current);
    return () => {
      current = false;
    };
  }, [load]);

  if (error) {
    return (
      <LoadError
        title="Audit log didn't load"
        message={error}
        retrying={loading}
        onRetry={() => void load()}
      />
    );
  }
  if (!logs) return <SkeletonRows label="Loading the audit log" />;
  if (logs.length === 0) {
    return (
      <PageState icon="auditLog" title="No activity yet">
        Changes to roles, channels, invites and bans show here as they happen.
      </PageState>
    );
  }
  return (
    <SettingsCard
      title="Recent activity"
      description="Administrative actions taken in this server."
    >
      {logs.map((log) => (
        <AuditRow key={log.id} log={log} />
      ))}
    </SettingsCard>
  );
}
