// ── Instagram payloads ───────────────────────────────────────────────────────
// The only place the shape of Instagram's oEmbed endpoint, its private
// `media/.../info` API and our own `/api/instagram-video` response is checked.
// Fields are tolerant (see @/lib/lenient-schema): a missing or retyped field decodes to
// `undefined`, so the mapping code in share-preview-proxy and
// instagram-video-resolver reads typed values and never probes.

import { Schema } from "effect";
import { looseStruct } from "@/lib/schema";
import {
  lenient,
  lenientArray,
  lenientBoolean,
  lenientNumber,
  lenientString,
} from "@/lib/lenient-schema";

// ── oEmbed ──────────────────────────────────────────────────────────────────

/** `GET https://www.instagram.com/api/v1/oembed/`. */
export const InstagramOEmbedResponse = looseStruct({
  media_id: lenientString,
  title: lenientString,
  author_name: lenientString,
  author_url: lenientString,
  provider_name: lenientString,
  provider_url: lenientString,
  thumbnail_url: lenientString,
  thumbnail_width: lenientNumber,
  thumbnail_height: lenientNumber,
});
export type InstagramOEmbedResponse = typeof InstagramOEmbedResponse.Type;

// ── our /api/instagram-video response ───────────────────────────────────────

const VideoApiMedia = looseStruct({
  type: Schema.Literals(["image", "video"]),
  url: Schema.String,
  width: lenientNumber,
  height: lenientNumber,
  thumbnailUrl: lenientString,
  contentType: lenientString,
  altText: lenientString,
  durationSeconds: lenientNumber,
});

export const InstagramVideoApiResponse = looseStruct({
  videoUrl: lenientString,
  thumbnailUrl: lenientString,
  title: lenientString,
  durationSeconds: lenientNumber,
  media: lenientArray(VideoApiMedia),
  authorName: lenientString,
  authorUrl: lenientString,
  authorAvatarUrl: lenientString,
  authorVerified: lenientBoolean,
  likeCount: lenientNumber,
  commentCount: lenientNumber,
  viewCount: lenientNumber,
  timestamp: lenientString,
  audio: lenient(
    looseStruct({
      title: lenientString,
      artist: lenientString,
      url: lenientString,
      artworkUrl: lenientString,
    }),
  ),
});
export type InstagramVideoApiResponse = typeof InstagramVideoApiResponse.Type;

// ── private media info API ──────────────────────────────────────────────────

const ImageCandidate = looseStruct({
  url: Schema.String,
  width: lenientNumber,
  height: lenientNumber,
});
export type InstagramImageCandidate = typeof ImageCandidate.Type;

/** The fields every media node has: a post, or one slide of a carousel. */
const MediaNodeFields = {
  image_versions2: lenient(
    looseStruct({ candidates: lenientArray(ImageCandidate) }),
  ),
  video_versions: lenientArray(ImageCandidate),
  video_dash_manifest: lenientString,
  accessibility_caption: lenientString,
  video_duration: lenientNumber,
} as const;

const MusicAsset = looseStruct({
  title: lenientString,
  track_title: lenientString,
  display_artist: lenientString,
  artist_name: lenientString,
  progressive_download_url: lenientString,
  url: lenientString,
  cover_artwork_uri: lenientString,
  cover_artwork_thumbnail_uri: lenientString,
});

const MusicInfo = looseStruct({ music_asset_info: lenient(MusicAsset) });

/** Unix seconds as a number, or a string holding seconds or a date. */
const timestamp = lenient(Schema.Union([Schema.Finite, Schema.String]));

export const InstagramMediaItem = looseStruct({
  ...MediaNodeFields,
  carousel_media: lenientArray(looseStruct(MediaNodeFields)),
  user: lenient(
    looseStruct({
      username: lenientString,
      full_name: lenientString,
      profile_pic_url: lenientString,
      is_verified: lenientBoolean,
    }),
  ),
  caption: lenient(looseStruct({ text: lenientString })),
  like_count: lenientNumber,
  comment_count: lenientNumber,
  view_count: lenientNumber,
  play_count: lenientNumber,
  taken_at: timestamp,
  clips_metadata: lenient(looseStruct({ music_info: lenient(MusicInfo) })),
  music_metadata: lenient(
    looseStruct({
      music_info: lenient(MusicInfo),
      music_asset: lenient(MusicAsset),
    }),
  ),
});
export type InstagramMediaItem = typeof InstagramMediaItem.Type;
export type InstagramMediaNode = Pick<
  InstagramMediaItem,
  keyof typeof MediaNodeFields
>;

/** `GET .../media/<pk>/info/` and `.../media/shortcode/<code>/info/`. */
export const InstagramMediaInfoResponse = looseStruct({
  items: lenientArray(InstagramMediaItem),
});
export type InstagramMediaInfoResponse = typeof InstagramMediaInfoResponse.Type;

// ── legacy GraphQL payload ──────────────────────────────────────────────────

/** `data.xdt_shortcode_media` of the web GraphQL response. */
export const InstagramGraphqlResponse = looseStruct({
  data: lenient(
    looseStruct({
      xdt_shortcode_media: lenient(
        looseStruct({
          video_url: lenientString,
          display_url: lenientString,
          video_duration: lenientNumber,
          edge_media_to_caption: lenient(
            looseStruct({
              edges: lenientArray(
                looseStruct({
                  node: lenient(looseStruct({ text: lenientString })),
                }),
              ),
            }),
          ),
        }),
      ),
    }),
  ),
});
export type InstagramGraphqlResponse = typeof InstagramGraphqlResponse.Type;
