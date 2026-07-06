// @vitest-environment jsdom

import { render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { VoiceDetailsPanel } from "../VoiceDetailsPanel";

vi.mock("@/hooks/useVoiceStats", () => ({
  useVoiceStats: vi.fn(() => null),
}));

const TRIGGER_RECT = {
  x: 180,
  y: 300,
  left: 180,
  top: 300,
  right: 212,
  bottom: 332,
  width: 32,
  height: 32,
  toJSON: () => ({}),
} as DOMRect;

describe("VoiceDetailsPanel", () => {
  afterEach(() => {
    document.querySelector("[data-testid='voice-details-trigger']")?.remove();
  });

  it("renders in a body portal so it escapes clipped dashboard containers", async () => {
    const trigger = document.createElement("button");
    trigger.dataset.testid = "voice-details-trigger";
    trigger.getBoundingClientRect = () => TRIGGER_RECT;
    document.body.appendChild(trigger);

    const { container } = render(
      <div className="relative overflow-hidden rounded-lg">
        <VoiceDetailsPanel
          sfu={null}
          isOpen
          onClose={() => {}}
          triggerRef={{ current: trigger }}
          channelName="General"
        />
      </div>,
    );

    const panel = await screen.findByLabelText("Voice Details");

    await waitFor(() => {
      expect(panel).toHaveStyle({ left: "180px" });
    });

    expect(container).not.toContainElement(panel);
    expect(document.body).toContainElement(panel);
    expect(panel).toHaveClass("fixed");
  });
});
