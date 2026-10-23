// @vitest-environment jsdom

import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import React from "react";

import { AvatarPickerModal } from "../AvatarPickerModal";
import ProfileEditorModal from "../ProfileEditorModal";
import { UploadSoundModal } from "../UploadSoundModal";

vi.mock("@/lib/api-client", () => ({
  apiDelete: vi.fn(() => Promise.resolve({})),
  apiGet: vi.fn(() => Promise.resolve([])),
}));

vi.mock("@kova/react", () => ({
  useUser: () => ({ isLoaded: true }),
}));

vi.mock("../SettingsAccountTab", () => ({
  default: () => <div>Profile settings</div>,
}));

describe("modal portal positioning", () => {
  afterEach(() => {
    cleanup();
  });

  it("renders the avatar picker as a stacked form-width dialog", () => {
    render(
      <AvatarPickerModal
        open
        displayName="Alex"
        onClose={() => {}}
        onUpload={() => {}}
      />,
    );
    const surface = document.body.querySelector('[data-slot="dialog-content"]');
    expect(surface?.className).toContain("z-60");
    expect(surface?.className).toContain("md:max-w-md");
    expect(
      document.body.querySelector('[data-slot="dialog-overlay"]')?.className,
    ).toContain("bg-rm-scrim");
  });

  it("keeps profile editor content inside its fixed layer", () => {
    render(<ProfileEditorModal open onClose={() => {}} />);
    const surface = document.body.querySelector('[data-slot="dialog-surface"]');

    // One frame: full-screen fixed layer on phones, workbench size above md.
    expect(surface?.className).toContain("fixed inset-0");
    expect(surface?.className).toContain("z-50");
    expect(surface).toHaveTextContent("Profile settings");
    expect(
      document.body.querySelector('[data-slot="dialog-overlay"]')?.className,
    ).toContain("bg-rm-scrim");
  });

  it("renders upload sound as a form-width dialog over the shared scrim", () => {
    render(
      <UploadSoundModal
        open
        onClose={() => {}}
        onUpload={async () => {}}
        isUploading={false}
      />,
    );
    const surface = document.body.querySelector('[data-slot="dialog-content"]');
    expect(surface).not.toBeNull();
    expect(surface?.className).toContain("md:max-w-md");
    expect(
      document.body.querySelector('[data-slot="dialog-overlay"]')?.className,
    ).toContain("bg-rm-scrim");
  });
});
