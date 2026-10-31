import type { Author } from "./schema";

/** Display name, else username: how the web names a person. */
export function authorName(
  author: Pick<Author, "username" | "display_name"> | undefined | null,
): string {
  return author?.display_name?.trim() || author?.username || "Unknown";
}
