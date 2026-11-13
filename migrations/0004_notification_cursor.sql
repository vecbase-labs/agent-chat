-- Owner notification dismissal is independent of exact message receipts.
-- Zero preserves existing reminders until the owner reaches a chat's latest message.
ALTER TABLE conversation_members
  ADD COLUMN dismissed_through_seq bigint NOT NULL DEFAULT 0
  CHECK (dismissed_through_seq >= 0);
