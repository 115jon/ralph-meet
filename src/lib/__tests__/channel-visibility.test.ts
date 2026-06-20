import { describe, expect, it } from "vitest";

import { resolveVisibleChannelPermissions } from "../channel-visibility";
import { PERMISSIONS } from "../permissions";

describe("resolveVisibleChannelPermissions", () => {
  it("hides channels denied through the everyone override", () => {
    const visible = resolveVisibleChannelPermissions(
      [{ id: "vc-public" }, { id: "vc-private" }],
      "user-1",
      [{ id: "role-everyone", permissions: PERMISSIONS.VIEW_CHANNELS, is_default: true }],
      [
        {
          channel_id: "vc-private",
          target_id: "role-everyone",
          target_type: "role",
          allow: 0,
          deny: PERMISSIONS.VIEW_CHANNELS,
        },
      ],
    );

    expect(visible).toEqual({
      "vc-public": PERMISSIONS.VIEW_CHANNELS,
    });
  });

  it("restores visibility through a role-specific allow override", () => {
    const visible = resolveVisibleChannelPermissions(
      [{ id: "vc-team" }],
      "user-1",
      [
        { id: "role-everyone", permissions: 0, is_default: true },
        { id: "role-team", permissions: 0, is_default: false },
      ],
      [
        {
          channel_id: "vc-team",
          target_id: "role-team",
          target_type: "role",
          allow: PERMISSIONS.VIEW_CHANNELS,
          deny: 0,
        },
      ],
    );

    expect(visible).toEqual({
      "vc-team": PERMISSIONS.VIEW_CHANNELS,
    });
  });
});
