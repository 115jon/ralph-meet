import { describe, expect, it } from "vitest";

import {
  extractTenorConfigFromHtml,
  normalizeTenorCategory,
  normalizeTenorGifResult,
  parseStoredGifFavorites,
  toggleGifFavorite,
} from "@/lib/gif-picker";

describe("gif-picker helpers", () => {
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
});
