import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const routeSource = readFileSync(
  resolve(dirname(fileURLToPath(import.meta.url)), "chat.tsx"),
  "utf8",
);
const pageLogicSource = readFileSync(
  resolve(
    dirname(fileURLToPath(import.meta.url)),
    "../components/chat/useChatPageLogic.ts",
  ),
  "utf8",
);
const chatPageSource = readFileSync(
  resolve(
    dirname(fileURLToPath(import.meta.url)),
    "../components/chat/ChatPageClient.tsx",
  ),
  "utf8",
);

describe("chat layout ownership", () => {
  it("keeps ChatPageClient under one stable route owner", () => {
    expect(routeSource).not.toContain("<Outlet />");
    expect(routeSource.match(/<ChatPageClient\s*\/>/g)).toHaveLength(1);
  });

  it("synchronizes channel URLs through the router", () => {
    expect(pageLogicSource).toContain("useNavigate");
    expect(pageLogicSource).toContain("navigate({ to: path");
  });

  it("does not remount ChatArea when the active channel changes", () => {
    expect(chatPageSource).not.toContain("key={activeChannelId}");
  });
});
