import { describe, expect, it } from "vitest";

import {
  appendUniqueGifPickerItems,
  DEFAULT_GIF_PROVIDER,
  buildTenorCacheKey,
  dedupeGifPickerItems,
  extractTenorConfigFromHtml,
  inferGifPickerMediaType,
  getGifAttachmentProvider,
  getGifProviderSearchPlaceholder,
  getGifProviderLabel,
  normalizeGifPickerContentType,
  normalizeKlipyCategory,
  normalizeKlipyGifResult,
  normalizeTenorCategory,
  normalizeTenorGifResult,
  parseStoredGifFavorites,
  toggleGifFavorite,
} from "@/lib/gif-picker";

describe("gif-picker helpers", () => {
  function makeGif(id: string) {
    return normalizeTenorGifResult({
      id,
      content_description: `gif ${id}`,
      itemurl: `https://tenor.com/view/${id}`,
      media_formats: {
        gif: { url: `https://media1.tenor.com/m/${id}.gif`, dims: [200, 200], size: 1234 },
        tinymp4: { url: `https://media.tenor.com/${id}.mp4`, dims: [100, 100], size: 200 },
      },
    })!;
  }

  function makeKlipyGif(id: string) {
    return normalizeKlipyGifResult({
      id,
      title: `klipy ${id}`,
      media_formats: {
        gif: { url: `https://static.klipy.com/${id}.gif`, dims: [320, 240], size: 1234 },
        tinymp4: { url: `https://static.klipy.com/${id}.mp4`, dims: [160, 120], size: 200 },
      },
    })!;
  }

  it("defaults to KLIPY branding in the picker", () => {
    expect(DEFAULT_GIF_PROVIDER).toBe("klipy");
    expect(getGifProviderLabel("klipy")).toBe("KLIPY");
    expect(getGifProviderLabel("tenor")).toBe("Tenor");
    expect(getGifProviderLabel("external")).toBe("Saved GIF");
    expect(getGifProviderSearchPlaceholder("klipy")).toBe("Search KLIPY");
    expect(getGifProviderSearchPlaceholder("tenor")).toBe("Search Tenor");
    expect(getGifProviderSearchPlaceholder("external")).toBe("Search GIFs");
  });

  it("normalizes a Tenor result into preview and send assets", () => {
    const item = normalizeTenorGifResult({
      id: "123",
      content_description: "goat gif",
      itemurl: "https://tenor.com/view/goat-123",
      media_formats: {
        gif: { url: "https://media1.tenor.com/m/goat.gif", dims: [281, 498], size: 5313885 },
        tinygif: { url: "https://media.tenor.com/goat-small.gif", dims: [165, 294], size: 720402 },
        mp4: { url: "https://media.tenor.com/goat.mp4", dims: [282, 498], size: 206228 },
        tinymp4: { url: "https://media.tenor.com/goat-small.mp4", dims: [180, 320], size: 98103 },
      },
    });

    expect(item).toMatchObject({
      id: "123",
      title: "goat gif",
      altText: "goat gif",
      sourceUrl: "https://tenor.com/view/goat-123",
    });
    expect(item?.preview).toMatchObject({
      url: "https://media.tenor.com/goat-small.mp4",
      contentType: "video/mp4",
    });
    expect(item?.send).toMatchObject({
      url: "https://media1.tenor.com/m/goat.gif",
      contentType: "image/gif",
    });
  });

  it("normalizes a KLIPY result into preview and send assets", () => {
    const item = normalizeKlipyGifResult({
      id: "4551195970372378",
      title: "Greetings: Man Waving Hello",
      media_formats: {
        gif: { url: "https://static.klipy.com/full.gif", dims: [498, 498], size: 2614179 },
        mediumgif: { url: "https://static.klipy.com/medium.gif", dims: [640, 640], size: 873745 },
        tinygif: { url: "https://static.klipy.com/tiny.gif", dims: [220, 220], size: 149153 },
        mp4: { url: "https://static.klipy.com/full.mp4", dims: [498, 498], size: 91000 },
        tinymp4: { url: "https://static.klipy.com/tiny.mp4", dims: [160, 160], size: 18000 },
      },
    });

    expect(item).toMatchObject({
      id: "4551195970372378",
      title: "Greetings: Man Waving Hello",
      provider: "klipy",
      sourceUrl: "https://static.klipy.com/full.gif",
    });
    expect(item?.preview).toMatchObject({
      url: "https://static.klipy.com/tiny.mp4",
      contentType: "video/mp4",
    });
    expect(item?.send).toMatchObject({
      url: "https://static.klipy.com/full.gif",
      contentType: "image/gif",
    });
  });

  it("normalizes Tenor categories for UI tiles", () => {
    expect(normalizeTenorCategory({
      id: "abc",
      searchterm: "angry",
      image: "https://media.tenor.com/angry.gif",
    })).toEqual({
      id: "abc",
      label: "angry",
      query: "angry",
      imageUrl: "https://media.tenor.com/angry.gif",
    });
  });

  it("normalizes KLIPY categories for UI tiles", () => {
    expect(normalizeKlipyCategory({
      id: "abc",
      searchterm: "hello",
      image: "https://static.klipy.com/hello.gif",
    })).toEqual({
      id: "abc",
      label: "hello",
      query: "hello",
      imageUrl: "https://static.klipy.com/hello.gif",
    });
  });

  it("toggles favorites by id and preserves newest first ordering", () => {
    const first = normalizeTenorGifResult({
      id: "1",
      content_description: "first",
      itemurl: "https://tenor.com/view/1",
      media_formats: {
        gif: { url: "https://media1.tenor.com/m/1.gif", dims: [200, 200], size: 1234 },
        tinymp4: { url: "https://media.tenor.com/1.mp4", dims: [100, 100], size: 200 },
      },
    })!;
    const second = normalizeTenorGifResult({
      id: "2",
      content_description: "second",
      itemurl: "https://tenor.com/view/2",
      media_formats: {
        gif: { url: "https://media1.tenor.com/m/2.gif", dims: [200, 200], size: 1234 },
        tinymp4: { url: "https://media.tenor.com/2.mp4", dims: [100, 100], size: 200 },
      },
    })!;

    const addedFirst = toggleGifFavorite([], first);
    const addedSecond = toggleGifFavorite(addedFirst, second);
    const removedSecond = toggleGifFavorite(addedSecond, second);

    expect(addedSecond.map((item) => item.id)).toEqual(["2", "1"]);
    expect(removedSecond.map((item) => item.id)).toEqual(["1"]);
  });

  it("parses stored favorites safely", () => {
    expect(parseStoredGifFavorites("not json")).toEqual([]);
    expect(parseStoredGifFavorites(JSON.stringify([{ id: "1", preview: { url: "a" }, send: { url: "b" } }]))).toHaveLength(1);

    const parsed = parseStoredGifFavorites(JSON.stringify([
      { id: "gif-1", preview: { url: "https://static.klipy.com/gif-1.gif", contentType: "image/gif" }, send: { url: "https://static.klipy.com/gif-1.gif", contentType: "image/gif" } },
      { id: "sticker-1", preview: { url: "https://static.klipy.com/stickers/sticker-1.png", contentType: "image/png" }, send: { url: "https://static.klipy.com/stickers/sticker-1.png", contentType: "image/png" } },
      { id: "clip-1", preview: { url: "https://static.klipy.com/clips/clip-1.mp4", contentType: "video/mp4" }, send: { url: "https://static.klipy.com/clips/clip-1.mp4", contentType: "video/mp4" }, duration: 5 },
      { id: "meme-1", preview: { url: "https://static.klipy.com/static-memes/meme-1.png", contentType: "image/png" }, send: { url: "https://static.klipy.com/static-memes/meme-1.png", contentType: "image/png" } }
    ]));

    expect(parsed[0].mediaType).toBe("gifs");
    expect(parsed[1].mediaType).toBe("stickers");
    expect(parsed[2].mediaType).toBe("clips");
    expect(parsed[3].mediaType).toBe("memes");
  });

  it("normalizes static image content types and infers meme URLs without hijacking generic pngs", () => {
    expect(normalizeGifPickerContentType("image/png; charset=binary")).toBe("image/png");

    expect(inferGifPickerMediaType({
      id: "meme-asset",
      sourceUrl: "https://static.klipy.com/static-memes/meme-asset.png",
      preview: { url: "https://static.klipy.com/static-memes/meme-asset.png", contentType: "image/png" },
      send: { url: "https://static.klipy.com/static-memes/meme-asset.png", contentType: "image/png" },
    })).toBe("memes");

    expect(inferGifPickerMediaType({
      id: "plain-image",
      sourceUrl: "https://cdn.example.com/plain-image.png",
      preview: { url: "https://cdn.example.com/plain-image.png", contentType: "image/png" },
      send: { url: "https://cdn.example.com/plain-image.png", contentType: "image/png" },
    })).toBe("gifs");
  });

  it("extracts Tenor config from the bootstrap cache script", () => {
    const config = {
      API_V2_KEY: "public-web-key",
      API_V2_URL: "https://tenor.googleapis.com/v2",
      API_V2_CLIENT_KEY: "tenor_web",
    };
    const encoded = Buffer.from(JSON.stringify(config), "utf8").toString("base64");
    const html = `<html><script nonce="abc" type="text/x-cache" id="data">${encoded}</script></html>`;

    expect(extractTenorConfigFromHtml(html)).toEqual(config);
  });

  it("builds stable Tenor cache keys for equivalent params", () => {
    expect(buildTenorCacheKey("/search", { q: "goat", limit: 24, pos: "abc" })).toBe(
      buildTenorCacheKey("/search", { pos: "abc", limit: 24, q: "goat" })
    );
  });

  it("dedupes GIF results by id while preserving first-seen order", () => {
    expect(dedupeGifPickerItems([makeGif("1"), makeGif("2"), makeGif("1")]).map((item) => item.id)).toEqual(["1", "2"]);
    expect(appendUniqueGifPickerItems([makeGif("1"), makeGif("2")], [makeGif("2"), makeGif("3")]).map((item) => item.id)).toEqual(["1", "2", "3"]);
  });

  it("treats same ids from different providers as distinct GIFs", () => {
    expect(dedupeGifPickerItems([makeGif("1"), makeKlipyGif("1")]).map((item) => item.provider)).toEqual(["tenor", "klipy"]);
  });

  it("detects GIF providers from attachment paths", () => {
    expect(getGifAttachmentProvider("attachments/channel/attachment/gifs/klipy/test.gif")).toBe("klipy");
    expect(getGifAttachmentProvider("/api/attachments/channel/attachment/gifs/tenor/test.gif")).toBe("tenor");
    expect(getGifAttachmentProvider("https://static.klipy.com/test.gif")).toBe("klipy");
    expect(getGifAttachmentProvider("https://static1.klipy.com/test.mp4")).toBe("klipy");
    expect(getGifAttachmentProvider("https://media.tenor.com/test.gif")).toBe("tenor");
    expect(getGifAttachmentProvider("https://gif.fxtwitter.com/tweet_video/test.webp")).toBe("external");
    expect(getGifAttachmentProvider("/api/proxy-media?url=https%3A%2F%2Fmedia.tenor.com%2Ftest.gif")).toBe("tenor");
    expect(getGifAttachmentProvider("/api/proxy-media?url=https%3A%2F%2Fgif.fxtwitter.com%2Ftweet_video%2Ftest.webp")).toBe("external");
    expect(getGifAttachmentProvider("attachments/channel/attachment/test.gif")).toBeNull();
    expect(getGifAttachmentProvider("https://cdn.example.com/test.gif")).toBeNull();
  });
});
