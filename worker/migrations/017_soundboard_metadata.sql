ALTER TABLE attachments ADD COLUMN sound_name TEXT;
ALTER TABLE attachments ADD COLUMN sound_emoji TEXT;
ALTER TABLE attachments ADD COLUMN sound_volume REAL DEFAULT 1.0;
