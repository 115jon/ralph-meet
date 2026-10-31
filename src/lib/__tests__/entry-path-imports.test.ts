import {
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";

// effect's Schema is about 100 KB gzip. It belongs to the code that decodes
// gateway frames (the chat store, the SFU and voice gateways) and to the server.
// The pages everyone loads (the entry chunk, sign-in, activate, the invite and
// share pages, the room lobby) must not pay for it, so nothing reachable from
// them may import it. Client storage reads go through `@/lib/persisted-guard`,
// which has no imports, for that reason.
//
// This walks the static (non-type, non-dynamic) import graph from those entry
// modules and fails with the import chain when it reaches a module that imports
// "effect".

const REPO = path.resolve(__dirname, "../../..");
const SRC = path.join(REPO, "src");

/**
 * Modules that already carry Schema because they decode gateway frames. They
 * are loaded lazily, and a route that reaches one pays for Schema whatever else
 * it imports, so the walk stops there instead of reporting them.
 */
const SCHEMA_CARRIERS = [
  "src/stores/chat-store.ts",
  "src/lib/sfu-client.ts",
  "src/lib/voice/gateways/",
];

/** Modules every visitor loads, from the entry chunk and the public pages. */
const ENTRY_PATH_ROOTS = [
  "src/client.tsx",
  "src/routes/__root.tsx",
  "src/components/theme-provider.tsx",
  "src/components/HomePageClient.tsx",
  "src/routes/index.tsx",
  "src/routes/sign-in.tsx",
  "src/routes/sign-up.tsx",
  "src/routes/activate.tsx",
  "src/routes/invite.$code.tsx",
  "src/routes/share.$token.tsx",
  "src/routes/room.$slug.tsx",
  "src/components/RoomPageClient.tsx",
  // Reached from the entry chunk through media, share metadata and proxy urls.
  "src/lib/media.ts",
  "src/lib/share-metadata.ts",
  "src/lib/proxy-media-url.ts",
  "src/lib/gif-picker.ts",
  "src/lib/emoji.ts",
  "src/lib/platform.ts",
  "src/lib/utils.ts",
  "src/lib/theme-preferences.ts",
  "src/lib/auth-art.ts",
  "src/lib/dither-painters.ts",
  // The persisted-state readers every store and storage helper uses.
  "src/lib/persisted-guard.ts",
  "src/stores/useDesktopSettingsStore.ts",
  "src/stores/useListenTogetherAudioSettingsStore.ts",
  "src/stores/useMediaPlaybackSettingsStore.ts",
  "src/stores/useMediaSafetySettingsStore.ts",
  "src/stores/useSoundSettingsStore.ts",
  "src/stores/useVoiceSettingsStore.ts",
  "src/lib/listen-together-local.ts",
];

function toRepoPath(file: string): string {
  return path.relative(REPO, file).split(path.sep).join("/");
}

function resolveSpecifier(from: string, specifier: string): string | null {
  let base: string;
  if (specifier.startsWith("@/")) base = path.join(SRC, specifier.slice(2));
  else if (specifier.startsWith(".")) {
    base = path.resolve(path.dirname(from), specifier);
  } else return null;

  for (const candidate of [
    base,
    `${base}.ts`,
    `${base}.tsx`,
    path.join(base, "index.ts"),
    path.join(base, "index.tsx"),
  ]) {
    if (existsSync(candidate) && statSync(candidate).isFile()) return candidate;
  }
  return null;
}

/** Specifiers a module loads at runtime: not `import type`, not `{ type X }` only, not `import()`. */
function runtimeSpecifiers(file: string): string[] {
  const source = readFileSync(file, "utf8");
  const specifiers: string[] = [];

  for (const [, specifier] of source.matchAll(/^import\s*["']([^"']+)["']/gm)) {
    specifiers.push(specifier);
  }

  const fromClauses =
    /^(?:import|export)\s+(type\s+)?([\w$*{},\s]*?)\s*from\s*["']([^"']+)["']/gm;
  for (const [, typeOnly, clause, specifier] of source.matchAll(fromClauses)) {
    if (typeOnly) continue;
    const named = clause.match(/^\{([\s\S]*)\}$/);
    if (named) {
      const members = named[1]
        .split(",")
        .map((member) => member.trim())
        .filter(Boolean);
      if (members.length > 0 && members.every((m) => m.startsWith("type "))) {
        continue;
      }
    }
    specifiers.push(specifier);
  }

  return specifiers;
}

/** Import chains (root first) from `root` to every module that imports "effect". */
function chainsToEffect(root: string, stopAt: string[]): string[][] {
  const parent = new Map<string, string | null>([[root, null]]);
  const queue = [root];
  const importers: string[] = [];

  while (queue.length > 0) {
    const file = queue.shift()!;
    for (const specifier of runtimeSpecifiers(file)) {
      if (specifier === "effect" || specifier.startsWith("effect/")) {
        importers.push(file);
        continue;
      }
      const resolved = resolveSpecifier(file, specifier);
      if (!resolved || parent.has(resolved)) continue;
      const repoPath = toRepoPath(resolved);
      if (stopAt.some((stop) => repoPath.startsWith(stop))) continue;
      parent.set(resolved, file);
      queue.push(resolved);
    }
  }

  return importers.map((importer) => {
    const chain: string[] = [];
    for (let file: string | null = importer; file; file = parent.get(file)!) {
      chain.unshift(toRepoPath(file));
    }
    return chain;
  });
}

describe("entry path imports", () => {
  it("every root exists", () => {
    for (const root of ENTRY_PATH_ROOTS) {
      expect(existsSync(path.join(REPO, root)), root).toBe(true);
    }
  });

  it.each(ENTRY_PATH_ROOTS)("%s does not reach effect", (root) => {
    const chains = chainsToEffect(path.join(REPO, root), SCHEMA_CARRIERS);

    expect(
      chains.map((chain) => chain.join(" -> ")),
      `${root} imports effect (Schema) on a public page's path`,
    ).toEqual([]);
  });

  describe("the walk itself", () => {
    it("finds effect behind a module that imports it", () => {
      expect(chainsToEffect(path.join(SRC, "lib/schema.ts"), [])).toEqual([
        ["src/lib/schema.ts"],
      ]);
    });

    it("finds effect through the chat store, and stops at the carriers", () => {
      // useUserResolution imports the chat store statically. (useIsSpeaking
      // used to, until speaking-source.ts cut it off the store.)
      const hook = path.join(SRC, "hooks/useUserResolution.ts");

      expect(
        chainsToEffect(hook, []).some((chain) =>
          chain.includes("src/stores/chat-gateway.ts"),
        ),
      ).toBe(true);
      expect(chainsToEffect(hook, SCHEMA_CARRIERS)).toEqual([]);
    });

    it("sees the server-side decoders as Schema users", () => {
      for (const file of [
        "lib/lenient-schema.ts",
        "lib/vendor-payloads/tiktok.ts",
        "lib/validate-body.ts",
      ]) {
        expect(chainsToEffect(path.join(SRC, file), []), file).not.toEqual([]);
      }
    });

    it("counts runtime imports only", () => {
      const dir = mkdtempSync(path.join(tmpdir(), "entry-imports-"));
      try {
        const write = (name: string, source: string) => {
          writeFileSync(path.join(dir, name), source);
          return path.join(dir, name);
        };
        const file = write(
          "fixture.ts",
          [
            'import type { A } from "effect";',
            'import { type B, type C } from "./type-only";',
            'import { Schema } from "effect";',
            'import "./side-effect";',
            "import {",
            "  one,",
            "  type Two,",
            '} from "./multi-line";',
            'import * as everything from "./namespace";',
            'export type { D } from "./type-reexport";',
            'export { e } from "./reexport";',
            'export * from "./star";',
            'const lazy = () => import("./dynamic");',
            "export type Local = { not: 'an import' };",
            'export const fromText = "from nowhere";',
          ].join("\n"),
        );

        expect(runtimeSpecifiers(file).sort()).toEqual(
          [
            "effect",
            "./side-effect",
            "./multi-line",
            "./namespace",
            "./reexport",
            "./star",
          ].sort(),
        );
      } finally {
        rmSync(dir, { recursive: true, force: true });
      }
    });
  });
});
