// ── TikTok payloads ──────────────────────────────────────────────────────────
// The only place the shape of TikTok's player API and the tikwm proxy API is
// checked. Both are third-party JSON that drifts, so every field is tolerant:
// a missing or retyped field decodes to `undefined` and the mapping code in
// share-preview-proxy never needs to probe.

import { Option, Schema } from "effect";
import { looseStruct } from "@/lib/schema";
import {
  lenient,
  lenientArray,
  lenientCount,
  lenientNumber,
  lenientStrings,
  lenientText,
  readCount,
  tolerant,
} from "@/lib/lenient-schema";

// ── Player API ──────────────────────────────────────────────────────────────

/** Image or video reference. TikTok sends it as `{ url_list, width, height }` or as a bare list. */
export interface TikTokUrlRef {
  readonly urls: ReadonlyArray<string>;
  readonly width?: number;
  readonly height?: number;
}

const UrlRefSchema = Schema.Struct({
  urls: Schema.Array(Schema.String),
  width: Schema.optional(Schema.Finite),
  height: Schema.optional(Schema.Finite),
});

const decodeUrlRefObject = Schema.decodeUnknownOption(
  looseStruct({
    url_list: lenientStrings,
    width: lenientCount,
    height: lenientCount,
  }),
);

function readUrlRef(value: unknown): TikTokUrlRef | undefined {
  if (Array.isArray(value)) {
    return { urls: value.filter(isNonBlankString) };
  }

  const decoded = decodeUrlRefObject(value);
  if (Option.isNone(decoded)) return undefined;
  const { url_list, width, height } = decoded.value;
  return { urls: url_list ?? [], width, height };
}

function isNonBlankString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

const urlRef = tolerant(UrlRefSchema, readUrlRef);

/** A post id: TikTok sends `id_str` as a string and `id` as a number. */
const lenientId = tolerant(Schema.String, (value) =>
  typeof value === "string" || typeof value === "number"
    ? String(value)
    : undefined,
);

const lenientIds = tolerant(Schema.Array(Schema.String), (value) =>
  Array.isArray(value) ? value.map(String) : undefined,
);

const PlayerImage = looseStruct({
  display_image: urlRef,
  owner_watermark_image: urlRef,
  thumbnail: urlRef,
});

export const TikTokPlayerItem = looseStruct({
  id_str: lenientText,
  id: lenientNumber,
  desc: lenientText,
  author_info: lenient(
    looseStruct({
      unique_id: lenientText,
      nickname: lenientText,
      avatar_url_list: urlRef,
    }),
  ),
  statistics_info: lenient(
    looseStruct({
      digg_count: lenientCount,
      comment_count: lenientCount,
      play_count: lenientCount,
      share_count: lenientCount,
    }),
  ),
  video_info: lenient(
    looseStruct({
      origin_cover: urlRef,
      cover: urlRef,
      profiles: lenientArray(looseStruct({ play_addr: urlRef })),
      url_list: urlRef,
      meta: lenient(
        looseStruct({
          duration: lenientCount,
          width: lenientCount,
          height: lenientCount,
        }),
      ),
    }),
  ),
  image_post_info: lenient(
    looseStruct({
      images: lenientArray(PlayerImage),
      cover: lenient(PlayerImage),
    }),
  ),
  music_info: lenient(looseStruct({ title: lenientText, author: lenientText })),
});
export type TikTokPlayerItem = typeof TikTokPlayerItem.Type;

/**
 * `GET /player/api/v1/items`. A live post answers with `items`; a deleted,
 * private or region-removed one answers with `results: [{ code: "nil_core_data" }]`
 * or lists the id in `extra.fatal_item_ids`.
 */
export const TikTokPlayerApiResponse = looseStruct({
  items: lenientArray(TikTokPlayerItem),
  extra: lenient(looseStruct({ fatal_item_ids: lenientIds })),
  results: lenientArray(
    looseStruct({
      id_str: lenientId,
      id: lenientId,
      code: lenient(Schema.String),
    }),
  ),
});
export type TikTokPlayerApiResponse = typeof TikTokPlayerApiResponse.Type;

// ── tikwm proxy API ─────────────────────────────────────────────────────────

function readIsoTimestamp(value: unknown): string | undefined {
  const seconds = readCount(value);
  const date =
    seconds !== undefined
      ? new Date(seconds * 1000)
      : typeof value === "string" && value.trim()
        ? new Date(value)
        : undefined;
  return date && !Number.isNaN(date.getTime()) ? date.toISOString() : undefined;
}

export const TikwmData = looseStruct({
  id: lenientText,
  title: lenientText,
  content_desc: lenientStrings,
  images: lenientStrings,
  live_images: lenientStrings,
  hdplay: lenientText,
  play: lenientText,
  wmplay: lenientText,
  music: lenientText,
  cover: lenientText,
  origin_cover: lenientText,
  ai_dynamic_cover: lenientText,
  duration: lenientCount,
  music_info: lenient(
    looseStruct({
      play: lenientText,
      title: lenientText,
      author: lenientText,
      cover: lenientText,
    }),
  ),
  author: lenient(
    looseStruct({
      unique_id: lenientText,
      nickname: lenientText,
      avatar: lenientText,
    }),
  ),
  digg_count: lenientCount,
  comment_count: lenientCount,
  play_count: lenientCount,
  share_count: lenientCount,
  /** Decoded to an ISO timestamp. Unix seconds, as a number or numeric string; some mirrors send a date string. */
  create_time: tolerant(Schema.String, readIsoTimestamp),
});
export type TikwmData = typeof TikwmData.Type;

/** `code: 0` carries `data`; any other code is tikwm's "parsing failed". */
export const TikwmResponse = looseStruct({
  code: lenientNumber,
  data: lenient(TikwmData),
});
export type TikwmResponse = typeof TikwmResponse.Type;
