-- Preserve the original creation request even when group membership changes.
ALTER TABLE conversations
  ADD COLUMN creation_key text,
  ADD COLUMN creation_hash text,
  ADD CONSTRAINT conversations_creation_request_check CHECK (
    (creation_key IS NULL AND creation_hash IS NULL)
    OR (creation_key IS NOT NULL AND creation_hash IS NOT NULL
      AND length(creation_key) BETWEEN 8 AND 100 AND length(creation_hash)=64)
  );
CREATE UNIQUE INDEX conversations_creation_key_idx
  ON conversations(created_by,creation_key) WHERE creation_key IS NOT NULL;
