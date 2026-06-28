import { describe, expect, it } from "vitest";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";

import { TooltipProvider } from "@/components/ui/tooltip";
import { VoiceHeader } from "@/components/voice/VoiceHeader";

describe("VoiceHeader stream watchers", () => {
  it("renders focused watcher identities next to the focused stream label", () => {
    const markup = renderToStaticMarkup(
      React.createElement(
        TooltipProvider,
        null,
        React.createElement(VoiceHeader, {
          channelName: "General",
          connectionState: "connected",
          joined: true,
          focusedItem: {
            type: "screen",
            isLocal: true,
            isStreaming: false,
            name: "You",
            avatar: null,
          },
          focusedWatchers: [
            { userId: "user-2", name: "Bob", avatar: null, isLocal: false },
            { userId: "user-3", name: "Carla", avatar: null, isLocal: false },
          ],
          currentScreenQuality: "hd",
          sfu: null,
          showTextChat: false,
          onToggleTextChat: () => {},
        }),
      ),
    );

    expect(markup).toContain("Your Stream");
    expect(markup).toContain("2 viewers");
    expect(markup).toContain("Bob, Carla");
  });
});
