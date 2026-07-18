CREATE TABLE IF NOT EXISTS collectible_catalog_cache (
    source TEXT PRIMARY KEY,
    payload TEXT NOT NULL,
    etag TEXT,
    category_count INTEGER NOT NULL DEFAULT 0,
    item_count INTEGER NOT NULL DEFAULT 0,
    synced_at TEXT NOT NULL
);
