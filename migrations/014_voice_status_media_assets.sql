CREATE TABLE IF NOT EXISTS voice_status_media_assets (
    id TEXT PRIMARY KEY,
    server_id TEXT NOT NULL REFERENCES servers(id) ON DELETE CASCADE,
    channel_id TEXT NOT NULL REFERENCES channels(id) ON DELETE CASCADE,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    filename TEXT NOT NULL,
    file_key TEXT NOT NULL UNIQUE,
    content_type TEXT NOT NULL,
    preview_width INTEGER NOT NULL,
    preview_height INTEGER NOT NULL,
    size_bytes INTEGER NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_voice_status_media_assets_server_created_at
    ON voice_status_media_assets(server_id, created_at DESC);
