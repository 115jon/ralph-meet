ALTER TABLE servers ADD COLUMN allow_public_shares INTEGER NOT NULL DEFAULT 1;
ALTER TABLE servers ADD COLUMN show_source_in_shares INTEGER NOT NULL DEFAULT 0;
ALTER TABLE servers ADD COLUMN allow_share_indexing INTEGER NOT NULL DEFAULT 0;
ALTER TABLE channels ADD COLUMN allow_public_shares INTEGER;

CREATE TABLE IF NOT EXISTS message_shares (
    id TEXT PRIMARY KEY,
    token TEXT NOT NULL UNIQUE,
    source_message_id TEXT NOT NULL REFERENCES messages(id) ON DELETE CASCADE,
    source_channel_id TEXT NOT NULL REFERENCES channels(id) ON DELETE CASCADE,
    source_server_id TEXT NOT NULL REFERENCES servers(id) ON DELETE CASCADE,
    created_by TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    snapshot_content TEXT NOT NULL,
    snapshot_author TEXT NOT NULL,
    snapshot_attachments TEXT NOT NULL DEFAULT '[]',
    snapshot_embeds TEXT NOT NULL DEFAULT '[]',
    snapshot_reactions TEXT NOT NULL DEFAULT '[]',
    omitted_attachment_count INTEGER NOT NULL DEFAULT 0,
    reply_count INTEGER NOT NULL DEFAULT 0,
    allow_indexing INTEGER NOT NULL DEFAULT 0,
    status TEXT NOT NULL DEFAULT 'active',
    view_count INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    expires_at TEXT,
    revoked_at TEXT,
    deleted_at TEXT
);

CREATE INDEX IF NOT EXISTS idx_message_shares_token ON message_shares(token);
CREATE INDEX IF NOT EXISTS idx_message_shares_created_by ON message_shares(created_by, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_message_shares_source_message ON message_shares(source_message_id);
