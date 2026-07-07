// @vitest-environment jsdom

import { render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

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

    const panel = await screen.findByLabelText("Spatial Audio");

    expect(container).not.toContainElement(panel);
    expect(document.body).toContainElement(panel);
    expect(panel).toHaveClass("fixed");
  });
});
