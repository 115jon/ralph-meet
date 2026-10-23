// @vitest-environment jsdom

import { fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { DEFAULT_SHARED_SPATIAL_STATE } from "@/lib/voice/spatial-audio";
import { SpatialAudioPanel } from "../SpatialAudioPanel";

const ANCHOR_RECT = {
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

describe("SpatialAudioPanel", () => {
  afterEach(() => {
    document.querySelector("[data-testid='spatial-audio-trigger']")?.remove();
  });

  it("renders in a body portal so it escapes clipped dashboard containers", async () => {
    const trigger = document.createElement("button");
    trigger.dataset.testid = "spatial-audio-trigger";
    trigger.getBoundingClientRect = () => ANCHOR_RECT;
    document.body.appendChild(trigger);

    const { container } = render(
      <div className="relative overflow-hidden rounded-lg">
        <SpatialAudioPanel
          isOpen
          anchorRef={{ current: trigger }}
          gridItems={[]}
          spatialAudioState={DEFAULT_SHARED_SPATIAL_STATE}
          onUpdateSpatialAudioState={() => {}}
          localSpatialEnabled
          localHighFidelity
          localUserId="user-1"
          onLocalSpatialEnabledChange={() => {}}
          onOpenVoiceSettings={() => {}}
          onClose={() => {}}
        />
      </div>,
    );

    const panel = await screen.findByRole("dialog", { name: "Spatial Audio" });

    expect(container).not.toContainElement(panel);
    expect(document.body).toContainElement(panel);
    expect(panel.closest("[data-rm-floating-layer]")).not.toBeNull();
  });
});

describe("SpatialAudioPanel dismissal", () => {
  it("calls onClose on Escape", async () => {
    const onClose = vi.fn();
    const trigger = document.createElement("button");
    document.body.appendChild(trigger);
    render(
      <SpatialAudioPanel
        isOpen
        anchorRef={{ current: trigger }}
        gridItems={[]}
        spatialAudioState={DEFAULT_SHARED_SPATIAL_STATE}
        onUpdateSpatialAudioState={() => {}}
        localSpatialEnabled
        localHighFidelity
        localUserId="user-1"
        onLocalSpatialEnabledChange={() => {}}
        onOpenVoiceSettings={() => {}}
        onClose={onClose}
      />,
    );
    const panel = await screen.findByRole("dialog", { name: "Spatial Audio" });
    fireEvent.keyDown(panel, { key: "Escape" });
    expect(onClose).toHaveBeenCalledTimes(1);
    trigger.remove();
  });
});
