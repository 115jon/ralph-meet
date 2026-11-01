export interface Selection {
  readonly start: number;
  readonly end: number;
}

/**
 * `value` typed over the selection in `text`, as a keyboard would: it
 * replaces what is selected and the caret lands after it. A selection
 * outside the text (a stale one) clamps to the end.
 */
export interface Inserted {
  readonly text: string;
  readonly cursor: number;
}

export function insertAt(
  text: string,
  selection: Selection,
  value: string,
): Inserted {
  const start = Math.min(Math.max(0, selection.start), text.length);
  const end = Math.min(Math.max(start, selection.end), text.length);
  return {
    text: text.slice(0, start) + value + text.slice(end),
    cursor: start + value.length,
  };
}
