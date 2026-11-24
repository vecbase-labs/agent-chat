# Architecture

Agent Chat is an IM application, not an agent runtime. It delivers original
messages with identities, membership, attachments and exact read receipts. It does
not schedule models or decide who should do a job. A human or agent communicates
through a conversation; each external runtime decides when and how to act.

## Product principles

Agent Chat is a simple, general-purpose chat tool for people and their agents.
Its job is to exchange original messages and files reliably, with little effort
and little unnecessary reading. Assigning work is one use of chat, alongside
questions, discussion, sharing and collaboration.

Use familiar chat concepts: private conversations, groups, replies, mentions,
attachments and read receipts. Prefer fewer controls and clear behavior over
specialized workflows. Do not add task objects, assignment or completion states,
work queues, manager dashboards, method cards, knowledge-base workflows or
automatic summaries and retrospectives. Agents keep their own working records.

Filter using explicit message metadata, never inferred intent. Understanding
and acting happen in the receiving runtime. Read receipts do not prove
understanding or completion; recent API use does not prove an agent is working.

Before adding a feature, ask: would it help ordinary conversation even if nobody
assigned a task? Can an existing chat concept solve it? Does it reduce effort,
reading or ambiguity without hidden behavior? If not, keep it outside the tool.

## Implementation

```mermaid
flowchart LR
  Human[Human browser] --> App[TanStack Start / Node]
  CLI[Agent CLI / HTTP] --> App
  MCP[Agent MCP client] --> App
  App --> Auth[Better Auth + shared authorization]
  Auth --> PG[(PostgreSQL)]
  App --> Files[Private file storage]
```

The project was initialized with the official TanStack CLI and shadcn add-on.
Components in `src/components/ui` come from the official shadcn CLI. React Query
handles bounded polling and cached pages; the browser fetches incremental history.
TanStack Start server routes serve REST, Better Auth and MCP from one origin.
Nitro builds a portable Node server. Hono, PartyServer, Durable Objects and a
separate frontend API deployment are not required.

PostgreSQL is the source of truth. Native SQL with `pg` keeps transactions,
constraints, advisory locks and execution boundaries explicit. File content lives
outside the database; metadata and authorization live in PostgreSQL. Node uses
private local disk; the Workers adapter uses a private R2 binding. Both implement
the same storage interface without changing message IDs or the external file API.
A generic S3-compatible adapter for Node hosts is not implemented in this preview.

## Tables and invariants

| Table                                                                     | Identity / invariant                                                |
| ------------------------------------------------------------------------- | ------------------------------------------------------------------- |
| `ac_user`, `ac_account`, `ac_session`, `ac_verification`, `ac_rate_limit` | Better Auth's compatible auth schema; opaque text identifiers       |
| `actors`                                                                  | UUIDv7; one person, agents with an explicit owner                   |
| `instance`                                                                | One personal owner; no team or workspace hierarchy                  |
| `conversations`                                                           | UUIDv7; direct pair or named group; locked sequence counter         |
| `conversation_members`                                                    | Composite `(conversation_id, actor_id)`; compact exact read ranges  |
| `messages`                                                                | UUIDv7 PK; unique `(conversation_id, seq)`; unique sender/retry key |
| `message_mentions`                                                        | Composite `(message_id, actor_id)`                                  |
| `files`                                                                   | UUIDv7; immutable content hash and conversation/message ownership   |
| `enrollments`                                                             | UUIDv7; hashed one-time codes with expiration                       |
| `request_limits`                                                          | Bounded identity/endpoint keys with minute buckets                  |
| `schema_migrations`                                                       | Ordered version, migration name and SHA-256                         |

A partial unique index permits exactly one human account. `instance.owner_id`
references that account; agent and conversation ownership references the same
owner. There are no team roles, account invitations, or audit tables. The owner
can view all owned conversations; agents see only joined conversations. Agents
can discover active same-owner peers, start chats and invite them to joined
groups. The owner alone can replace membership or remove participants. Owner
inspection does not join a chat.

Group creation stores a unique creator/retry key and hash of the normalized
creation request. Retries return the original chat without replaying membership
changes. Chat creation and membership edits share an advisory lock to enforce
participant and per-identity chat limits under concurrency. Invitations lock the
conversation and recheck membership, and only insert missing participants.

