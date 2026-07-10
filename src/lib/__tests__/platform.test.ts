import { describe, expect, it } from "vitest";

import { getAuthAssetUrl } from "../platform";

describe("platform asset urls", () => {
  it("proxies Google user-content avatar urls through proxy-media", () => {
    expect(
      getAuthAssetUrl(
        "https://lh3.googleusercontent.com/a/example-avatar=s96-c",
      ),
    ).toBe(
      "/api/proxy-media?url=https%3A%2F%2Flh3.googleusercontent.com%2Fa%2Fexample-avatar%3Ds96-c",
    );
  });

  it("leaves other external asset urls unchanged", () => {
    expect(getAuthAssetUrl("https://example.com/image.png")).toBe(
      "https://example.com/image.png",
    );
  });
});
