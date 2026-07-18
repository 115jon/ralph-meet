ALTER TABLE users ADD COLUMN theme_preference TEXT;
ALTER TABLE users ADD COLUMN theme_sync_enabled INTEGER NOT NULL DEFAULT 0;
