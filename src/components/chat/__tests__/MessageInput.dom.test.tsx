// @vitest-environment jsdom

import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { TooltipProvider } from "@/components/ui/tooltip";
import type { Message } from "@/lib/types";
import { useChatStore } from "@/stores/chat-store";
import MessageInput, { ComposerReadOnly } from "../MessageInput";
import { COMPOSER_RESTORE_EVENT } from "@/stores/chat-actions";

const apiUpload = vi.hoisted(() => vi.fn());
vi.mock("@/lib/api-client", () => ({
  apiGet: vi.fn(),
  apiPost: vi.fn(),
  apiUpload,
}));

/** What MessageItem dispatches when a failed send is deleted. True if a composer took it. */
function restoreComposerText(channelId: string, content: string): boolean {
  return !window.dispatchEvent(
    new CustomEvent(COMPOSER_RESTORE_EVENT, {
      detail: { channelId, content },
      cancelable: true,
    }),
  );
}

const ada = {
  id: "u-ada",
  username: "ada",
  display_name: "Ada Lovelace",
  avatar_url: null,
};

const replyTarget = {
  id: "m-1",
  channel_id: "c1",
  content: "Spacing is now 4/8/12/16/24/32",
  author: ada,
  attachments: [],
} as unknown as Message;

function renderComposer(
  props: Partial<React.ComponentProps<typeof MessageInput>> = {},
) {
  const onSend = vi.fn();
  const utils = render(
    <TooltipProvider>
      <MessageInput
        channelId="c1"
        channelName="general"
        onSend={onSend}
        onTyping={() => {}}
        {...props}
      />
    </TooltipProvider>,
  );
  const textarea = screen.getByRole("textbox", {
    name: /Message #general|Reply to/,
  }) as HTMLTextAreaElement;
  return { ...utils, textarea, onSend };
}

function type(textarea: HTMLTextAreaElement, value: string) {
  fireEvent.change(textarea, {
    target: { value, selectionStart: value.length, selectionEnd: value.length },
  });
}

describe("composer box", () => {
  it("is a ply-2 plate with a line-field edge, 2px corners, min 48 and spellcheck on", () => {
    const { textarea } = renderComposer();
    const box = textarea.closest(".rm-composer") as HTMLElement;

    for (const token of [
      "bg-ply-2",
      "border-line-field",
      "rounded-[2px]",
      "min-h-12",
      "overflow-hidden",
      "focus-within:border-ink-1",
      "focus-within:ring-ink-1",
    ]) {
      expect(box.className).toContain(token);
    }
    expect(textarea.getAttribute("spellcheck")).toBe("true");
    expect(textarea.className).toContain("text-ui-base");
    expect(textarea.className).toContain("max-md:text-ui-md");
  });

  it("uses a plain ghost attach button, not a tinted one", () => {
    renderComposer();
    const attach = screen.getByRole("button", { name: "Add attachment" });
    expect(attach.className).not.toContain("bg-rm-tint-1");
    expect(attach.className).toContain("size-12");
  });
});

describe("ComposerReadOnly", () => {
  it("shares the composer's box and text metrics so the column never jumps", () => {
    const { textarea } = renderComposer();
    const composerBox = textarea.closest(".rm-composer") as HTMLElement;
    const { unmount } = render(<ComposerReadOnly />);

    const box = screen.getByTestId("composer-read-only");
    for (const token of [
      "min-h-12",
      "rounded-[2px]",
      "border-line-field",
      "bg-ply-2",
    ]) {
      expect(box.className).toContain(token);
      expect(composerBox.className).toContain(token);
    }
    expect(box).toHaveTextContent(
      "You don't have permission to send messages in this channel.",
    );
    expect(box.querySelector('[data-icon="lock"]')).not.toBeNull();
    expect(box.querySelector("textarea")).toBeNull();
    unmount();
  });

  it("takes its own copy", () => {
    render(<ComposerReadOnly message="Only mods can post here." />);
    expect(screen.getByTestId("composer-read-only")).toHaveTextContent(
      "Only mods can post here.",
    );
  });
});

