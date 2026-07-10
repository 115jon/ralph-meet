// @vitest-environment jsdom

import { render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { VoiceDetailsPanel } from "../VoiceDetailsPanel";

const useVoiceStatsMock = vi.fn(() => null);

vi.mock("@/hooks/useVoiceStats", () => ({
  useVoiceStats: useVoiceStatsMock,
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
    useVoiceStatsMock.mockReset();
    useVoiceStatsMock.mockReturnValue(null);
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

  it("shows a connected status while live metrics are still warming up", async () => {
    const trigger = document.createElement("button");
    trigger.dataset.testid = "voice-details-trigger";
    trigger.getBoundingClientRect = () => TRIGGER_RECT;
    document.body.appendChild(trigger);

    const sfu = {
      getConnectionState: () => "connected",
      getPublishConnectionState: () => "connected",
      getSubscribeConnectionState: () => "idle",
    } as any;

    render(
      <VoiceDetailsPanel
        sfu={sfu}
        isOpen
        onClose={() => {}}
        triggerRef={{ current: trigger }}
        channelName="General"
      />,
    );

    expect(
      await screen.findByText("Connected · gathering live metrics…"),
    ).toBeInTheDocument();
  });
});
