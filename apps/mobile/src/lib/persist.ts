import { Option, Schema } from "effect";
import { AppState } from "react-native";

import { fileSystem as fs } from "./file-system";

// Small app state that should survive a restart (the open conversation,
// drafts): one JSON file each under the app's document directory. Reads are
// synchronous so a store can start from its saved value on the first frame;
// writes are coalesced and flushed when the app goes behind. Not for secrets:
// those stay in SecureStore.

const WRITE_DELAY_MS = 400;
const pending = new Map<string, string | null>();
let timer: ReturnType<typeof setTimeout> | null = null;

function fileFor(name: string) {
  if (!fs) return null;
  return new fs.File(fs.Paths.document, `state-${name}.json`);
}

function flush(): void {
  if (timer) clearTimeout(timer);
  timer = null;
  for (const [name, json] of pending) {
    try {
      const file = fileFor(name);
      if (!file) continue;
      if (json === null) {
        if (file.exists) file.delete();
      } else {
        if (!file.exists) file.create();
        file.writeSync(json);
      }
    } catch {
      // Losing a draft to a full disk is not worth a crash.
    }
  }
  pending.clear();
}

AppState.addEventListener("change", (state) => {
  if (state !== "active") flush();
});

/** The saved value of `name`, or null when there is none or it no longer decodes. */
export function readPersisted<A, I>(
  name: string,
  schema: Schema.Codec<A, I>,
): A | null {
  try {
    const file = fileFor(name);
    if (!file?.exists) return null;
    const json: unknown = JSON.parse(file.textSync());
    return Option.getOrNull(Schema.decodeUnknownOption(schema)(json));
  } catch {
    return null;
  }
}

/** Saves `value` (null deletes it) shortly, or at once when the app goes behind. */
export function writePersisted(name: string, value: unknown): void {
  pending.set(name, value === null ? null : JSON.stringify(value));
  timer ??= setTimeout(flush, WRITE_DELAY_MS);
}
