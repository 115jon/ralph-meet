// ── html-meta ───────────────────────────────────────────────────────────────
// Tolerant <meta> extraction for link previews. Real pages put attributes in
// any order, use single or double quotes (or none), and HTML-encode their
// content, so a fixed `property="..." content="..."` regex misses a lot of
// them. Only the document head is scanned.

const HEAD_SCAN_LIMIT = 512 * 1024;

const NAMED_ENTITIES: Record<string, string> = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
  nbsp: " ",
  hellip: "…",
  mdash: "—",
  ndash: "–",
  lsquo: "‘",
  rsquo: "’",
  ldquo: "“",
  rdquo: "”",
  middot: "·",
  bull: "•",
  copy: "©",
  reg: "®",
  trade: "™",
};

export function decodeHtmlEntities(value: string): string {
  return value.replace(
    /&(#x[0-9a-f]+|#\d+|[a-z][a-z0-9]*);/gi,
    (match, entity: string) => {
      if (entity[0] === "#") {
        const codePoint =
          entity[1] === "x" || entity[1] === "X"
            ? Number.parseInt(entity.slice(2), 16)
            : Number.parseInt(entity.slice(1), 10);
        if (
          Number.isFinite(codePoint) &&
          codePoint > 0 &&
          codePoint <= 0x10ffff
        ) {
          try {
            return String.fromCodePoint(codePoint);
          } catch {
            return match;
          }
        }
        return match;
      }
      return NAMED_ENTITIES[entity.toLowerCase()] ?? match;
    },
  );
}

function parseAttributes(tag: string): Record<string, string> {
  const attributes: Record<string, string> = {};
  const attributeRegex =
    /([a-zA-Z_:][-a-zA-Z0-9_:.]*)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+))/g;
  for (const match of tag.matchAll(attributeRegex)) {
    const name = match[1].toLowerCase();
    if (name in attributes) continue;
    attributes[name] = match[2] ?? match[3] ?? match[4] ?? "";
  }
  return attributes;
}

export interface HtmlMeta {
  /** First value per lowercased `property`/`name`/`itemprop` key. */
  get(key: string): string | undefined;
  /** First non-empty value among the keys, in order. */
  first(...keys: string[]): string | undefined;
  title?: string;
}

export function parseHtmlMeta(html: string): HtmlMeta {
  const headEnd = html.search(/<\/head\s*>/i);
  const head = html.slice(
    0,
    headEnd > 0 ? Math.min(headEnd, HEAD_SCAN_LIMIT) : HEAD_SCAN_LIMIT,
  );
  const values = new Map<string, string>();

  for (const match of head.matchAll(/<meta\b[^>]*>/gi)) {
    const attributes = parseAttributes(match[0]);
    const key = (
      attributes.property ??
      attributes.name ??
      attributes.itemprop ??
      ""
    )
      .trim()
      .toLowerCase();
    const content = attributes.content;
    if (!key || content === undefined) continue;
    const decoded = decodeHtmlEntities(content).trim();
    if (!decoded || values.has(key)) continue;
    values.set(key, decoded);
  }

  const titleMatch = head.match(/<title\b[^>]*>([\s\S]*?)<\/title>/i);
  const title = titleMatch
    ? decodeHtmlEntities(titleMatch[1]).replace(/\s+/g, " ").trim() || undefined
    : undefined;

  return {
    title,
    get: (key) => values.get(key.toLowerCase()),
    first: (...keys) => {
      for (const key of keys) {
        const value = values.get(key.toLowerCase());
        if (value) return value;
      }
      return undefined;
    },
  };
}

/**
 * Resolve a page-relative URL and force https. The app's CSP only allows
 * https images and media, so a plain-http og:image would never load.
 */
export function resolvePreviewAssetUrl(
  rawValue: string | undefined,
  pageUrl: string,
): string | undefined {
  if (!rawValue) return undefined;
  try {
    const resolved = new URL(rawValue.trim(), pageUrl);
    if (resolved.protocol === "http:") resolved.protocol = "https:";
    if (resolved.protocol !== "https:") return undefined;
    return resolved.toString();
  } catch {
    return undefined;
  }
}

export function readPositiveInt(value: string | undefined): number | undefined {
  if (!value) return undefined;
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : undefined;
}
