import { describe, expect, it } from "vitest";

import { PERMISSIONS } from "@/lib/permissions";
import {
  canMoveMembersIn,
  canMoveMembersInto,
  decideVoiceMove,
  type VoiceMoveActor,
} from "@/lib/voice-move-permissions";

const MOD =
  PERMISSIONS.VIEW_CHANNELS | PERMISSIONS.CONNECT | PERMISSIONS.MOVE_MEMBERS;
const MEMBER = PERMISSIONS.VIEW_CHANNELS | PERMISSIONS.CONNECT;

function mover(overrides: Partial<VoiceMoveActor> = {}): VoiceMoveActor {
  return {
    isOwner: false,
    sourcePermissions: MOD,
    targetPermissions: MOD,
    topRole: 2,
    ...overrides,
  };
}

const member = { isOwner: false, topRole: 1 };

describe("decideVoiceMove", () => {
  it("allows a mover with MOVE_MEMBERS on both channels over a lower role", () => {
    expect(decideVoiceMove(mover(), member)).toEqual({ ok: true });
  });

  it("needs MOVE_MEMBERS on the source channel", () => {
    expect(
      decideVoiceMove(mover({ sourcePermissions: MEMBER }), member),
    ).toEqual({ ok: false, reason: "missing_permissions" });
  });

  it("needs to see the source channel (MOVE_MEMBERS alone is not enough)", () => {
    expect(
      decideVoiceMove(
        mover({ sourcePermissions: MOD & ~PERMISSIONS.VIEW_CHANNELS }),
        member,
      ),
    ).toEqual({ ok: false, reason: "missing_permissions" });
  });

  it("needs MOVE_MEMBERS on the target channel", () => {
    expect(
      decideVoiceMove(mover({ targetPermissions: MEMBER }), member),
    ).toEqual({ ok: false, reason: "missing_permissions" });
  });

  it("needs to see and join the target channel itself", () => {
    for (const missing of [PERMISSIONS.VIEW_CHANNELS, PERMISSIONS.CONNECT]) {
      expect(
        decideVoiceMove(mover({ targetPermissions: MOD & ~missing }), member),
      ).toEqual({ ok: false, reason: "missing_permissions" });
    }
  });

  it("refuses a mover who is not a member", () => {
    expect(
      decideVoiceMove(
        mover({ sourcePermissions: null, targetPermissions: null }),
        member,
      ),
    ).toEqual({ ok: false, reason: "missing_permissions" });
  });

  it("treats ADMINISTRATOR as MOVE_MEMBERS and skips the hierarchy", () => {
    const admin = mover({
      sourcePermissions: PERMISSIONS.ADMINISTRATOR,
      targetPermissions: PERMISSIONS.ADMINISTRATOR,
      topRole: 1,
    });
    expect(decideVoiceMove(admin, { isOwner: false, topRole: 5 })).toEqual({
      ok: true,
    });
  });

  it("lets the owner move anyone, with no permissions at all", () => {
    expect(
      decideVoiceMove(
        mover({
          isOwner: true,
          sourcePermissions: 0,
          targetPermissions: null,
          topRole: 0,
        }),
        { isOwner: false, topRole: 9 },
      ),
    ).toEqual({ ok: true });
  });

  it("refuses moving a member with an equal or higher role, as kick does", () => {
    for (const topRole of [2, 3]) {
      expect(decideVoiceMove(mover(), { isOwner: false, topRole })).toEqual({
        ok: false,
        reason: "role_hierarchy",
      });
    }
  });

  it("only the owner moves the owner", () => {
    const admin = mover({
      sourcePermissions: PERMISSIONS.ADMINISTRATOR,
      targetPermissions: PERMISSIONS.ADMINISTRATOR,
    });
    expect(decideVoiceMove(admin, { isOwner: true, topRole: 0 })).toEqual({
      ok: false,
      reason: "role_hierarchy",
    });
  });
});

describe("canMoveMembersIn / canMoveMembersInto", () => {
  it("read effective channel permissions", () => {
    expect(canMoveMembersIn(null)).toBe(false);
    expect(canMoveMembersIn(MEMBER)).toBe(false);
    // A channel you cannot see is not one you can empty.
    expect(canMoveMembersIn(PERMISSIONS.MOVE_MEMBERS)).toBe(false);
    expect(
      canMoveMembersIn(PERMISSIONS.MOVE_MEMBERS | PERMISSIONS.VIEW_CHANNELS),
    ).toBe(true);
    expect(canMoveMembersInto(PERMISSIONS.MOVE_MEMBERS)).toBe(false);
    expect(canMoveMembersInto(MOD)).toBe(true);
    expect(canMoveMembersInto(PERMISSIONS.ADMINISTRATOR)).toBe(true);
  });
});
