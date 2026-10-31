// ── oEmbed and YouTube player payloads ───────────────────────────────────────
// The only place the shape of the oEmbed endpoints we call (YouTube, Spotify,
// TikTok) and of YouTube's player response is checked. Fields are tolerant (see
// ./lenient): a missing or retyped field decodes to `undefined`.

import { Option, Schema } from "effect";
import { looseStruct } from "@/lib/schema";
import {
  lenient,
  lenientArray,
  lenientNumber,
  lenientString,
  readCount,
  tolerant,
} from "@/lib/lenient-schema";

/**
 * The oEmbed response (https://oembed.com), as YouTube, Spotify and TikTok send
 * it. Strings are kept verbatim, blank ones included: callers fall back with
 * `||` / `??` exactly as they did on the raw payload.
 */
export const OEmbedResponse = looseStruct({
  type: lenientString,
  title: lenientString,
  author_name: lenientString,
  author_url: lenientString,
  provider_name: lenientString,
  provider_url: lenientString,
  thumbnail_url: lenientString,
  thumbnail_width: lenientNumber,
  thumbnail_height: lenientNumber,
  html: lenientString,
});
export type OEmbedResponse = typeof OEmbedResponse.Type;

// ── YouTube player response ─────────────────────────────────────────────────

/** Width and height as numbers or numeric strings; only positive sizes are usable. */
const dimension = tolerant(Schema.Finite, (value) => {
  const parsed = readCount(value);
  return parsed !== undefined && parsed > 0 ? parsed : undefined;
});

const YouTubeFormat = looseStruct({ width: dimension, height: dimension });

/** The slice of `/youtubei/v1/player` (also `ytInitialPlayerResponse`) we read. */
export const YouTubePlayerResponse = looseStruct({
  streamingData: lenient(
    looseStruct({
      formats: lenientArray(YouTubeFormat),
      adaptiveFormats: lenientArray(YouTubeFormat),
    }),
  ),
});
export type YouTubePlayerResponse = typeof YouTubePlayerResponse.Type;

/**
 * The `pbj=1` watch response: one object with a `playerResponse`, or a list of
 * objects of which one has it.
 */
const YouTubePbjEntry = looseStruct({
  playerResponse: lenient(YouTubePlayerResponse),
});

export const YouTubePbjResponse = Schema.Union([
  YouTubePbjEntry,
  Schema.mutable(Schema.Array(Schema.Unknown)),
]);

const decodePbjEntry = Schema.decodeUnknownOption(YouTubePbjEntry);

/** The player response inside a decoded `pbj=1` body, if any. */
export function readYouTubePbjPlayerResponse(
  body: typeof YouTubePbjResponse.Type,
): YouTubePlayerResponse | undefined {
  const entries = Array.isArray(body) ? body : [body];
  for (const entry of entries) {
    const decoded = decodePbjEntry(entry);
    if (Option.isSome(decoded) && decoded.value.playerResponse) {
      return decoded.value.playerResponse;
    }
  }
  return undefined;
}
