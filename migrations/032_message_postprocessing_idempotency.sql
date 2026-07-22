ALTER TABLE messages ADD COLUMN content_revision INTEGER NOT NULL DEFAULT 0;
ALTER TABLE notifications ADD COLUMN dedupe_key TEXT;
ALTER TABLE r2_cleanup_jobs ADD COLUMN next_attempt_at TEXT NOT NULL DEFAULT '';

CREATE TABLE IF NOT EXISTS message_postprocessing_jobs (
    message_id TEXT NOT NULL REFERENCES messages(id) ON DELETE CASCADE,
    revision INTEGER NOT NULL,
    channel_id TEXT NOT NULL REFERENCES channels(id) ON DELETE CASCADE,
    notify INTEGER NOT NULL DEFAULT 1,
    attempts INTEGER NOT NULL DEFAULT 0,
    next_attempt_at TEXT NOT NULL DEFAULT (datetime('now')),
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    PRIMARY KEY (message_id, revision)
);

CREATE TABLE IF NOT EXISTS notification_delivery_markers (
    dedupe_key TEXT PRIMARY KEY,
    message_id TEXT NOT NULL REFERENCES messages(id) ON DELETE CASCADE,
    notification_id TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS notification_clear_watermarks (
    user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
    cleared_at TEXT NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_notifications_dedupe_key
    ON notifications(dedupe_key) WHERE dedupe_key IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_message_postprocessing_jobs_created
    ON message_postprocessing_jobs(created_at ASC);
CREATE INDEX IF NOT EXISTS idx_notification_delivery_markers_message
    ON notification_delivery_markers(message_id);
