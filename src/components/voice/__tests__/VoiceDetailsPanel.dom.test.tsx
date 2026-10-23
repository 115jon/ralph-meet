// @vitest-environment jsdom

import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { useRef, useState } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { executeBackHandlers } from "@/hooks/useBackButton";

import { VoiceDetailsPanel } from "../VoiceDetailsPanel";

const { useVoiceStatsMock } = vi.hoisted(() => ({
  useVoiceStatsMock: vi.fn(() => null),
}));

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

  it("renders in a body portal popover so it escapes clipped dashboard containers", async () => {
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

    const panel = await screen.findByRole("dialog", { name: "Voice details" });

    expect(container).not.toContainElement(panel);
    expect(document.body).toContainElement(panel);
    expect(panel.closest("[data-rm-floating-layer]")).not.toBeNull();
    expect(panel.closest("[data-rm-floating-layer] > *")?.className).toContain(
      "z-50",
    );
  });

  it("closes on Escape and back, and returns focus to the trigger", async () => {
    const onClose = vi.fn();
    function Host() {
      const [open, setOpen] = useState(false);
      const triggerRef = useRef<HTMLButtonElement>(null);
      return (
        <>
          <button
            type="button"
            ref={triggerRef}
            onClick={() => setOpen((value) => !value)}
          >
            Voice connection details
          </button>
          <VoiceDetailsPanel
            sfu={null}
            isOpen={open}
            onClose={() => {
              onClose();
              setOpen(false);
            }}
            triggerRef={triggerRef}
            channelName="General"
          />
        </>
      );
    }
    render(<Host />);
    const trigger = screen.getByRole("button", {
      name: "Voice connection details",
    });

    trigger.focus();
    fireEvent.click(trigger);
    const panel = await screen.findByRole("dialog", { name: "Voice details" });
    fireEvent.keyDown(panel, { key: "Escape" });
    expect(onClose).toHaveBeenCalledTimes(1);
    await waitFor(() =>
      expect(
        screen.queryByRole("dialog", { name: "Voice details" }),
      ).not.toBeInTheDocument(),
    );
    await waitFor(() => expect(document.activeElement).toBe(trigger));

    fireEvent.click(trigger);
    await screen.findByRole("dialog", { name: "Voice details" });
    act(() => {
      executeBackHandlers();
    });
    expect(onClose).toHaveBeenCalledTimes(2);
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
