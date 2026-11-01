// Live TikTok responses captured on 2026-11-01, scrubbed: signature, token
// and expiry query values are REDACTED, path-embedded signatures zeroed, and
// pages cut down to the `webapp.video-detail` scope.
//
//   - 6718335390845095173 (@scout2015): a public video.
//   - 7691175039722425630 (@ugnewwave): alive but "content classified"
//     (age/sensitivity gated). Logged out, the player API answers
//     nil_core_data, the page an item stripped to its id, the official player
//     "Video currently unavailable"; tikwm still has it.
//   - 6718335390845095999: an id that never existed.
import oembed from "./tiktok-oembed-2026-11.json";
import playerItems from "./tiktok-player-items.json";
import playerNilCoreData from "./tiktok-player-nil-core-data.json";
import tikwmContentClassified from "./tikwm-content-classified.json";
import pageContentClassified from "./tiktok-page-content-classified.html?raw";
import pageGone from "./tiktok-page-gone.html?raw";
import pageLive from "./tiktok-page-live.html?raw";

export const TIKTOK_FIXTURES = {
  oembed,
  playerItems,
  playerNilCoreData,
  tikwmContentClassified,
  pageContentClassified,
  pageGone,
  pageLive,
} as const;

export const CLASSIFIED_ID = "7691175039722425630";
export const CLASSIFIED_URL = `https://www.tiktok.com/@ugnewwave/video/${CLASSIFIED_ID}`;
export const CLASSIFIED_SHORT_URL = "https://www.tiktok.com/t/ZTy59e3EJ/";
export const LIVE_ID = "6718335390845095173";
export const LIVE_URL = `https://www.tiktok.com/@scout2015/video/${LIVE_ID}`;
export const GONE_ID = "6718335390845095999";
export const GONE_URL = `https://www.tiktok.com/@scout2015/video/${GONE_ID}`;

export function htmlResponse(body: string, status = 200): Response {
  return new Response(body, {
    status,
    headers: { "Content-Type": "text/html; charset=utf-8" },
  });
}

/** A JSON body cloned per call, so a test can hand it out more than once. */
export function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8" },
  });
}
