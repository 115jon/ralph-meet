// @vitest-environment jsdom

import { renderToString } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import SharedMessagePage, { type PublicShare } from "../SharedMessagePage";

const EXPIRES_AT = "2024-03-05T14:06:07.000Z";

function makeShare(): PublicShare {
  return {
    token: "share-token",
    expires_at: EXPIRES_AT,
    allow_indexing: false,
    original_edited: false,
    snapshot: {
      content: "A shared message",
      author: {
        username: "alice",
        display_name: "Alice",
        avatar_url: null,
      },
      attachments: [],
      omitted_attachment_count: 0,
      embeds: [],
      reactions: [],
      reply_count: 0,
      created_at: EXPIRES_AT,
    },
  };
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("SharedMessagePage", () => {
  it("renders expiration dates during SSR without Date.toLocaleString", () => {
    vi.spyOn(Date.prototype, "toLocaleString").mockImplementation(() => {
      throw new Error("Date.toLocaleString must not run during SSR");
    });

    const markup = renderToString(
      <SharedMessagePage token="share-token" initialShare={makeShare()} />,
    );

    const expected = new Intl.DateTimeFormat("en-US", {
      month: "short",
      day: "numeric",
      year: "numeric",
      hour: "numeric",
      minute: "2-digit",
      timeZone: "UTC",
    }).format(new Date(EXPIRES_AT));

    expect(markup).toContain(`Expires ${expected}`);
  });
});
