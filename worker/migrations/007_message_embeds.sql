-- Migration number: 007 	 2026-03-14T10:05:00.000Z

ALTER TABLE messages ADD COLUMN embeds TEXT DEFAULT '[]';
