import { describe, expect, it } from "vitest";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";

import { StreamWatcherList } from "@/components/voice/StreamWatcherList";

describe("StreamWatcherList", () => {
  it("renders viewer count and watcher identities", () => {
    const markup = renderToStaticMarkup(
      React.createElement(StreamWatcherList, {
        watchers: [
          { userId: "user-1", name: "Alice", avatar: null, isLocal: false },
          { userId: "user-2", name: "You", avatar: null, isLocal: true },
          { userId: "user-3", name: "Carla", avatar: null, isLocal: false },
        ],
      }),
    );

    expect(markup).toContain("3 viewers");
    expect(markup).toContain("Alice, You and 1 more");
  });

  it("renders nothing when nobody is watching", () => {
    const markup = renderToStaticMarkup(
      React.createElement(StreamWatcherList, {
        watchers: [],
      }),
    );

    expect(markup).toBe("");
  });

  it("caps visible avatars while preserving the real viewer count", () => {
    const markup = renderToStaticMarkup(
      React.createElement(StreamWatcherList, {
        watchers: [
          { userId: "user-1", name: "Alice", avatar: null, isLocal: false },
          { userId: "user-2", name: "Bob", avatar: null, isLocal: false },
          { userId: "user-3", name: "Carla", avatar: null, isLocal: false },
          { userId: "user-4", name: "Derek", avatar: null, isLocal: false },
          { userId: "user-5", name: "Eve", avatar: null, isLocal: false },
          { userId: "user-6", name: "Frank", avatar: null, isLocal: false },
        ],
      }),
    );

    expect(markup).toContain("6 viewers");
    expect(markup).toContain("Alice, Bob and 4 more");
    expect(markup).toContain("+2");
    expect(markup).not.toContain("Eve");
    expect(markup).not.toContain("Frank");
  });
});
