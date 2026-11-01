import { describe, expect, it } from "vitest";

import {
  ASSET_LINKS,
  ASSET_LINKS_PATH,
  assetLinksResponse,
  handleAssetLinksRequest,
} from "../assetlinks";

const RELEASE =
  "3E:32:29:17:07:BB:C3:1F:09:CD:0C:8D:DD:4A:B8:5C:17:63:E4:C8:85:8B:91:08:57:AB:89:04:54:4F:1E:EF";

function fingerprintsOf(packageName: string): string[] {
  const found = ASSET_LINKS.find(
    (entry) => entry.target.package_name === packageName,
  );
  return found?.target.sha256_cert_fingerprints ?? [];
}

describe("assetlinks", () => {
  it("serves JSON with a modest cache lifetime", async () => {
    const response = assetLinksResponse();

    expect(response.headers.get("Content-Type")).toBe("application/json");
    expect(response.headers.get("Cache-Control")).toBe("public, max-age=3600");
    expect(await response.json()).toEqual(ASSET_LINKS);
  });

  it("delegates handle_all_urls for the three packages", () => {
    expect(ASSET_LINKS).toHaveLength(3);
    for (const entry of ASSET_LINKS) {
      expect(entry.relation).toEqual([
        "delegate_permission/common.handle_all_urls",
      ]);
      expect(entry.target.namespace).toBe("android_app");
    }
  });

  it("trusts only the release key for production, plus debug keys for dev and preview", () => {
    expect(fingerprintsOf("dev.jontitor.ralphmeet")).toEqual([RELEASE]);
    for (const pkg of [
      "dev.jontitor.ralphmeet.preview",
      "dev.jontitor.ralphmeet.dev",
    ]) {
      const keys = fingerprintsOf(pkg);
      expect(keys).toHaveLength(3);
      expect(keys[0]).toBe(RELEASE);
    }
  });

  it("answers GET and HEAD on its path only", () => {
    const at = (path: string, method = "GET") =>
      handleAssetLinksRequest(
        new Request(`https://meet.test${path}`, { method }),
      );

    expect(at(ASSET_LINKS_PATH)?.status).toBe(200);
    expect(at(ASSET_LINKS_PATH, "HEAD")?.status).toBe(200);
    expect(at(ASSET_LINKS_PATH, "POST")).toBeNull();
    expect(at("/.well-known/other.json")).toBeNull();
  });
});
