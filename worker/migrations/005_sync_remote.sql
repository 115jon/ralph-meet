-- Migration 005: Align remote with local schema
-- Adds display_name to users

ALTER TABLE users ADD COLUMN display_name TEXT;

-- The 'role' column was removed from server_members in the local schema
-- Uncomment the following line if you'd like to drop it remotely (WARNING: Destructive)
-- ALTER TABLE server_members DROP COLUMN role;
