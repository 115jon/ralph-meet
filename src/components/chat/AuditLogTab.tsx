/**
 * Server settings → Audit log. The page heading is the workbench header, so
 * every state (loading, empty, error, list) keeps it; this body only swaps
 * what sits under it.
 *
 * Entries read as sentences ("Jon updated role Moderator") with targets by
 * name; the ID sits in a tooltip, permission changes are a diff list, and
 * nothing shows a raw ID or bitfield (overlays audit flow 13).
 */

import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { apiGet } from "@/lib/api-client";
import { describeApiError } from "@/lib/api-errors";
import { useClientDateFormatter } from "@/lib/client-date-format";
import { getDisplayName } from "@/lib/display-name";
import { getAuthAssetUrl } from "@/lib/platform";
import type { Role, ServerAuditLog, User } from "@/lib/types";
import { cn } from "@/lib/utils";
import { useChatStore } from "@/stores/chat-store";
import { useCallback, useEffect, useMemo, useState } from "react";
import InlineEmojiText from "./InlineEmojiText";
import { SettingsCard } from "./settings/primitives";
import {
  describeAudit,
  previousRoleStates,
  type RoleState,
  type AuditDetail,
  type AuditLookup,
  type AuditTarget,
} from "./server-settings/audit-format";
import {
  LoadError,
  PageState,
  RowAvatar,
  SkeletonRows,
} from "./server-settings/states";

interface AuditLogTabProps {
  serverId: string;
}

type MemberRow = { user_id?: string; user?: Partial<User> | null };
type BanRow = { user_id: string; username?: string };

function TargetName({ target }: { target: AuditTarget }) {
  const text = target.code ? (
    <span className="font-mono text-ui-sm">{target.label}</span>
  ) : (
    <InlineEmojiText text={target.label} />
  );
  const className = cn(target.named ? "font-medium text-ink-1" : "text-ink-2");
  if (!target.id) return <span className={className}>{text}</span>;
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span
          tabIndex={0}
          className={cn(
            className,
            "rounded-xs underline decoration-line-strong decoration-dotted underline-offset-[3px] outline-offset-2",
          )}
        >
          {text}
        </span>
      </TooltipTrigger>
      <TooltipContent>
        ID <span className="font-mono">{target.id}</span>
      </TooltipContent>
    </Tooltip>
  );
}

function Details({ details }: { details: AuditDetail[] }) {
  if (details.length === 0) return null;
  return (
    <ul className="mt-1.5 flex flex-col gap-0.5 text-ui-sm text-ink-2">
      {details.map((detail, index) => {
        if (detail.type === "perm") {
          return (
            <li key={index} className="flex items-baseline gap-1.5">
              <span
                aria-hidden="true"
                className={cn(
                  "w-3 shrink-0 text-center font-medium",
                  detail.sign === "+" ? "text-success-ink" : "text-danger-ink",
                )}
              >
                {detail.sign}
              </span>
              <span className="sr-only">
                {detail.sign === "+" ? "Allowed " : "Removed "}
              </span>
              <span>{detail.name}</span>
            </li>
          );
        }
        if (detail.type === "list") {
          return (
            <li key={index} className="text-pretty">
              {detail.label}: {detail.items.join(", ")}
            </li>
          );
        }
        return (
          <li key={index} className="text-pretty break-words">
            <InlineEmojiText text={detail.text} />
          </li>
        );
      })}
    </ul>
  );
}

