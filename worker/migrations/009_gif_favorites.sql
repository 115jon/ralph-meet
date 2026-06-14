CREATE TABLE IF NOT EXISTS gif_favorites (
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    provider TEXT NOT NULL,
    gif_id TEXT NOT NULL,
    title TEXT NOT NULL,
    alt_text TEXT,
    query TEXT,
    source_url TEXT NOT NULL,
    aspect_ratio REAL NOT NULL DEFAULT 1,
    preview_url TEXT NOT NULL,
    preview_width INTEGER NOT NULL,
    preview_height INTEGER NOT NULL,
    preview_size_bytes INTEGER NOT NULL DEFAULT 0,
    preview_content_type TEXT NOT NULL,
    send_url TEXT NOT NULL,
    send_width INTEGER NOT NULL,
    send_height INTEGER NOT NULL,
    send_size_bytes INTEGER NOT NULL DEFAULT 0,
    send_content_type TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT,
    PRIMARY KEY (user_id, provider, gif_id)
);

CREATE INDEX IF NOT EXISTS idx_gif_favorites_user_created ON gif_favorites(user_id, created_at DESC);
