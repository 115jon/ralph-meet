import { describe, expect, it } from "vitest";

import { normalizeKlipyGeneratedStatusResponse } from "../-emojis.shared";

describe("normalizeKlipyGeneratedStatusResponse", () => {
  it("reads direct status payloads", () => {
    expect(normalizeKlipyGeneratedStatusResponse({
      status: "success",
      result: {
        base64_encoded: "abc123",
        mime_type: "image/png",
      },
    })).toEqual({
      status: "success",
      base64Encoded: "abc123",
      mimeType: "image/png",
    });
  });

  it("reads wrapped status payloads from KLIPY", () => {
    expect(normalizeKlipyGeneratedStatusResponse({
      result: true,
      data: {
        id: "emoji-1",
        status: "success",
        result: {
          base64_encoded: "wrapped",
          mime_type: "image/webp",
        },
      },
    })).toEqual({
      status: "success",
      base64Encoded: "wrapped",
      mimeType: "image/webp",
    });
  });

  it("treats malformed payloads as unresolved", () => {
    expect(normalizeKlipyGeneratedStatusResponse({
      result: false,
      data: {
        status: 42,
      },
    })).toEqual({
      status: null,
      base64Encoded: null,
      mimeType: null,
    });
  });
});
