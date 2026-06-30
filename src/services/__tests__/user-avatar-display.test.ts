import { describe, expect, it } from "vitest";

import type { AvatarDisplay } from "@/lib/avatar-display";
import { createMockD1 } from "@/lib/__tests__/mock-d1";
import { updateAvatarUrl } from "@/services/user.service";

describe("user avatar display metadata", () => {
  it("stores avatar display instructions alongside the original uploaded avatar URL", async () => {
    const db = createMockD1();
    const display: AvatarDisplay = {
      version: 1,
      crop: { x: 20, y: 5, width: 60, height: 60 },
    };

    db.mockQuery(/SELECT server_id FROM server_members/, { results: [] });
    db.mockQuery(/SELECT username, avatar_display FROM users/, {
      username: "ada",
      avatar_display: JSON.stringify(display),
    });

    const result = await updateAvatarUrl(db as any, "user-1", "/api/avatars/user-1.png", display);
    const [updateCall] = db.getCalls(/UPDATE users SET avatar_url/);

    expect(updateCall.sql).toContain("avatar_display = ?");
    expect(updateCall.bindings[0]).toBe("/api/avatars/user-1.png");
    expect(updateCall.bindings[1]).toBe(JSON.stringify(display));
    expect(result.avatarUrl).toBe("/api/avatars/user-1.png");
    expect(result.avatarDisplay).toEqual(display);
  });
});
