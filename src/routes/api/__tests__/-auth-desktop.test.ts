import { describe, expect, it } from "vitest";
import { GET } from "../auth/desktop";

describe("legacy desktop sign-in entrypoint", () => {
  it("sends old native builds to device-code sign-in, not a deep link", async () => {
    const response = await GET({
      request: new Request("https://meet.example/api/auth/desktop"),
    });

    expect(response.status).toBe(302);
    expect(response.headers.get("Location")).toBe(
      "https://meet.example/activate",
    );
    expect(response.headers.get("Location")).not.toContain("ralphmeet://");
  });
});
