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

describe("SharedMessagePage states", () => {
  it("offers a retry for server errors instead of calling the share gone", async () => {
    const { render, screen, fireEvent, waitFor } =
      await import("@testing-library/react");
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(new Response("{}", { status: 500 }))
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ share: makeShare() }), { status: 200 }),
      );
    render(<SharedMessagePage token="share-token" />);
    expect(
      await screen.findByRole("heading", {
        name: "Couldn't load this message",
      }),
    ).toBeInTheDocument();
    expect(screen.queryByText(/gone/)).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    await waitFor(() =>
      expect(screen.getByText("A shared message")).toBeInTheDocument(),
    );
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("shows the gone state with one way forward on 410", async () => {
    const { render, screen } = await import("@testing-library/react");
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response("{}", { status: 410 }),
    );
    render(<SharedMessagePage token="share-token" />);
    expect(
      await screen.findByRole("heading", {
        name: "This shared message is gone",
      }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("link", { name: "Open Ralph Meet" }),
    ).toHaveAttribute("href", "/");
  });
});
