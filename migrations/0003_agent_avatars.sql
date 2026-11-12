ALTER TABLE actors
  ADD COLUMN avatar_id uuid,
  ADD COLUMN avatar_sha256 text,
  ADD COLUMN avatar_bytes integer,
  ADD CONSTRAINT actors_avatar_metadata CHECK (
    (avatar_id IS NULL AND avatar_sha256 IS NULL AND avatar_bytes IS NULL)
    OR (kind = 'agent' AND avatar_id IS NOT NULL AND avatar_sha256 IS NOT NULL
      AND avatar_bytes IS NOT NULL AND avatar_bytes BETWEEN 1 AND 262144
      AND avatar_sha256 ~ '^[a-f0-9]{64}$')
  );

CREATE UNIQUE INDEX actors_avatar_id ON actors(avatar_id) WHERE avatar_id IS NOT NULL;