function AuditRow({
  log,
  lookup,
  previousRole,
}: {
  log: ServerAuditLog;
  lookup: AuditLookup;
  previousRole?: RoleState;
}) {
  const formatDate = useClientDateFormatter();
  const actor = getDisplayName(log.actor);
  const entry = describeAudit(log, lookup, previousRole);
  return (
    <li className="flex gap-3 px-4 py-3">
      <RowAvatar
        src={
          log.actor?.avatar_url ? getAuthAssetUrl(log.actor.avatar_url) : null
        }
        name={actor}
        size={24}
      />
      <div className="min-w-0 flex-1">
        <p className="text-pretty text-ui-sm text-ink-2">
          <span className="font-medium text-ink-1">
            <InlineEmojiText text={actor} />
          </span>{" "}
          {entry.verb}
          {entry.target ? (
            <>
              {" "}
              <TargetName target={entry.target} />
            </>
          ) : null}
        </p>
        <Details details={entry.details} />
        {log.reason ? (
          <p className="mt-1.5 text-pretty text-ui-sm text-ink-2">
            Reason: <InlineEmojiText text={log.reason} />
          </p>
        ) : null}
        <p className="mt-1 text-ui-xs text-ink-3">
          <time dateTime={log.created_at}>
            {formatDate(log.created_at, {
              year: "numeric",
              month: "short",
              day: "numeric",
              hour: "numeric",
              minute: "2-digit",
            })}
          </time>
        </p>
      </div>
    </li>
  );
}

/**
 * Names for the targets: roles, members and bans from the API (each one
 * optional; a moderator may not read all of them) plus the channels the
 * client already holds.
 */
function useAuditLookup(serverId: string): AuditLookup {
  const [roles, setRoles] = useState<Role[]>([]);
  const [members, setMembers] = useState<MemberRow[]>([]);
  const [bans, setBans] = useState<BanRow[]>([]);
  const storeMembers = useChatStore((s) => s.membersByServerId[serverId]);
  const channelsByServer = useChatStore((s) => s.channelsByServerId[serverId]);
  const allChannels = useChatStore((s) => s.channels);

  useEffect(() => {
    let current = true;
    const quiet = <T,>(url: string, set: (value: T) => void) =>
      apiGet<T>(url)
        .then((value) => {
          if (current && Array.isArray(value)) set(value);
        })
        .catch(() => {});
    void quiet<Role[]>(`/api/servers/${serverId}/roles`, setRoles);
    void quiet<MemberRow[]>(`/api/servers/${serverId}/members`, setMembers);
    void quiet<BanRow[]>(`/api/servers/${serverId}/bans`, setBans);
    return () => {
      current = false;
    };
  }, [serverId]);

  return useMemo(() => {
    const memberNames = new Map<string, string>();
    for (const ban of bans) {
      if (ban.username) memberNames.set(ban.user_id, ban.username);
    }
    for (const row of members) {
      const id = row.user?.id ?? row.user_id;
      if (id && row.user) memberNames.set(id, getDisplayName(row.user as User));
    }
    for (const member of storeMembers ?? []) {
      memberNames.set(member.user.id, getDisplayName(member.user));
    }
    const channels = new Map<string, { name: string; voice: boolean }>();
    for (const channel of [
      ...allChannels.filter((c) => c.server_id === serverId),
      ...(channelsByServer ?? []),
    ]) {
      channels.set(channel.id, {
        name: channel.name,
        voice: channel.channel_type === "voice",
      });
    }
    return {
      roles: new Map(roles.map((role) => [role.id, role.name])),
      members: memberNames,
      channels,
    };
  }, [
    allChannels,
    bans,
    channelsByServer,
    members,
    roles,
    serverId,
    storeMembers,
  ]);
}

export default function AuditLogTab({ serverId }: AuditLogTabProps) {
  const [logs, setLogs] = useState<ServerAuditLog[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const lookup = useAuditLookup(serverId);

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

  const previous = useMemo(() => previousRoleStates(logs ?? []), [logs]);

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
      <PageState title="No activity yet">
        Changes to roles, channels, invites and bans show here as they happen.
      </PageState>
    );
  }
  return (
    <TooltipProvider>
      <SettingsCard
        title="Recent activity"
        description="Administrative actions taken in this server."
      >
        {logs.map((log) => (
          <AuditRow
            key={log.id}
            log={log}
            lookup={lookup}
            previousRole={previous.get(log.id)}
          />
        ))}
      </SettingsCard>
    </TooltipProvider>
  );
}
