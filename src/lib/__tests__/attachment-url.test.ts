import { describe, expect, it } from "vitest";

import { getAttachmentUrl, isExternalAttachmentUrl } from "@/lib/attachment-url";

describe("attachment-url helpers", () => {
  it("keeps provider-hosted attachment URLs as-is", () => {
    expect(isExternalAttachmentUrl("https://static.klipy.com/test.gif")).toBe(true);
    expect(getAttachmentUrl("https://static.klipy.com/test.gif")).toBe("https://static.klipy.com/test.gif");
  });

  it("converts stored attachment keys into API URLs", () => {
    expect(isExternalAttachmentUrl("attachments/channel/file.gif")).toBe(false);
    expect(getAttachmentUrl("attachments/channel/file.gif")).toBe("/api/attachments/channel/file.gif");
  });
});
