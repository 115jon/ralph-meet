// @vitest-environment jsdom

import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { SplashScreen } from "../SplashScreen";

describe("SplashScreen", () => {
  it("renders the actual splash logo asset instead of a mask placeholder", () => {
    render(<SplashScreen />);

    expect(screen.getByRole("img", { name: "Ralph Meet" })).toHaveAttribute(
      "src",
    );
  });
});
