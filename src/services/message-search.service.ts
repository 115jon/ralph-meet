/**
 * Message search over D1. The route decides *where* the caller may look
 * (visible channels of a server, or one channel they can read); this service
 * only applies the parsed filters inside that scope.
 *
 * Matching is substring based (`instr` on lower-cased content), so every term
 * must appear somewhere in the message. "Relevant" sorting is a heuristic on
 * top of that: whole phrase first, then a whole-word hit on the first term,
 * then shorter messages, then recency.
 */

import {
  extractSearchTerms,
  type MessageSearchQuery,
  type MessageSearchResponse,
  type SearchHasValue,
  type SearchResultAttachment,
  type SearchResultMessage,
} from "@/lib/message-search";
import type { D1Database } from "@cloudflare/workers-types";

export interface MessageSearchScope {
  /** When set, channels must also belong to this server. */
  serverId: string | null;
  /** Channels the caller may read. Empty means nothing is searchable. */
  channelIds: readonly string[];
}

const HAS_SQL: Record<SearchHasValue, string> = {
  link: "(instr(m.content, 'http://') > 0 OR instr(m.content, 'https://') > 0)",
  embed: "(m.embeds IS NOT NULL AND m.embeds NOT IN ('', '[]'))",
  file: "EXISTS (SELECT 1 FROM attachments a WHERE a.message_id = m.id)",
  image:
    "EXISTS (SELECT 1 FROM attachments a WHERE a.message_id = m.id AND a.content_type LIKE 'image/%')",
  video:
    "EXISTS (SELECT 1 FROM attachments a WHERE a.message_id = m.id AND a.content_type LIKE 'video/%')",
  sound:
    "EXISTS (SELECT 1 FROM attachments a WHERE a.message_id = m.id AND a.content_type LIKE 'audio/%')",
};

function emptyResponse(query: MessageSearchQuery): MessageSearchResponse {
  return {
    messages: [],
    total: 0,
    limit: query.limit,
    offset: query.offset,
    has_more: false,
  };
}

function countEmbeds(raw: unknown): number {
  if (typeof raw !== "string" || raw === "" || raw === "[]") return 0;
  try {
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.length : 0;
  } catch {
    return 0;
  }
}

const str = (v: unknown): string | null =>
  typeof v === "string" && v !== "" ? v : null;

