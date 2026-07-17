CREATE INDEX IF NOT EXISTS idx_messages_history_cursor
    ON messages(channel_id, created_at DESC, id DESC);
