// @vitest-environment jsdom

import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { TooltipProvider } from "@/components/ui/tooltip";
import { AudioCompatibilityHint } from "../AudioCompatibilityHint";

describe("AudioCompatibilityHint", () => {
  it("exposes an accessible hover target for compatibility details", () => {
    render(
      <TooltipProvider>
        <AudioCompatibilityHint>
          RNNoise remains compatible with high fidelity audio.
        </AudioCompatibilityHint>
      </TooltipProvider>,
    );

    expect(
      screen.getByLabelText("Audio compatibility information"),
    ).toBeInTheDocument();
  });
});
