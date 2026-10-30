import { describe, expect, it } from "vitest";
import type { ChatMember } from "@/lib/chat-reducer";
import { mentionsViewer, roleInk, topRoleColor } from "../message-author";

const viewer = { id: "u-me", username: "jon" };

function message(content: string, extra: Record<string, unknown> = {}) {
  return { content, author_id: "u-ada", ...extra };
}

describe("mentionsViewer", () => {
  it("matches @username, @everyone and @here, case-insensitively", () => {
    expect(mentionsViewer(message("hey @jon"), viewer)).toBe(true);
    expect(mentionsViewer(message("@JON look"), viewer)).toBe(true);
    expect(mentionsViewer(message("@everyone standup"), viewer)).toBe(true);
    expect(mentionsViewer(message("@here"), viewer)).toBe(true);
  });

  it("ignores longer names, emails and your own messages", () => {
    expect(mentionsViewer(message("@jonathan"), viewer)).toBe(false);
    expect(mentionsViewer(message("mail me@jon.dev"), viewer)).toBe(false);
    expect(mentionsViewer({ content: "@jon", author_id: "u-me" }, viewer)).toBe(
      false,
    );
  });

  it("treats a reply to your message as a mention", () => {
    expect(
      mentionsViewer(
        message("agreed", { reply_to: { author_id: "u-me" } }) as never,
        viewer,
      ),
    ).toBe(true);
  });
});

describe("role colour", () => {
  const members = [
    {
      user: { id: "u-ada" },
      roles: [
        { color: "#23a559", position: 1 },
        { color: "#f0b232", position: 9 },
      ],
    },
    { user: { id: "u-ken" }, roles: [{ color: "#000000", position: 3 }] },
  ] as unknown as ChatMember[];

  it("uses the highest-positioned coloured role", () => {
    expect(topRoleColor(members, "u-ada")).toBe("#f0b232");
    expect(topRoleColor(members, "u-ken")).toBeNull();
    expect(topRoleColor(members, "u-nobody")).toBeNull();
  });

  it("mixes the role hue toward ink so it reads in every theme", () => {
    expect(roleInk("#f0b232")).toContain("var(--ink-1)");
    expect(roleInk(null)).toBeUndefined();
  });
});
