-- 1. Add missing columns to servers
-- ALTER TABLE servers ADD COLUMN invites_paused INTEGER NOT NULL DEFAULT 0;

-- 2. Add missing columns to invites
-- ALTER TABLE invites ADD COLUMN channel_id TEXT REFERENCES channels(id) ON DELETE SET NULL;
-- ALTER TABLE invites ADD COLUMN temporary INTEGER NOT NULL DEFAULT 0;

-- 3. Create missing channel_permission_overrides table
-- CREATE TABLE IF NOT EXISTS channel_permission_overrides (
--     id TEXT PRIMARY KEY,
--     channel_id TEXT NOT NULL REFERENCES channels(id) ON DELETE CASCADE,
--     target_id TEXT NOT NULL,
--     target_type TEXT NOT NULL CHECK(target_type IN ('role', 'user')),
--     allow INTEGER NOT NULL DEFAULT 0,
--     deny INTEGER NOT NULL DEFAULT 0,
--     created_at TEXT NOT NULL DEFAULT (datetime('now'))
-- );

SELECT 1;
