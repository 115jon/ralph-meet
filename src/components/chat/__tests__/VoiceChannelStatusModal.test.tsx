// @vitest-environment jsdom

import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import React, { useState } from "react";

import VoiceChannelMediaStatusModal from "../VoiceChannelMediaStatusModal";
import VoiceChannelTextStatusModal from "../VoiceChannelTextStatusModal";

vi.mock("@/lib/api-client", () => ({
  apiGet: vi.fn(() => Promise.resolve({ items: [] })),
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

type ModalComponent = (props: {
  open: boolean;
  channel: never;
  onClose: () => void;
}) => React.ReactNode;

const cases: Array<[string, ModalComponent, string]> = [
  [
    "VoiceChannelTextStatusModal",
    VoiceChannelTextStatusModal as ModalComponent,
    "What are we chatting about?",
  ],
  [
    "VoiceChannelMediaStatusModal",
    VoiceChannelMediaStatusModal as ModalComponent,
    "Set the vibe",
  ],
];

function Harness({
  Modal,
  onClose,
}: {
  Modal: ModalComponent;
  onClose: () => void;
}) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button type="button" onClick={() => setOpen(true)}>
        Open status
      </button>
      <Modal
        open={open}
        channel={channel}
        onClose={() => {
          onClose();
          setOpen(false);
        }}
      />
    </>
  );
}

describe.each(cases)("%s", (_name, Modal, title) => {
  afterEach(() => {
    cleanup();
  });

  it("opens a labelled dialog, closes once on Escape and returns focus to the opener", async () => {
    const onClose = vi.fn();
    render(<Harness Modal={Modal} onClose={onClose} />);

    const opener = screen.getByRole("button", { name: "Open status" });
    opener.focus();
    fireEvent.click(opener);

    const dialog = await screen.findByRole("dialog", { name: title });
    expect(dialog).toBeVisible();

    fireEvent.keyDown(dialog, { key: "Escape" });

    expect(onClose).toHaveBeenCalledTimes(1);
    await waitFor(() =>
      expect(
        screen.queryByRole("dialog", { name: title }),
      ).not.toBeInTheDocument(),
    );
    await waitFor(() => expect(opener).toHaveFocus());
  });
});
