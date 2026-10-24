import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Blocker 4: native alert/confirm/prompt block the page, ignore the theme and
 * read as a broken app. Confirms go through ConfirmDialog / ConfirmStrip and
 * transient errors through the toast.
 */
const SRC = path.resolve(__dirname, "../../..");
const NATIVE = /(?<![\w.])(?:window\.)?(?:alert|confirm|prompt)\(/;

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const full = path.join(dir, name);
    if (statSync(full).isDirectory()) {
      return name === "__tests__" || name === "__fixtures__"
        ? []
        : sourceFiles(full);
    }
    return /\.(ts|tsx)$/.test(name) && !/\.test\.(ts|tsx)$/.test(name)
      ? [full]
      : [];
  });
}

describe("no native dialogs in src", () => {
  it("has no alert(), confirm() or prompt() calls", () => {
    const hits = sourceFiles(SRC).flatMap((file) =>
      readFileSync(file, "utf8")
        .split("\n")
        .map((line, i) => ({
          line: line.trim(),
          at: `${path.relative(SRC, file)}:${i + 1}`,
        }))
        .filter(({ line }) => !line.startsWith("//") && !line.startsWith("*"))
        .filter(({ line }) => NATIVE.test(line))
        // OverviewPage's local confirm() (from useConfirm) is not window.confirm.
        .filter(({ line }) => !/void confirm\(\)/.test(line))
        .map(({ at }) => at),
    );
    expect(hits).toEqual([]);
  });
});
