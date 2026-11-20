-- Personal edition baseline (0.2.0). Not compatible with the unreleased 0.1 prototype.
-- Future releases append migrations; never edit an installed personal baseline.
CREATE TABLE ac_user (
  id text PRIMARY KEY, name text NOT NULL, email text NOT NULL UNIQUE,
  "emailVerified" boolean NOT NULL DEFAULT false, image text,
  "createdAt" timestamptz NOT NULL DEFAULT now(), "updatedAt" timestamptz NOT NULL DEFAULT now(),
  username text UNIQUE, "displayUsername" text
);
CREATE TABLE ac_session (
  id text PRIMARY KEY, "expiresAt" timestamptz NOT NULL, token text NOT NULL UNIQUE,
  "createdAt" timestamptz NOT NULL DEFAULT now(), "updatedAt" timestamptz NOT NULL DEFAULT now(),
  "ipAddress" text, "userAgent" text, "userId" text NOT NULL REFERENCES ac_user(id) ON DELETE CASCADE
);
CREATE INDEX ac_session_user_idx ON ac_session("userId");
CREATE TABLE ac_account (
  id text PRIMARY KEY, "accountId" text NOT NULL, "providerId" text NOT NULL,
  "userId" text NOT NULL REFERENCES ac_user(id) ON DELETE CASCADE,
  "accessToken" text, "refreshToken" text, "idToken" text,
  "accessTokenExpiresAt" timestamptz, "refreshTokenExpiresAt" timestamptz,
  scope text, password text,
  "createdAt" timestamptz NOT NULL DEFAULT now(), "updatedAt" timestamptz NOT NULL DEFAULT now(),
  UNIQUE ("providerId", "accountId")
);
CREATE INDEX ac_account_user_idx ON ac_account("userId");
CREATE TABLE ac_verification (
  id text PRIMARY KEY, identifier text NOT NULL, value text NOT NULL, "expiresAt" timestamptz NOT NULL,
  "createdAt" timestamptz NOT NULL DEFAULT now(), "updatedAt" timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ac_verification_identifier_idx ON ac_verification(identifier);
CREATE TABLE ac_rate_limit (id text PRIMARY KEY, key text NOT NULL UNIQUE, count integer NOT NULL, "lastRequest" bigint NOT NULL);

CREATE TABLE actors (
  id uuid PRIMARY KEY, user_id text UNIQUE REFERENCES ac_user(id),
  kind text NOT NULL CHECK (kind IN ('human','agent')),
  owner_id uuid,
  name text NOT NULL CHECK (length(name) BETWEEN 1 AND 80),
  description text NOT NULL DEFAULT '',
  token_hash text UNIQUE, disabled_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK ((kind='human' AND user_id IS NOT NULL AND owner_id IS NULL AND token_hash IS NULL)
    OR (kind='agent' AND user_id IS NULL AND owner_id IS NOT NULL))
);
CREATE TABLE instance (
  id integer PRIMARY KEY CHECK (id=1), name text NOT NULL DEFAULT 'Agent Chat',
  owner_id uuid NOT NULL UNIQUE REFERENCES actors(id),
  initialized_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX actors_single_person_idx ON actors(kind) WHERE kind='human';
ALTER TABLE actors ADD CONSTRAINT actors_owner_fk FOREIGN KEY(owner_id) REFERENCES instance(owner_id);
CREATE INDEX actors_owner_idx ON actors(owner_id) WHERE owner_id IS NOT NULL;

CREATE TABLE conversations (
  id uuid PRIMARY KEY, kind text NOT NULL CHECK (kind IN ('direct','group')),
  name text NOT NULL CHECK (length(name) BETWEEN 1 AND 100),
  created_by uuid NOT NULL REFERENCES actors(id),
  owner_id uuid NOT NULL REFERENCES instance(owner_id),
  direct_key text UNIQUE,
  last_seq bigint NOT NULL DEFAULT 0 CHECK (last_seq>=0),
  created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK ((kind='direct' AND direct_key IS NOT NULL) OR (kind='group' AND direct_key IS NULL))
);
CREATE TABLE conversation_members (
  conversation_id uuid NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  actor_id uuid NOT NULL REFERENCES actors(id), last_read_seq bigint NOT NULL DEFAULT 0 CHECK(last_read_seq>=0),
  read_ranges nummultirange NOT NULL DEFAULT '{}',
  joined_at timestamptz NOT NULL DEFAULT now(), PRIMARY KEY(conversation_id,actor_id)
);
CREATE INDEX conversation_members_actor_idx ON conversation_members(actor_id,conversation_id);
CREATE TABLE messages (
  id uuid PRIMARY KEY, conversation_id uuid NOT NULL REFERENCES conversations(id),
  seq bigint NOT NULL CHECK(seq>0), sender_id uuid NOT NULL REFERENCES actors(id),
  text text NOT NULL CHECK(length(text)<=20000),
  reply_to uuid REFERENCES messages(id),
  idempotency_key text NOT NULL CHECK(length(idempotency_key) BETWEEN 8 AND 100),
  request_hash text NOT NULL, created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(conversation_id,seq), UNIQUE(sender_id,idempotency_key)
);
CREATE TABLE message_mentions (
  message_id uuid NOT NULL REFERENCES messages(id) ON DELETE CASCADE,
  actor_id uuid NOT NULL REFERENCES actors(id), PRIMARY KEY(message_id,actor_id)
);
CREATE INDEX message_mentions_actor_idx ON message_mentions(actor_id,message_id);
CREATE TABLE files (
  id uuid PRIMARY KEY, conversation_id uuid NOT NULL REFERENCES conversations(id),
  uploader_id uuid NOT NULL REFERENCES actors(id), message_id uuid REFERENCES messages(id),
  name text NOT NULL CHECK(length(name)<=240), mime_type text NOT NULL,
  bytes integer NOT NULL CHECK(bytes>0), sha256 text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX files_message_idx ON files(message_id);
CREATE TABLE enrollments (
  id uuid PRIMARY KEY, actor_id uuid NOT NULL REFERENCES actors(id),
  code_hash text NOT NULL UNIQUE, expires_at timestamptz NOT NULL,
  consumed_at timestamptz, created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE request_limits (
  key text PRIMARY KEY, bucket timestamptz NOT NULL, count integer NOT NULL
);

CREATE INDEX files_uploader_idx ON files(uploader_id);
CREATE INDEX enrollments_actor_idx ON enrollments(actor_id);
CREATE INDEX messages_reply_idx ON messages(reply_to) WHERE reply_to IS NOT NULL;
CREATE INDEX conversations_updated_idx ON conversations(updated_at DESC,id DESC);
CREATE INDEX conversations_owner_updated_idx ON conversations(owner_id,updated_at DESC,id DESC);
