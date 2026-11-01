-- How a device wants its pushes. NULL = legacy app: a system-rendered
-- notification+data push. 'native' = the app renders data-only pushes itself
-- (and clears them when the channel is read on another device).
ALTER TABLE push_tokens ADD COLUMN push_format TEXT;
