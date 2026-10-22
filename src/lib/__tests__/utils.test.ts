import { describe, expect, it } from "vitest";

import { cn } from "../utils";

describe("cn", () => {
  it("keeps app type-scale sizes next to colour utilities", () => {
    expect(cn("text-ui-2xs font-medium", "text-rm-text-muted")).toBe(
      "text-ui-2xs font-medium text-rm-text-muted",
    );
  });

  it("still lets a later font size win", () => {
    expect(cn("text-ui-sm", "text-base")).toBe("text-base");
    expect(cn("text-xs", "text-ui-base")).toBe("text-ui-base");
  });

  it("treats transition-ui as a transition property utility", () => {
    expect(cn("transition-ui", "transition-colors")).toBe("transition-colors");
  });
});
