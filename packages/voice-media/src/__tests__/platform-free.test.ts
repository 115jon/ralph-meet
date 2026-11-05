import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

// The package runs on the web and in the Expo app (react-native-webrtc), so
// only WebRTC globals may be used, and only where the platform injects them
// (registerGlobals on React Native). Browser-only globals stay out.
const SOURCE_DIR = fileURLToPath(new URL("..", import.meta.url));
const BROWSER_ONLY =
  /\b(window|document|navigator|localStorage|sessionStorage|HTMLElement|HTMLCanvasElement|AudioContext)\b/;

function sourceFiles(): string[] {
  return readdirSync(SOURCE_DIR)
    .filter((name) => name.endsWith(".ts") && !name.endsWith(".test.ts"))
    .map((name) => join(SOURCE_DIR, name));
}

function code(path: string): string[] {
  // Drop comments: prose may name browser globals.
  return readFileSync(path, "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .split("\n")
    .map((line) => line.replace(/\/\/.*$/, ""));
}

describe("@ralph/voice-media", () => {
  it("uses no browser-only globals", () => {
    const offending: string[] = [];
    for (const path of sourceFiles()) {
      code(path).forEach((line, index) => {
        if (BROWSER_ONLY.test(line)) offending.push(`${path}:${index + 1}`);
      });
    }
    expect(sourceFiles().length).toBeGreaterThan(5);
    expect(offending).toEqual([]);
  });

  it("imports nothing from the web app", () => {
    for (const path of sourceFiles()) {
      expect(readFileSync(path, "utf8")).not.toMatch(/from "@\//);
    }
  });
});
