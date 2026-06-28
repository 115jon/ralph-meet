import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { VoiceStreamHoverCard } from "../VoiceStreamHoverCard";

describe("VoiceStreamHoverCard", () => {
  it("renders the live placeholder card for remote streams without a thumbnail", () => {
    const markup = renderToStaticMarkup(
      <VoiceStreamHoverCard
        displayName="Ala"
        thumbnailUrl={null}
      />,
    );

    expect(markup).toContain("Streaming now");
    expect(markup).toContain("LIVE");
    expect(markup).toContain("Watch Stream");
    expect(markup).toContain("Preview syncing now. A fresh frame should appear in a moment.");
  });

  it("renders the current-user state with the streaming label and thumbnail", () => {
    const markup = renderToStaticMarkup(
      <VoiceStreamHoverCard
        displayName="Jon"
        thumbnailUrl="data:image/png;base64,abc"
        isCurrentUser
        onWatchStream={() => {}}
      />,
    );

    expect(markup).toContain("Open Stream");
    expect(markup).toContain("data:image/png;base64,abc");
    expect(markup).not.toContain("aria-disabled=\"true\"");
    expect(markup).not.toContain("disabled=\"\"");
  });
});
