-- Index reply lookups used by message formatting and thread counts.
CREATE INDEX IF NOT EXISTS idx_messages_reply_to_id ON messages(reply_to_id);
