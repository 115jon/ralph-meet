-- Migration 004: Invite enhancements
-- Adds channel_id and temporary to invites, invites_paused to servers

ALTER TABLE invites ADD COLUMN channel_id TEXT REFERENCES channels(id) ON DELETE SET NULL;
ALTER TABLE invites ADD COLUMN temporary INTEGER NOT NULL DEFAULT 0;
ALTER TABLE servers ADD COLUMN invites_paused INTEGER NOT NULL DEFAULT 0;