describe("reply bar", () => {
  it("reads 'Replying to Ada' with a 24px cancel button", () => {
    const onCancelReply = vi.fn();
    renderComposer({ replyTo: replyTarget, onCancelReply });

    const bar = screen.getByTestId("reply-indicator");
    expect(bar).toHaveTextContent("Replying to");
    expect(bar).toHaveTextContent("Ada Lovelace");
    expect(bar.className).not.toContain("uppercase");
    expect(bar.className).not.toContain("rounded-t-2xl");
    expect(bar.className).toContain("border-line");

    const cancel = screen.getByRole("button", { name: "Cancel reply" });
    expect(cancel.className).toContain("size-6");
    fireEvent.click(cancel);
    expect(onCancelReply).toHaveBeenCalledTimes(1);
  });

  it("Escape in the field cancels the reply", () => {
    const onCancelReply = vi.fn();
    const { textarea } = renderComposer({
      replyTo: replyTarget,
      onCancelReply,
    });
    fireEvent.keyDown(textarea, { key: "Escape" });
    expect(onCancelReply).toHaveBeenCalledTimes(1);
  });

  it("fades out for 100ms after the reply is cleared, then unmounts", () => {
    vi.useFakeTimers();
    try {
      const view = render(
        <TooltipProvider>
          <MessageInput
            channelId="c1"
            channelName="general"
            onSend={() => {}}
            onTyping={() => {}}
            replyTo={replyTarget}
          />
        </TooltipProvider>,
      );
      expect(screen.getByTestId("reply-indicator").className).not.toContain(
        "opacity-0",
      );

      view.rerender(
        <TooltipProvider>
          <MessageInput
            channelId="c1"
            channelName="general"
            onSend={() => {}}
            onTyping={() => {}}
            replyTo={null}
          />
        </TooltipProvider>,
      );
      const closing = screen.getByTestId("reply-indicator");
      expect(closing.className).toContain("opacity-0");
      expect(closing).toHaveAttribute("aria-hidden", "true");

      act(() => {
        vi.advanceTimersByTime(120);
      });
      expect(screen.queryByTestId("reply-indicator")).toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });
});

describe("failed-send restore (rm:composer-restore)", () => {
  it("puts the text back into an empty composer for that channel", () => {
    const { textarea } = renderComposer();
    let accepted = false;
    act(() => {
      accepted = restoreComposerText("c1", "hello again");
    });
    expect(accepted).toBe(true);
    expect(textarea.value).toBe("hello again");
  });

  it("leaves a composer with text alone", () => {
    const { textarea } = renderComposer();
    type(textarea, "half a thought");
    let accepted = true;
    act(() => {
      accepted = restoreComposerText("c1", "hello again");
    });
    expect(accepted).toBe(false);
    expect(textarea.value).toBe("half a thought");
  });

  it("ignores another channel's composer and empty payloads", () => {
    const { textarea } = renderComposer();
    act(() => {
      expect(restoreComposerText("c2", "wrong room")).toBe(false);
      expect(restoreComposerText("c1", "")).toBe(false);
    });
    expect(textarea.value).toBe("");
  });
});

describe("upload tray", () => {
  const originalMembers = useChatStore.getState().members;
  beforeEach(() => {
    apiUpload.mockReset();
    URL.createObjectURL = vi.fn(() => "blob:preview");
    URL.revokeObjectURL = vi.fn();
  });
  afterEach(() => {
    useChatStore.setState({ members: originalMembers });
  });

  const drop = (file: File) =>
    act(() => {
      window.dispatchEvent(new CustomEvent("drop-files", { detail: [file] }));
    });

  it("shows file tiles with the size in mono and a visible sensitive toggle", async () => {
    apiUpload.mockResolvedValue({
      id: "f1",
      file_url: "/files/notes.txt",
      file_name: "notes.txt",
      file_size: 2048,
      content_type: "text/plain",
    });
    renderComposer();
    drop(new File(["x"], "notes.txt", { type: "text/plain" }));

    const tray = await screen.findByTestId("upload-tray");
    await waitFor(() => expect(tray).toHaveTextContent("2.0 KB"));
    expect(tray.className).toContain("border-line");
    expect(tray.className).not.toContain("max-h-0");
    expect(tray.querySelector('[data-slot="num"]')?.className).toContain(
      "text-num-xs",
    );

    const toggle = screen.getByRole("button", {
      name: "Mark notes.txt as sensitive",
    });
    expect(toggle).toHaveAttribute("aria-pressed", "false");
    fireEvent.click(toggle);
    expect(
      screen.getByRole("button", {
        name: "notes.txt is marked sensitive. Unmark it",
      }),
    ).toHaveAttribute("aria-pressed", "true");
  });

  it("keeps a failed upload with Retry instead of dropping it", async () => {
    apiUpload.mockRejectedValueOnce(new Error("network"));
    vi.spyOn(console, "error").mockImplementation(() => {});
    renderComposer();
    drop(new File(["x"], "clip.txt", { type: "text/plain" }));

    const retry = await screen.findByRole("button", {
      name: "Retry uploading clip.txt",
    });
    expect(screen.getByRole("alert")).toHaveTextContent("Upload failed");

    apiUpload.mockResolvedValueOnce({
      id: "f2",
      file_url: "/files/clip.txt",
      file_name: "clip.txt",
      file_size: 10,
      content_type: "text/plain",
    });
    fireEvent.click(retry);
    await waitFor(() =>
      expect(
        screen.getByRole("button", { name: "Mark clip.txt as sensitive" }),
      ).toBeInTheDocument(),
    );
    expect(screen.queryByRole("alert")).toBeNull();
    expect(apiUpload).toHaveBeenCalledTimes(2);
  });
});

describe("sending", () => {
  it("Enter sends and the field returns to the 48px floor, not 32", () => {
    const { textarea, onSend } = renderComposer();
    type(textarea, "hello");
    // A tall field (as after a multi-line message) must collapse on send.
    textarea.style.height = "120px";
    fireEvent.keyDown(textarea, { key: "Enter" });
    expect(onSend).toHaveBeenCalledTimes(1);
    expect(onSend.mock.calls[0]![0]).toBe("hello");
    expect(textarea.style.height).toBe("48px");
    expect(textarea.value).toBe("");
  });

  it("Shift+Enter does not send", () => {
    const { textarea, onSend } = renderComposer();
    type(textarea, "hello");
    fireEvent.keyDown(textarea, { key: "Enter", shiftKey: true });
    expect(onSend).not.toHaveBeenCalled();
  });

  it("does not send while an IME is composing (isComposing or keyCode 229)", () => {
    const { textarea, onSend } = renderComposer();
    type(textarea, "ni hao");
    fireEvent.keyDown(textarea, { key: "Enter", isComposing: true });
    fireEvent.keyDown(textarea, { key: "Enter", keyCode: 229 });
    expect(onSend).not.toHaveBeenCalled();
    expect(textarea.value).toBe("ni hao");

    fireEvent.keyDown(textarea, { key: "Enter" });
    expect(onSend).toHaveBeenCalledTimes(1);
  });

  it("the phone send key neither takes focus on press nor strands it on send", () => {
    const { textarea, onSend } = renderComposer();
    type(textarea, "on my phone");
    textarea.focus();
    const send = screen.getByRole("button", { name: "Send message" });

    // preventDefault on pointerdown stops the browser moving focus (and
    // closing the phone keyboard) onto the key.
    const notCancelled = fireEvent.pointerDown(send);
    expect(notCancelled).toBe(false);

    fireEvent.click(send);
    expect(onSend).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole("button", { name: "Send message" })).toBeNull();
    expect(document.activeElement).toBe(textarea);
  });

  it("refocuses the field when the send key itself had focus", () => {
    const { textarea } = renderComposer();
    type(textarea, "keyboard user");
    const send = screen.getByRole("button", { name: "Send message" });
    send.focus();
    fireEvent.click(send);
    expect(document.activeElement).toBe(textarea);
  });
});
