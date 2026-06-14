ALTER TABLE attachments ADD COLUMN soundboard_server_id TEXT REFERENCES servers(id) ON DELETE CASCADE;

CREATE INDEX IF NOT EXISTS idx_attachments_soundboard_server_id ON attachments(soundboard_server_id, created_at DESC);
