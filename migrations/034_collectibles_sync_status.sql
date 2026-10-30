-- Health record for the collectibles catalog sync (one row per source).
-- Written on every attempt (cron / manual / request) so freshness and the
-- last error are visible without log sampling. The runtime also creates this
-- table on first use (CREATE TABLE IF NOT EXISTS), so applying it is safe
-- before or after deploy.
CREATE TABLE IF NOT EXISTS collectible_catalog_sync_status (
    source TEXT PRIMARY KEY,
    last_attempt_at TEXT,
    last_success_at TEXT,
    last_failure_at TEXT,
    last_error TEXT,
    last_outcome TEXT,
    consecutive_failures INTEGER NOT NULL DEFAULT 0,
    item_count INTEGER NOT NULL DEFAULT 0,
    category_count INTEGER NOT NULL DEFAULT 0,
    counts_json TEXT,
    last_trigger TEXT,
    last_duration_ms INTEGER
);
