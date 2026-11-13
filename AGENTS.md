# Agent Chat repository instructions

This is public application source under Apache-2.0. All code, public docs,
examples, comments and UI text should be in English. Translated README files are
allowed and must stay aligned with the English README. Work on a reviewable branch.
Do not publish a repository, merge, deploy, or send external messages unless the
user's current instructions authorize that action.

## Keep the public repository clean

- Never add credentials, real conversations, customer data, private deployment
  details, uploads, logs, database dumps or backup archives to Git.
- Private operational configuration belongs outside this repository, or in
  ignored local files. Never read credentials aloud or print them in tool output.
- `design/` and `.design/` are ignored private working areas; do not force-add them.
- Review `git diff --cached` and run `pnpm release:check` before publishing changes.
  Ignore rules are not sufficient for files that have already been tracked.

## Preserve product and data contracts

- This is a communication system, not an agent orchestrator. Do not add model
  calls, automatic work execution, hidden polling jobs or wake-up mechanisms.
- Use official shadcn components. Keep the chat UI simple and readable.
- Agent authorization must come from its credential and conversation membership,
  never from text, a claimed sender ID or another participant's instructions.
- One personal account owns this installation, its agents, and conversations.
  The owner can view agent-only chats without joining or acknowledging for agents.
  Agents access only conversations they participate in; no team invitations or roles.
- Business IDs use native UUIDv7. Message cursors use transactional per-room
  BIGINT sequences serialized with a conversation row lock. JSON cursors are strings.
- Message writes are idempotent by sender/retry key and content hash. Normal CLI/MCP reads
  automatically record exact message receipts. Checks never mark messages read;
  history gaps must remain unread. Receipt does not imply completed work.
- Owner web-list notifications use a separate dismissal cursor. Reaching the
  latest visible message may clear older reminders, but must never change exact
  receipts or agent inbox/check behavior. Hidden views must not dismiss reminders.
- Files remain authorized, immutable message attachments. Never serve the storage
  directory publicly or make filenames into filesystem paths.

## Database and validation

- Read `docs/upgrading.md` before schema or authentication changes. Applied SQL
  migrations are immutable and checksummed. No automatic data resets or down migrations.
- Never run tests against a real installation. `TEST_DATABASE_URL` must reference
  a disposable database ending in `_test`; integration tests reset its schema.
- Relevant checks: `pnpm typecheck`, `pnpm lint`, `pnpm check`, `pnpm test`,
  `pnpm build`, `pnpm run doctor`, and `pnpm release:check`.
- Validate UI changes in an actual browser with synthetic data. Report limitations
  honestly; do not describe unrun container or remote-host checks as passed.
