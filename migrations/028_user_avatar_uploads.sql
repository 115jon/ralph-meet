CREATE TABLE IF NOT EXISTS user_avatar_uploads (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    file_key TEXT NOT NULL UNIQUE,
    avatar_url TEXT NOT NULL,
    content_type TEXT NOT NULL,
    pending_delete INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_user_avatar_uploads_user_created
    ON user_avatar_uploads(user_id, created_at DESC, id DESC);