export async function searchMessages(
  db: D1Database,
  scope: MessageSearchScope,
  query: MessageSearchQuery,
): Promise<MessageSearchResponse> {
  const allowed = new Set(scope.channelIds);
  const channelIds =
    query.channelIds.length > 0
      ? query.channelIds.filter((id) => allowed.has(id))
      : [...allowed];
  if (channelIds.length === 0) return emptyResponse(query);

  const where: string[] = ["m.channel_id IN (SELECT value FROM json_each(?))"];
  const binds: unknown[] = [JSON.stringify(channelIds)];

  const terms = extractSearchTerms(query.text);
  for (const term of terms) {
    where.push("instr(lower(m.content), lower(?)) > 0");
    binds.push(term);
  }
  if (query.authorIds.length > 0) {
    where.push("m.author_id IN (SELECT value FROM json_each(?))");
    binds.push(JSON.stringify(query.authorIds));
  }
  if (query.mentionIds.length > 0) {
    // Mentions are stored as `@username` in content.
    where.push(
      `EXISTS (SELECT 1 FROM users mu
               WHERE mu.id IN (SELECT value FROM json_each(?))
                 AND instr(lower(m.content), '@' || lower(mu.username)) > 0)`,
    );
    binds.push(JSON.stringify(query.mentionIds));
  }
  for (const has of query.has) where.push(HAS_SQL[has]);
  if (query.pinned !== null) {
    where.push("m.is_pinned = ?");
    binds.push(query.pinned ? 1 : 0);
  }
  if (query.after) {
    where.push("julianday(m.created_at) >= julianday(?)");
    binds.push(query.after);
  }
  if (query.before) {
    where.push("julianday(m.created_at) < julianday(?)");
    binds.push(query.before);
  }

  const join = scope.serverId
    ? "JOIN channels c ON c.id = m.channel_id AND c.server_id = ?"
    : "JOIN channels c ON c.id = m.channel_id";
  const joinBinds = scope.serverId ? [scope.serverId] : [];
  const whereSql = where.join("\n         AND ");

  let orderSql = "m.created_at DESC, m.id DESC";
  const orderBinds: unknown[] = [];
  if (query.sort === "oldest") orderSql = "m.created_at ASC, m.id ASC";
  if (query.sort === "relevant" && terms.length > 0) {
    orderSql = `CASE WHEN instr(lower(m.content), lower(?)) > 0 THEN 0 ELSE 1 END,
                CASE WHEN instr(' ' || lower(m.content) || ' ', ' ' || lower(?) || ' ') > 0 THEN 0 ELSE 1 END,
                length(m.content) ASC,
                m.created_at DESC`;
    orderBinds.push(query.text, terms[0]);
  }

  const { results } = await db
    .prepare(
      `SELECT m.id, m.channel_id, m.author_id, m.content, m.created_at, m.updated_at,
              m.is_pinned, m.embeds,
              u.username AS author_username, u.display_name AS author_display_name,
              u.avatar_url AS author_avatar_url, u.avatar_display AS author_avatar_display,
              u.display_name_style AS author_display_name_style,
              c.name AS channel_name
       FROM messages m
       ${join}
       LEFT JOIN users u ON u.id = m.author_id
       WHERE ${whereSql}
       ORDER BY ${orderSql}
       LIMIT ? OFFSET ?`,
    )
    .bind(...joinBinds, ...binds, ...orderBinds, query.limit, query.offset)
    .all();

  const countRow = (await db
    .prepare(
      `SELECT COUNT(*) AS total
       FROM messages m
       ${join}
       WHERE ${whereSql}`,
    )
    .bind(...joinBinds, ...binds)
    .first()) as { total: number } | null;

  const rows = (results ?? []) as Record<string, unknown>[];
  const ids = rows.map((r) => String(r.id));
  const attachmentsByMessage = new Map<string, SearchResultAttachment[]>();
  if (ids.length > 0) {
    const { results: attachmentRows } = await db
      .prepare(
        `SELECT id, message_id, filename, content_type, size_bytes
         FROM attachments
         WHERE message_id IN (SELECT value FROM json_each(?))
         ORDER BY created_at ASC`,
      )
      .bind(JSON.stringify(ids))
      .all();
    for (const row of (attachmentRows ?? []) as Record<string, unknown>[]) {
      const messageId = String(row.message_id);
      const list = attachmentsByMessage.get(messageId) ?? [];
      list.push({
        id: String(row.id),
        filename: String(row.filename ?? "file"),
        content_type: str(row.content_type),
        size_bytes: Number(row.size_bytes ?? 0),
      });
      attachmentsByMessage.set(messageId, list);
    }
  }

  const messages: SearchResultMessage[] = rows.map((row) => {
    const id = String(row.id);
    const authorId = String(row.author_id);
    return {
      id,
      channel_id: String(row.channel_id),
      channel_name: str(row.channel_name),
      author_id: authorId,
      author: {
        id: authorId,
        username: str(row.author_username) ?? "Unknown",
        display_name: str(row.author_display_name),
        avatar_url: str(row.author_avatar_url),
        avatar_display: str(row.author_avatar_display),
        display_name_style: str(row.author_display_name_style),
      },
      content: typeof row.content === "string" ? row.content : "",
      is_pinned: !!row.is_pinned,
      created_at: String(row.created_at),
      updated_at: str(row.updated_at),
      attachments: attachmentsByMessage.get(id) ?? [],
      embed_count: countEmbeds(row.embeds),
    };
  });

  const total = Number(countRow?.total ?? 0);
  return {
    messages,
    total,
    limit: query.limit,
    offset: query.offset,
    has_more: query.offset + messages.length < total,
  };
}
