import { authorName } from "./authors";
import type { Author } from "./schema";

export interface MentionQuery {
  /** Where the "@" sits in the text. */
  readonly start: number;
  /** What follows it up to the cursor. */
  readonly text: string;
}

// An "@" at the start or after a non-word character, then word characters up
// to the cursor: the shape content.ts reads back as a mention.
const OPEN_MENTION = /(^|[^\w@])@(\w*)$/;

/** The "@name" being typed at `cursor`, if any. */
export function mentionQueryAt(
  text: string,
  cursor: number,
): MentionQuery | null {
  const match = OPEN_MENTION.exec(text.slice(0, cursor));
  if (!match) return null;
  const typed = match[2] ?? "";
  return { start: cursor - typed.length - 1, text: typed };
}

const LIMIT = 5;

/** People whose username or display name starts with the query. */
export function suggestPeople(
  people: readonly Author[],
  query: string,
  excludeId: string | undefined,
): Author[] {
  const q = query.toLowerCase();
  return people
    .filter(
      (person) =>
        person.id !== excludeId &&
        (person.username.toLowerCase().startsWith(q) ||
          authorName(person).toLowerCase().startsWith(q)),
    )
    .slice(0, LIMIT);
}

export interface MentionEdit {
  readonly text: string;
  /** Just after the inserted mention and its space. */
  readonly cursor: number;
}

/** `text` with the open mention replaced by "@username ". */
export function insertMention(
  text: string,
  query: MentionQuery,
  person: Author,
): MentionEdit {
  const end = query.start + 1 + query.text.length;
  const inserted = `@${person.username} `;
  return {
    text: text.slice(0, query.start) + inserted + text.slice(end),
    cursor: query.start + inserted.length,
  };
}
