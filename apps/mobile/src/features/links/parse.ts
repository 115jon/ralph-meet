// The web's link shapes (src/routes/invite.$code.tsx, chat.$.tsx and
// MessageItem's buildMessageLink) and the app's own routes they map to.
// Pure, so the parser is tested in Node; ./links.ts binds it to the config.

export type AppLink =
  | { readonly kind: "invite"; readonly code: string }
  | {
      readonly kind: "conversation";
      readonly conversation: "channel" | "dm";
      readonly channelId: string;
      /** Null for a DM; unknown for the app's own channel links. */
      readonly serverId: string | null;
      readonly messageId: string | null;
    };

export interface LinkOrigins {
  /** The public web app, e.g. https://<web host>. */
  readonly web: string;
  /** The web host before the Yap rename; its links still parse. */
  readonly legacyWeb?: string;
  /** The app's URL scheme (ralphmeet, ralphmeet-dev …). */
  readonly scheme: string;
}

/** The web's "@me" server segment: a DM. */
const DM_SEGMENT = "@me";

function segmentsOf(path: string): string[] {
  return path
    .split("/")
    .filter(Boolean)
    .map((segment) => {
      try {
        return decodeURIComponent(segment);
      } catch {
        return segment;
      }
    });
}

function parseUrl(value: string): URL | null {
  try {
    return new URL(value);
  } catch {
    return null;
  }
}

function webOrigin(web: string): string | null {
  return parseUrl(web)?.origin ?? null;
}

/**
 * What `url` points at in Ralph, or null when it is not one of ours: an
 * invite, or a conversation (and message) on the web host or the app's
 * scheme.
 */
export function parseAppLink(
  url: string,
  origins: LinkOrigins,
): AppLink | null {
  const parsed = parseUrl(url.trim());
  if (!parsed) return null;
  const message = parsed.searchParams.get("message") || null;

  if (parsed.protocol === `${origins.scheme}:`) {
    // ralphmeet://invite/CODE: the host is the first segment.
    const [head, id] = [parsed.host, ...segmentsOf(parsed.pathname)];
    if (!id) return null;
    if (head === "invite") return { kind: "invite", code: id };
    if (head === "channel" || head === "dm") {
      return {
        kind: "conversation",
        conversation: head,
        channelId: id,
        serverId: null,
        messageId: message,
      };
    }
    return null;
  }

  const webOrigins = [origins.web, origins.legacyWeb].map((web) =>
    web ? webOrigin(web) : null,
  );
  if (!webOrigins.includes(parsed.origin)) return null;
  const [head, first, second] = segmentsOf(parsed.pathname);
  if (head === "invite" && first) return { kind: "invite", code: first };
  if (head === "chat" && first && second) {
    const dm = first === DM_SEGMENT;
    return {
      kind: "conversation",
      conversation: dm ? "dm" : "channel",
      channelId: second,
      serverId: dm ? null : first,
      messageId: message,
    };
  }
  return null;
}

/** The app route for a link: /invite/CODE, /channel/ID or /dm/ID (?message=). */
export function appPathOf(link: AppLink): string {
  if (link.kind === "invite") return `/invite/${encodeURIComponent(link.code)}`;
  const base = `/${link.conversation}/${encodeURIComponent(link.channelId)}`;
  return link.messageId
    ? `${base}?message=${encodeURIComponent(link.messageId)}`
    : base;
}

/** The web's message link, as its "Copy link" makes it. */
export function messageLink(
  web: string,
  serverId: string | null,
  channelId: string,
  messageId: string,
): string {
  const server = encodeURIComponent(serverId ?? DM_SEGMENT);
  return `${web.replace(/\/$/, "")}/chat/${server}/${encodeURIComponent(channelId)}?message=${encodeURIComponent(messageId)}`;
}

/** The web's invite link. */
export function inviteLink(web: string, code: string): string {
  return `${web.replace(/\/$/, "")}/invite/${encodeURIComponent(code)}`;
}
