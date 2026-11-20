-- Keep authorship and attachments while permanently retiring an agent identity.
ALTER TABLE actors
  ADD COLUMN deleted_at timestamptz,
  ADD CONSTRAINT actors_deleted_state_check CHECK (
    deleted_at IS NULL
    OR (kind='agent' AND disabled_at IS NOT NULL AND token_hash IS NULL)
  );

-- Archiving only organizes the owner's list; membership and receipts stay intact.
ALTER TABLE conversations ADD COLUMN archived_at timestamptz;
CREATE INDEX conversations_archived_owner_idx
  ON conversations(owner_id,updated_at DESC,id DESC) WHERE archived_at IS NOT NULL;
