// @vitest-environment jsdom

import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { TooltipProvider } from "@/components/ui/tooltip";
import { useChatStore } from "@/stores/chat-store";
import { HoveredMentionTooltip } from "../HoveredMentionTooltip";
import MessageInput from "../MessageInput";

const member = (id: string, username: string) => ({
  user: {
    id,
    username,
    display_name: username[0]!.toUpperCase() + username.slice(1),
    avatar_url: null,
  },
  roles: [],
});

function renderComposer() {
  const onSend = vi.fn();
  render(
    <TooltipProvider>
      <MessageInput
        channelId="c1"
        channelName="general"
        onSend={onSend}
        onTyping={() => {}}
      />
    </TooltipProvider>,
  );
  const textarea = screen.getByRole("textbox", { name: "Message #general" });
  return { textarea: textarea as HTMLTextAreaElement, onSend };
}

function type(textarea: HTMLTextAreaElement, value: string) {
  act(() => {
    textarea.focus();
  });
  fireEvent.change(textarea, {
    target: { value, selectionStart: value.length, selectionEnd: value.length },
  });
}

describe("MentionAutocomplete in the composer", () => {
  let previousMembers: unknown;

  beforeEach(() => {
    previousMembers = useChatStore.getState().members;
    useChatStore.setState({
      members: [member("u1", "alice"), member("u2", "alfred")] as never,
    });
  });

  afterEach(() => {
    useChatStore.setState({ members: previousMembers as never });
  });

  it("portals a labelled listbox and keeps focus in the textarea", async () => {
    const { textarea } = renderComposer();
    type(textarea, "@al");

    const listbox = await screen.findByRole("listbox", { name: "Members" });
    expect(listbox.closest("[data-rm-floating-layer]")).not.toBeNull();
    expect(textarea).toHaveFocus();

    const options = screen.getAllByRole("option");
    expect(options).toHaveLength(2);
    expect(options[0]).toHaveAttribute("aria-selected", "true");
    expect(options[0]!.className).toContain("pointer-coarse:min-h-11");
    expect(textarea).toHaveAttribute("aria-activedescendant", options[0]!.id);
  });

  it("ArrowDown moves the active option and Enter inserts it", async () => {
    const { textarea, onSend } = renderComposer();
    type(textarea, "@al");
    await screen.findByRole("listbox");

    fireEvent.keyDown(textarea, { key: "ArrowDown" });
    const options = screen.getAllByRole("option");
    expect(options[1]).toHaveAttribute("aria-selected", "true");
    expect(textarea).toHaveAttribute("aria-activedescendant", options[1]!.id);

    fireEvent.keyDown(textarea, { key: "Enter" });
    expect(textarea.value).toContain("@alfred");
    expect(onSend).not.toHaveBeenCalled();
    expect(screen.queryByRole("listbox")).not.toBeInTheDocument();
    expect(textarea).not.toHaveAttribute("aria-activedescendant");
  });

  it("Tab inserts and Escape dismisses without leaving the textarea", async () => {
    const { textarea } = renderComposer();
    type(textarea, "@ali");
    await screen.findByRole("listbox");
    fireEvent.keyDown(textarea, { key: "Tab" });
    expect(textarea.value).toContain("@alice");

    type(textarea, `${textarea.value}@al`);
    await screen.findByRole("listbox");
    fireEvent.keyDown(textarea, { key: "Escape" });
    expect(screen.queryByRole("listbox")).not.toBeInTheDocument();
    expect(textarea).toHaveFocus();
  });

  it("clicking an option inserts it", async () => {
    const { textarea } = renderComposer();
    type(textarea, "@al");
    fireEvent.click(await screen.findByRole("option", { name: /Alfred/ }));
    expect(textarea.value).toContain("@alfred");
  });
});

describe("HoveredMentionTooltip", () => {
  it("shows the stock tooltip with the member's name", async () => {
    render(
      <TooltipProvider>
        <HoveredMentionTooltip
          hoveredMember={member("u1", "alice")}
          pos={{ left: 100, top: 200 }}
        />
      </TooltipProvider>,
    );
    const tooltip = await screen.findByRole("tooltip");
    expect(tooltip).toHaveTextContent("Alice");
    const content = document.querySelector('[data-slot="tooltip-content"]');
    expect(content?.className).toContain("bg-rm-text");
  });

  it("renders nothing without a hovered member", () => {
    const { container } = render(
      <TooltipProvider>
        <HoveredMentionTooltip hoveredMember={null} pos={{ left: 0, top: 0 }} />
      </TooltipProvider>,
    );
    expect(container).toBeEmptyDOMElement();
    expect(screen.queryByRole("tooltip")).not.toBeInTheDocument();
  });
});
