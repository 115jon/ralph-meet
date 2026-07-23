// @vitest-environment jsdom

import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

vi.mock("@kova/react", () => ({
  useUser: () => ({ isLoaded: true, user: null }),
}));

vi.mock("../SettingsAccountTab", () => ({
  default: ({ onClose }: { onClose?: () => void }) => (
    <div>
      <button type="button" onClick={onClose}>
        Close profile editor
      </button>
    </div>
  ),
}));

import ProfileEditorModal from "../ProfileEditorModal";

describe("ProfileEditorModal", () => {
  it("renders only the profile editor surface", () => {
    render(<ProfileEditorModal onClose={() => {}} />);

    expect(
      screen.getByRole("dialog", { name: "Edit profile" }),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("navigation", { name: "Settings navigation" }),
    ).not.toBeInTheDocument();
  });

  it("forwards close actions to its owner", () => {
    const onClose = vi.fn();

    render(<ProfileEditorModal onClose={onClose} />);
    fireEvent.click(
      screen.getByRole("button", { name: "Close profile editor" }),
    );

    expect(onClose).toHaveBeenCalledOnce();
  });
});
