// @vitest-environment jsdom

import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import React from "react";

import VoiceChannelMediaStatusModal from "../VoiceChannelMediaStatusModal";
import VoiceChannelTextStatusModal from "../VoiceChannelTextStatusModal";

vi.mock("@/lib/api-client", () => ({
  apiGet: vi.fn(() => Promise.resolve([])),
  apiPatch: vi.fn(),
  apiPost: vi.fn(),
  apiUpload: vi.fn(),
}));

vi.mock("@/stores/chat-store", () => ({
  useChatActions: () => ({ dispatch: vi.fn() }),
}));

vi.mock("../EmojiPicker", () => ({
  default: () => null,
}));

vi.mock("@/components/chat/GifPickerModal", () => ({
  default: () => null,
}));

const channel = {
  id: "channel-1",
  name: "General",
  voice_status: null,
} as never;

function getDialogWrapper(markup: string): string {
  const wrapperStart = markup.indexOf(
    'class="fixed inset-0 z-60 flex items-center justify-center',
  );
  expect(wrapperStart).toBeGreaterThanOrEqual(0);
  return markup.slice(wrapperStart);
}

describe("voice channel status dialog positioning", () => {
  afterEach(() => {
    cleanup();
  });

  it("keeps the text editor inside its fixed centering wrapper", () => {
    render(
      <VoiceChannelTextStatusModal open channel={channel} onClose={() => {}} />,
    );
    const markup = document.body.innerHTML;

    const wrapper = getDialogWrapper(markup);
    expect(wrapper.indexOf('data-slot="dialog-surface"')).toBeGreaterThan(0);
  });

  it("keeps the media editor inside its fixed centering wrapper", () => {
    render(
      <VoiceChannelMediaStatusModal
        open
        channel={channel}
        onClose={() => {}}
      />,
    );
    const markup = document.body.innerHTML;

    const wrapper = getDialogWrapper(markup);
    expect(wrapper.indexOf('data-slot="dialog-surface"')).toBeGreaterThan(0);
  });
});
