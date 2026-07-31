ALTER TABLE attachments ADD COLUMN channel_id TEXT REFERENCES channels(id) ON DELETE CASCADE;

UPDATE attachments
SET channel_id = (
    SELECT messages.channel_id
    FROM messages
    WHERE messages.id = attachments.message_id
)
WHERE message_id IS NOT NULL
  AND soundboard_server_id IS NULL;

UPDATE attachments
SET channel_id = substr(
    file_key,
    length('attachments/') + 1,
    instr(substr(file_key, length('attachments/') + 1), '/') - 1
)
WHERE channel_id IS NULL
  AND soundboard_server_id IS NULL
  AND file_key LIKE 'attachments/%/%'
  AND EXISTS (
      SELECT 1
      FROM channels
      WHERE channels.id = substr(
          attachments.file_key,
          length('attachments/') + 1,
          instr(substr(attachments.file_key, length('attachments/') + 1), '/') - 1
      )
  );
