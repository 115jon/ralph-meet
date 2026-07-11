// @vitest-environment jsdom

import { render } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { VoiceHeader } from "@/components/voice/VoiceHeader";
import { TooltipProvider } from "@/components/ui/tooltip";

vi.mock("@/hooks/useNativeShareStats", () => ({
  useNativeShareStats: () => ({ data: null, stale: false }),
}));

describe("VoiceHeader DOM behavior", () => {
  it("mounts the connected chat tooltip without entering an update loop", () => {
    const { getByRole } = render(
      <TooltipProvider>
        <VoiceHeader
          channelName="General"
          connectionState="connected"
          joined={true}
          focusedItem={null}
          currentScreenQuality="720p30"
          sfu={null}
          showTextChat={false}
          onToggleTextChat={() => {}}
        />
      </TooltipProvider>,
    );

    expect(getByRole("button")).toBeTruthy();
  });
});