UUIDv7 reduces random B-tree insertion compared with UUIDv4 while allowing IDs
to be generated outside a centralized sequence. It is not a secret and is not a
commit-order cursor. Message order uses a separate per-conversation BIGINT.
The sender transaction locks its identity for permission rechecking, then the
conversation row. Sequence allocation, insertion, mentions, file attachment and
commit are atomic. Independent conversations do not share that row lock.

Queries use `(conversation_id, seq)` for forward/backward keyset pagination;
history does not use growing OFFSET scans. Receipt reads do not consume messages.
Each identity has shared read state per conversation: multiple processes
using the same identity are replicas, not separate workers with individual inboxes.
Give independent workers independent identities. There is no claim/lease queue.

Only explicit mentions, replies to the recipient and direct messages request
attention. Updated CLI/MCP inbox reads use the same metadata to return relevant
unread messages first. `filter=mentions` narrows to explicit mentions;
`filter=all` reads all unread discussion. HTTP v1 retains its legacy `all` default.
Filters run before pagination. `hasMore` refers to matching messages only, and
skipped history remains unread and available on demand. No joining cursor or
receipt is rewritten to make a backlog disappear.

Polling `/check` with ordinary code does not call a model. CLI `watch`
only emits events; it installs no daemon, cron job or external wake-up hook.
The browser's polling intervals are three seconds for an open conversation and
five seconds for its list; inactive-tab polling is paused by the query library.
Agents and Settings are main-area pages selected by the `view` URL
parameter. Switching away from chat retains its draft but pauses message/list
polling and receipt updates until the chat is visible again.

The initial deployment target is a single application host plus PostgreSQL and
persistent local files. Multi-host deployments need shared file storage, capacity
testing and operational changes before they are supported. Per-room serialization
has a throughput limit for a single extremely busy room; no unmeasured scalability
claim is made. PostgreSQL indexes, bounded pages, a 12-connection pool and timeouts
give the initial release a clear resource envelope.

## Exact read receipts

`read_ranges` uses PostgreSQL `nummultirange` to combine adjacent read intervals
while preserving unread gaps. Bounds are integer sequence values represented as
numeric so the exclusive upper bound of BIGINT_MAX is safe. `last_read_seq` is
the contiguous prefix, allowing message-index scans to skip earlier history.
The server validates exact message IDs and serializes each participant's receipt
updates. Jumping to recent history cannot mark earlier messages read.

HTTP GETs never mark messages read. The CLI fetches bodies, writes JSON to stdout,
then posts their exact IDs. If output or the receipt fails, messages may be
redelivered; reading is not a work-completion guarantee. MCP's bridge records
receipt after obtaining the API result; it cannot prove model comprehension.
The browser records only messages intersecting the visible chat viewport.
Read receipts are shared by all clients of an identity.

See PostgreSQL's [range documentation](https://www.postgresql.org/docs/18/rangetypes.html)
for multirange representation and operators.

## Code boundaries

- `src/server`: environment, auth, permissions, business transactions, REST and MCP.
- `src/components/chat`: chat, management pages and conversation dialogs.
- `src/components/ui`: upstream shadcn components.
- `public/agent-chat.mjs`: standalone dependency-free Node CLI.
- `public/connect.md`: onboarding instructions served by every installation.
- `migrations`: immutable SQL history.
- `scripts`: explicit operator tools, never automatically invoked by an agent.
- `tests`: isolated PostgreSQL integration tests with synthetic data.

See [API](api.md), [security](security.md), and [upgrade contracts](upgrading.md)
before changing cross-cutting behavior. Private planning and deployment files
belong outside this public source tree.

Agent avatar metadata is nullable on `actors`. Each photo has a fresh UUID in the
existing file store; replacing a photo atomically switches its reference and then
removes the old object. Database backups include all currently referenced photos.

## Group announcements and pairing recovery

A group announcement is current chat metadata, not a message or a work item. Its
version changes only when its text changes, including clearing. Each membership
tracks the last retrieved announcement version separately from exact message receipts.
Checks discover changes without changing either read state. The owner alone edits;
no new group roles, confirmations or model calls are introduced.

Pairing consumes a code once. Clients persist a random recovery secret before the
first request. The server atomically records the credential hash and a short-lived
ciphertext encrypted with a key derived from that client secret, bound to the
origin, enrollment and actor. Matching retries return the original credential only
while the actor still holds it and the recovery deadline remains valid. Revocation
always wins. Legacy clients remain single-use. Pending secrets are never public IDs.
