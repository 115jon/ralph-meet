#!/usr/bin/env node
// Brings the Worker Previews D1 database up to date before `wrangler preview`.
//
//   node scripts/migrate-preview-d1.mjs
//
// The migrations/ folder starts at 004 and assumes the base tables exist, so
// an empty database cannot be migrated from scratch. The first run on an empty
// database loads d1_schema.sql (the current full schema) and records every
// migration file as applied; every run then applies pending migrations. Keep
// d1_schema.sql in step with migrations/, as for local databases.
//
// Only ever touches the database in wrangler.preview-migrations.toml, and
// refuses to run if that file names the production database.
import { execFileSync } from "node:child_process";
import { readdirSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const CONFIG = "wrangler.preview-migrations.toml";
const BINDING = "PREVIEW_DB";
const PRODUCTION_DATABASE_NAME = "ralph-chat-db";

const configText = readFileSync(path.join(root, CONFIG), "utf8");
const databaseName = /database_name\s*=\s*"([^"]+)"/u.exec(configText)?.[1];
const productionText = readFileSync(path.join(root, "wrangler.toml"), "utf8");
const productionId = new RegExp(
  `database_name\\s*=\\s*"${PRODUCTION_DATABASE_NAME}"\\s*\\n\\s*database_id\\s*=\\s*"([^"]+)"`,
  "u",
).exec(productionText)?.[1];
if (
  !databaseName ||
  databaseName === PRODUCTION_DATABASE_NAME ||
  (productionId && configText.includes(productionId))
) {
  console.error(`${CONFIG} must name the preview database, not production.`);
  process.exit(1);
}

const require = createRequire(path.join(root, "package.json"));
const wranglerBin = path.join(
  path.dirname(require.resolve("wrangler/package.json")),
  "bin",
  "wrangler.js",
);

function wrangler(args, { json = false } = {}) {
  const output = execFileSync(
    process.execPath,
    [wranglerBin, ...args, "--config", CONFIG],
    {
      cwd: root,
      encoding: "utf8",
      stdio: json ? ["ignore", "pipe", "inherit"] : "inherit",
    },
  );
  return json ? JSON.parse(output) : undefined;
}

function query(sql) {
  const result = wrangler(
    ["d1", "execute", BINDING, "--remote", "--json", "--command", sql],
    { json: true },
  );
  return result[0]?.results ?? [];
}

const tables = new Set(
  query("SELECT name FROM sqlite_master WHERE type = 'table'").map(
    (row) => row.name,
  ),
);

if (!tables.has("users")) {
  const recorded = tables.has("d1_migrations")
    ? Number(query("SELECT COUNT(*) AS n FROM d1_migrations")[0]?.n ?? 0)
    : 0;
  if (recorded > 0) {
    console.error(
      `${databaseName} has recorded migrations but no users table; fix it by hand.`,
    );
    process.exit(1);
  }
  console.log(`Bootstrapping empty ${databaseName} from d1_schema.sql`);
  wrangler(["d1", "execute", BINDING, "--remote", "--file", "d1_schema.sql"]);
  const migrations = readdirSync(path.join(root, "migrations"))
    .filter((name) => name.endsWith(".sql"))
    .sort();
  const values = migrations
    .map((name) => `('${name.replaceAll("'", "''")}')`)
    .join(", ");
  // Same table definition that wrangler creates for `d1 migrations`.
  query(
    `CREATE TABLE IF NOT EXISTS d1_migrations(
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT UNIQUE,
      applied_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP NOT NULL
    ); INSERT OR IGNORE INTO d1_migrations (name) VALUES ${values};`,
  );
  console.log(`Recorded ${migrations.length} migrations as applied`);
}

wrangler(["d1", "migrations", "apply", BINDING, "--remote"]);
