-- Preflight before applying to an existing database:
-- SELECT lower(username), COUNT(*) FROM users GROUP BY lower(username) HAVING COUNT(*) > 1;
-- Resolve any duplicate groups before applying this migration.
CREATE UNIQUE INDEX IF NOT EXISTS idx_users_username_lower
    ON users(lower(username));
