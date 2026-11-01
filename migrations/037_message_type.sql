-- System messages. NULL = a message someone wrote; 'call' = a DM call's
-- outcome (missed, declined, ended), written by the gateway. `metadata` is
-- the type's JSON (for 'call': call_id, outcome, caller_id, callee_id,
-- duration_s). `content` keeps a plain-text fallback for older clients.
ALTER TABLE messages ADD COLUMN type TEXT;
ALTER TABLE messages ADD COLUMN metadata TEXT;
