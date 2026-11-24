ALTER TABLE enrollments
  ADD COLUMN retry_hash text,
  ADD COLUMN recovery_ciphertext text,
  ADD COLUMN recovery_until timestamptz,
  ADD COLUMN issued_token_hash text;
CREATE INDEX enrollments_recovery_expiry_idx ON enrollments(recovery_until)
  WHERE recovery_until IS NOT NULL;

CREATE TABLE conversation_announcements (
  conversation_id uuid PRIMARY KEY REFERENCES conversations(id) ON DELETE CASCADE,
  text text NOT NULL CHECK (char_length(text) <= 2000),
  version bigint NOT NULL DEFAULT 1 CHECK (version > 0),
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by uuid NOT NULL REFERENCES actors(id)
);
ALTER TABLE conversation_members
  ADD COLUMN announcement_read_version bigint NOT NULL DEFAULT 0
  CHECK (announcement_read_version >= 0);
