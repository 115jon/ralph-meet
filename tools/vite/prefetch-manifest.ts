import type { Plugin } from "vite";

/**
 * Writes `prefetch-manifest.json` next to the client build: for each named
 * group, the chunk files (the group's entry chunk and everything it imports
 * statically) a visitor will probably need next. At runtime
 * `src/lib/prefetch.ts` reads it after the page has loaded and asks the
 * browser to download those chunks at idle priority, without running them.
 *
 * A group is matched by source path, so it keeps working when chunk names and
 * hashes change. Routes are matched on their `?tsr-split` component chunk.
 */
export type PrefetchGroups = Record<string, readonly string[]>;

const MANIFEST_FILE = "prefetch-manifest.json";

export function prefetchManifest(groups: PrefetchGroups): Plugin {
  return {
    name: "ralph-prefetch-manifest",
    apply: "build",
    applyToEnvironment: (environment) => environment.name === "client",
    generateBundle(_options, bundle) {
      const chunks = Object.values(bundle).flatMap((output) =>
        output.type === "chunk" ? [output] : [],
      );
      const byFile = new Map(chunks.map((chunk) => [chunk.fileName, chunk]));
      const manifest: Record<string, string[]> = {};

      for (const [group, sources] of Object.entries(groups)) {
        const seeds = chunks.filter((chunk) =>
          chunk.moduleIds.some((id) => {
            const normalized = id.replaceAll("\\", "/");
            return sources.some((source) => normalized.includes(source));
          }),
        );
        if (seeds.length === 0) {
          this.warn(`prefetch group "${group}" matched no chunk`);
          continue;
        }
        const files = new Set<string>();
        const visit = (fileName: string) => {
          if (files.has(fileName)) return;
          const chunk = byFile.get(fileName);
          if (!chunk) return;
          files.add(fileName);
          for (const imported of chunk.imports) visit(imported);
        };
        for (const seed of seeds) visit(seed.fileName);
        manifest[group] = [...files].map((fileName) => `/${fileName}`);
      }

      this.emitFile({
        type: "asset",
        fileName: MANIFEST_FILE,
        source: JSON.stringify(manifest),
      });
    },
  };
}
