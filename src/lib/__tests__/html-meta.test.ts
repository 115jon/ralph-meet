import { describe, expect, it } from "vitest";
import {
  decodeHtmlEntities,
  parseHtmlMeta,
  resolvePreviewAssetUrl,
} from "../html-meta";

describe("parseHtmlMeta", () => {
  it("reads meta tags whatever the attribute order and quoting", () => {
    const meta = parseHtmlMeta(`
      <html><head>
        <meta content="Content first" property="og:title">
        <meta property='og:description' content='Single quoted'>
        <meta name=twitter:card content=summary_large_image>
        <meta itemprop="image" content="/img.png">
        <title>  Fallback   title </title>
      </head><body><meta property="og:title" content="body tag"></body></html>
    `);
    expect(meta.get("og:title")).toBe("Content first");
    expect(meta.get("OG:DESCRIPTION")).toBe("Single quoted");
    expect(meta.get("twitter:card")).toBe("summary_large_image");
    expect(meta.get("image")).toBe("/img.png");
    expect(meta.title).toBe("Fallback title");
  });

  it("keeps the first value and skips empty ones", () => {
    const meta = parseHtmlMeta(`
      <meta property="og:image" content="">
      <meta property="og:image" content="https://a.test/1.png">
      <meta property="og:image" content="https://a.test/2.png">
    `);
    expect(meta.get("og:image")).toBe("https://a.test/1.png");
    expect(meta.first("og:image:secure_url", "og:image")).toBe(
      "https://a.test/1.png",
    );
  });

  it("decodes entities in content and titles", () => {
    const meta = parseHtmlMeta(
      `<meta property="og:title" content="Tom &amp; Jerry &#8212; &quot;live&quot; &#x1F600;"><title>A &lt;b&gt;</title>`,
    );
    expect(meta.get("og:title")).toBe('Tom & Jerry — "live" 😀');
    expect(meta.title).toBe("A <b>");
  });
});

describe("decodeHtmlEntities", () => {
  it("leaves unknown entities alone", () => {
    expect(decodeHtmlEntities("a &bogus; b &amp; c")).toBe("a &bogus; b & c");
  });
});

describe("resolvePreviewAssetUrl", () => {
  it("resolves relative URLs against the page and forces https", () => {
    expect(resolvePreviewAssetUrl("/og.png", "https://news.test/a/b?c=1")).toBe(
      "https://news.test/og.png",
    );
    expect(
      resolvePreviewAssetUrl("//cdn.test/x.jpg", "https://news.test/"),
    ).toBe("https://cdn.test/x.jpg");
    expect(
      resolvePreviewAssetUrl("http://cdn.test/x.jpg", "https://news.test/"),
    ).toBe("https://cdn.test/x.jpg");
  });

  it("rejects non-web schemes", () => {
    expect(
      resolvePreviewAssetUrl("data:image/png;base64,AAAA", "https://a.test/"),
    ).toBeUndefined();
    expect(
      resolvePreviewAssetUrl("javascript:alert(1)", "https://a.test/"),
    ).toBeUndefined();
    expect(
      resolvePreviewAssetUrl(undefined, "https://a.test/"),
    ).toBeUndefined();
  });
});
