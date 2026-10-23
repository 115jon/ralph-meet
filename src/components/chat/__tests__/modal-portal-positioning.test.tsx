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

function assertContentIsInsideWrapper(markup: string, wrapperClass: string) {
  const wrapperStart = markup.indexOf(`class="${wrapperClass}`);
  expect(wrapperStart).toBeGreaterThanOrEqual(0);
  expect(
    markup.slice(wrapperStart).indexOf('data-slot="dialog-surface"'),
  ).toBeGreaterThan(0);
}

describe("modal portal positioning", () => {
  afterEach(() => {
    cleanup();
  });

  it("keeps avatar picker content inside its fixed layer", () => {
    render(
      <AvatarPickerModal
        open
        displayName="Alex"
        onClose={() => {}}
        onUpload={() => {}}
      />,
    );
    const markup = document.body.innerHTML;

    assertContentIsInsideWrapper(
      markup,
      "fixed inset-0 z-60 flex items-center justify-center overflow-y-auto p-4",
    );
  });

  it("keeps profile editor content inside its fixed layer", () => {
    render(<ProfileEditorModal open onClose={() => {}} />);
    const markup = document.body.innerHTML;

    assertContentIsInsideWrapper(
      markup,
      "fixed inset-0 z-50 flex items-center justify-center bg-black/56",
    );
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
