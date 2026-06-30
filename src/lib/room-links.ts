export function buildRoomLink(
  slug: string,
  origin = typeof window !== "undefined" ? window.location.origin : "",
) {
  const base = origin.replace(/\/$/, "");
  const path = `/room/${encodeURIComponent(slug)}`;
  return base ? `${base}${path}` : path;
}

type ClipboardLike = {
  writeText: (value: string) => Promise<void>;
};

export async function copyRoomLink(
  slug: string,
  options: {
    origin?: string;
    clipboard?: ClipboardLike;
  } = {},
) {
  const clipboard = options.clipboard ?? navigator.clipboard;
  const link = buildRoomLink(slug, options.origin);
  await clipboard.writeText(link);
  return link;
}
