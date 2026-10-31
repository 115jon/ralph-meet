#!/usr/bin/env node
// Writes dist/server/wrangler.preview.json for `wrangler preview`.
//
//   pnpm run build
//   node scripts/write-preview-config.mjs
//   pnpm exec wrangler preview --config dist/server/wrangler.preview.json
//
// `vite build` writes dist/server/wrangler.json (with the `previews` block),
// which `wrangler deploy` and `wrangler preview` both use by default. Previews
// replay the top-level Durable Object migrations into a new, empty namespace,
// and the production history includes a step that transferred the classes in
// from the retired `ralph-meet-do` Worker. That source no longer has them, so
// the transfer fails for every new Preview (API error 10074). The copy written
// here replaces each cross-Worker transfer with creating the destination class
// as a new SQLite class, under the same tag, so later production migrations
// still apply to existing Previews in order. Production keeps wrangler.json.
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const source = path.join(root, "dist", "server", "wrangler.json");
const target = path.join(root, "dist", "server", "wrangler.preview.json");

const config = JSON.parse(readFileSync(source, "utf8"));
if (!config.previews) {
  console.error(`${source} has no previews block; check wrangler.toml.`);
  process.exit(1);
}

let rewritten = 0;
config.migrations = (config.migrations ?? []).map((migration) => {
  const { transferred_classes: transfers, ...rest } = migration;
  if (!transfers?.length) return migration;
  rewritten += transfers.length;
  return {
    ...rest,
    new_sqlite_classes: [
      ...(rest.new_sqlite_classes ?? []),
      ...transfers.map((transfer) => transfer.to),
    ],
  };
});

writeFileSync(target, `${JSON.stringify(config, null, 2)}\n`);
console.log(
  `Wrote ${path.relative(root, target)} (${rewritten} Durable Object transfer(s) replaced for Previews)`,
);
