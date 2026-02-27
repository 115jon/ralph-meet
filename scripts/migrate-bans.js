// ── Migration: Add server_bans table ────────────────────────────────────────
// Run with: node scripts/migrate-bans.js
//
// Creates the server_bans table for storing user bans per server.

import { execSync } from 'child_process';

const dbName = 'ralph-chat-db';

const sql = `
CREATE TABLE IF NOT EXISTS server_bans (
  server_id TEXT NOT NULL REFERENCES servers(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  reason TEXT,
  banned_by TEXT NOT NULL REFERENCES users(id),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (server_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_server_bans_server ON server_bans(server_id);
`;

console.log("Creating server_bans table...");
execSync(`npx wrangler d1 execute ${dbName} --local --command="${sql.replace(/\n/g, ' ')}"`, { stdio: 'inherit' });
console.log("Done!");
