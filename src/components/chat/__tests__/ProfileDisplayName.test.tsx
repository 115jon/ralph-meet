import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import { ProfileDisplayName } from "../ProfileDisplayName";

vi.mock("@/hooks/useCustomEmojiLookup", () => ({
  useCustomEmojiLookup: (ids: string[]) =>
    ids.includes("emoji-123")
      ? {
          "emoji-123": {
            image_url: "/api/emojis/assets/emoji-123",
          },
        }
      : {},
}));

describe("ProfileDisplayName", () => {
  it("renders emoji in display names through the shared emoji renderer", () => {
    const markup = renderToStaticMarkup(
      <ProfileDisplayName text="Builder <:party_blob:emoji-123>" />,
    );

    expect(markup).toContain("/api/emojis/assets/emoji-123");
    expect(markup).not.toContain("&lt;:party_blob:emoji-123&gt;");
  });
});
