import type { DmChannel } from "@/features/dms/schema";
import type { Server } from "@/features/servers/schema";
import type { ServerTree } from "@/features/servers/store";
import { channelKind } from "@/features/servers/tree";

/** A conversation a share can go to. */
export interface ShareTarget {
  readonly kind: "channel" | "dm";
  readonly channelId: string;
  /** "#general" or a person's name. */
  readonly name: string;
  /** The server's name, or the person's @username. */
  readonly detail: string;
  readonly avatar: string | null;
  readonly lastActivity: string;
}

export interface TargetSources {
  readonly dms: readonly DmChannel[];
  readonly servers: readonly Server[];
  readonly trees: Readonly<Record<string, ServerTree>>;
  readonly lastMessageAt: Readonly<Record<string, string>>;
}

/** Without a search, the most recently active conversations, this many. */
const RECENT_LIMIT = 30;

function allTargets(sources: TargetSources): ShareTarget[] {
  const { dms, servers, trees, lastMessageAt } = sources;
  const targets: ShareTarget[] = dms.map((dm) => ({
    kind: "dm",
    channelId: dm.id,
    name: dm.recipient.display_name?.trim() || dm.recipient.username,
    detail: `@${dm.recipient.username}`,
    avatar: dm.recipient.avatar_url ?? null,
    lastActivity: lastMessageAt[dm.id] ?? dm.created_at,
  }));
  for (const server of servers) {
    for (const channel of trees[server.id]?.channels ?? []) {
      if (channelKind(channel) !== "text") continue;
      targets.push({
        kind: "channel",
        channelId: channel.id,
        name: `#${channel.name}`,
        detail: server.name,
        avatar: server.icon_url ?? null,
        lastActivity: lastMessageAt[channel.id] ?? "",
      });
    }
  }
  return targets;
}

const byActivity = (a: ShareTarget, b: ShareTarget) =>
  a.lastActivity < b.lastActivity
    ? 1
    : a.lastActivity > b.lastActivity
      ? -1
      : 0;

/**
 * Where a share can go: DMs and text channels, most recently active first.
 * A search matches names and servers or usernames, prefix matches first.
 */
export function shareTargets(
  sources: TargetSources,
  query: string,
): ShareTarget[] {
  const targets = allTargets(sources).sort(byActivity);
  const q = query.trim().toLowerCase().replace(/^[#@]/, "");
  if (!q) return targets.slice(0, RECENT_LIMIT);
  const rank = (target: ShareTarget): number => {
    const name = target.name.toLowerCase().replace(/^#/, "");
    const detail = target.detail.toLowerCase().replace(/^@/, "");
    if (name.startsWith(q)) return 0;
    if (name.includes(q)) return 1;
    if (detail.startsWith(q)) return 2;
    if (detail.includes(q)) return 3;
    return -1;
  };
  return targets
    .map((target) => ({ target, rank: rank(target) }))
    .filter(({ rank }) => rank >= 0)
    .sort((a, b) => a.rank - b.rank || byActivity(a.target, b.target))
    .map(({ target }) => target);
}
