import { describe, expect, it } from "vitest";

import {
  getAvatarUploadPruneList,
  type UserAvatarUpload,
} from "@/services/user-avatar.service";

function upload(id: string, createdAt: string): UserAvatarUpload {
  return {
    id,
    user_id: "user-1",
    file_key: `avatars/user-1/${id}.png`,
    avatar_url: `/api/avatars/user-1/${id}.png`,
    content_type: "image/png",
    created_at: createdAt,
  };
}

describe("getAvatarUploadPruneList", () => {
  it("keeps the six newest uploads and returns older uploads for deletion", () => {
    const uploads = Array.from({ length: 8 }, (_, index) =>
      upload(
        `avatar-${index}`,
        `2026-07-${String(8 - index).padStart(2, "0")}`,
      ),
    );

    expect(getAvatarUploadPruneList(uploads).map((item) => item.id)).toEqual([
      "avatar-6",
      "avatar-7",
    ]);
  });

  it("does not prune when there are six or fewer uploads", () => {
    expect(
      getAvatarUploadPruneList([upload("avatar-1", "2026-07-01")]),
    ).toEqual([]);
  });
});
