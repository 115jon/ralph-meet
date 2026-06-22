CREATE TABLE IF NOT EXISTS myinstants_favorites (
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    sound_id TEXT NOT NULL,
    title TEXT NOT NULL,
    url TEXT NOT NULL,
    color TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    PRIMARY KEY (user_id, sound_id)
);

CREATE INDEX IF NOT EXISTS idx_myinstants_favorites_user_created ON myinstants_favorites(user_id, created_at DESC);
