import bundledCoreCode from "../ytdlp/assets/yt.solver.core.min.js?raw";
import bundledLibCode from "../ytdlp/assets/yt.solver.lib.min.js?raw";
import { assertSolverBundleUsable, compileSolverBundle } from "../ytdlp/solver";
import { describe, expect, it } from "vitest";

const bundledBundle = {
  version: "0.8.0",
  source: "bundled" as const,
  fetchedAt: "2026-07-06T00:00:00.000Z",
  releaseUrl: "https://github.com/yt-dlp/ejs/releases/tag/0.8.0",
  libCode: bundledLibCode,
  coreCode: bundledCoreCode,
  libDigest:
    "sha256:c55987fe697e5b9ee18830163f7af85327e9bb5c3e674b969d38c8d205eaa577",
  coreDigest:
    "sha256:18da6ce0758b416e7ae645084f4f8801f9f9d59d6c477c05eaa0ff94ebd8cc00",
};

describe("yt-dlp solver bundle", () => {
  it("passes a smoke test with the bundled fallback assets", () => {
    expect(() => assertSolverBundleUsable(bundledBundle)).not.toThrow();
  });

  it("can evaluate preprocessed challenge code without a live player script", () => {
    const jsc = compileSolverBundle(bundledBundle);
    const output = jsc({
      type: "preprocessed",
      preprocessed_player: `
        _result.n = (value) => value + "-n";
        _result.sig = (value) => value.split("").reverse().join("");
      `,
      requests: [
        { type: "n", challenges: ["abc"] },
        { type: "sig", challenges: ["st"] },
      ],
    });

    expect(output.type).toBe("result");
    expect(output.responses?.[0]).toEqual({
      type: "result",
      data: { abc: "abc-n" },
    });
    expect(output.responses?.[1]).toEqual({
      type: "result",
      data: { st: "ts" },
    });
  });
});
