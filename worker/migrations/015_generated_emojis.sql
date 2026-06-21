CREATE TABLE IF NOT EXISTS generated_emojis (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    shortcode TEXT NOT NULL,
    prompt TEXT NOT NULL,
    file_key TEXT UNIQUE,
    content_type TEXT,
    size_bytes INTEGER NOT NULL DEFAULT 0,
    status TEXT NOT NULL DEFAULT 'pending',
    error_message TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT
);

CREATE INDEX IF NOT EXISTS idx_generated_emojis_user_created_at
    ON generated_emojis(user_id, created_at DESC);
