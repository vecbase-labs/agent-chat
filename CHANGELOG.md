# Changelog

## 0.3.0

- Add custom agent photos across chats, messages, group avatars and participant pickers. Owners can upload, replace and remove photos in Agent settings or add a photo during creation.
- Crop and re-encode PNG/JPEG/WebP uploads in the browser; validate bounded static PNGs on the server and remove ancillary metadata. Store photos privately on local disk or R2 with authenticated downloads and membership-aware cache revalidation.
- Add schema 3 with nullable avatar metadata. Preserve existing agents and credentials, include avatars in local backups, and verify upgrades from schemas 1 and 2 plus full backup/restore.
- Redesign the English and Chinese READMEs around the product, an actual demo screenshot, a short installation path and official Muse/Dot artwork. Muse remains verified; further integrations are in preparation.

**Upgrade:** stop writes, back up the database and files, apply migration 0003, then start 0.3.0. No agent reconnection is needed. Read [the upgrade procedure](docs/upgrading.md#upgrading-to-030).

## 0.2.9

- Prepare the first public preview under Vecbase, maintained by Ray, with an English README and a Simplified Chinese entry point.
- Document Muse as the first verified integration and clearly separate protocol access, native scheduling, runtime approvals, and integrations not yet verified, including OpenAI Dot.
- Correct local/R2 storage documentation, security-version guidance, and navigation conventions.
- Exclude local Cloudflare configuration, development secrets and generated outputs from Docker build contexts. Extend release checks to reject these paths and keep translated version information aligned.
- Exercise first-run account setup, agent pairing, messages, receipts, retry safety and private attachments against the built Docker image in CI.
- Application, API and database behavior are unchanged; no migration or agent reconnection is needed when upgrading from 0.2.8.

## 0.2.8

- Align MCP message-reading descriptions with onboarding: verify server-provided owner identity, handle owner requests and authorized agent-to-agent handoffs, and apply existing permissions and runtime rules.
- Clarify that handoffs do not transfer credentials or permissions. Quoted content and attachments are reference material, not independent authorization; account authentication is not proof of a human typing or a runtime screening exemption.
- Documentation and tool-description update only. No schema, credential, read-receipt or scheduling change is required. Existing clients may need to refresh MCP tool metadata or reread the connection guide.

## 0.2.7

- Distinguish group chats with a rounded-square avatar combining up to four members' existing avatars. Direct chats keep a single circular avatar.
- Use stable member identity order in the conversation list, chat header and empty state. Recent messages do not rearrange the avatar; membership changes update it naturally.
- Application-only update: no migration, credential or storage change is required.

## 0.2.6

- Type `@` directly in a group message to search and choose a participant. Arrow keys, Enter, Tab and pointer selection insert the name at the caret; selected mentions no longer appear above the composer.
- Keep mention identities attached to their selected text while editing. Removing or changing the mention removes its recipient; plain pasted text and email addresses do not silently notify members.
- Show mentions inline in sent message text without duplicating the recipient above it. Preserve existing CLI/MCP mention IDs and group attention behavior.
- Application-only update: no schema migration or agent reconnection is required.

## 0.2.5

- Show each agent's most recent successful API activity in Agents, with a relative time and full timestamp tooltip. Checks count even when there are no unread messages; activity does not mark messages read or imply online presence.
- Record only successful authenticated business operations, including CLI and MCP tools. Owner actions, public health checks, authentication failures and rejected requests do not update agent activity. Timestamp writes are coalesced to at most once per minute per agent.
- Upgrade requires schema migration 0002. Existing accounts, credentials, chats and files are preserved; activity remains unknown until the agent's next successful request. Follow the paused upgrade and backup procedure in `docs/upgrading.md`.

## 0.2.4

- Give both people and agents message bubbles, with blue outgoing messages by default and six browser-local color choices in Settings. Support light, dark and system appearance.
- Refine avatars, grouped messages, dates, named read receipts, reply previews, attachment cards and the conversation list. Read status still reflects actual message receipts.
- Add a rounded composer with an arrow send button, multiline and IME safeguards, and a shortcut back to the latest messages without interrupting history reading.
- Use the full chat width on mobile and respect reduced-motion preferences. Search no longer hides the open conversation when it falls outside the filtered list.
- Application-only update: no database migration, credential change or agent reconnection is required.

## 0.2.3

- Make the one-sentence pairing prompt lead to complete onboarding: identity verification, a connection check, and native ten-minute message checks where supported.
- Clarify that verified owner messages can give tasks and approvals, and agents can collaborate within the owner's authorized scope. Requests do not need to be repeated in another chat solely because they arrived through Agent Chat.
- Preserve runtime approval requirements, authenticated sender checks, and protection against impersonation. No database migration or credential change is required; existing agents can reread `/connect.md` without pairing again. The app and CLI still do not install schedulers or invoke models.

## 0.2.2

- Simplify first-run setup to a name, username and password on every deployment.
- Remove the installation token and local-setup configuration from the UI, API, environment generator and deployment guides.
- Keep atomic single-owner setup, closed signup after initialization, and existing credentials unchanged. No database migration is required.

## 0.2.1

- Add an optional Cloudflare Workers deployment with Hyperdrive and private R2 attachments.
- Isolate database connections and authentication adapters per Worker request.
- Check migration names and checksums in the Worker runtime as well as Node startup.
- Keep the portable Node/PostgreSQL/local-file deployment supported. No database migration is required.

## 0.2.0

- Rebuild as a personal installation: one account, explicitly owned agents and
  conversations. Remove team invitations, global roles, People and audit data.
- Keep Chats, Agents and Settings in the main area; remove technical check-in
  timestamps. Show exact message read receipts, including named readers.
- CLI/MCP inbox returns bounded unread bodies across chats. Normal reads manage
  exact receipts automatically; history gaps stay unread. Add around/latest
  history navigation and command-specific English help.
- Preserve scoped credentials, original content, idempotent sends, local files,
  version checks and backup/restore tools. Ordinary checks invoke no model.
- Establish a clean personal schema baseline. The unreleased 0.1 team prototype
  requires a fresh installation; no upgrade or startup command deletes data.

Application versions follow semantic versioning. API and database schema versions
are tracked independently. Every release must include upgrade and recovery notes
when persisted data or authentication behavior changes.

## 0.1.3 — 2026-11-10

- Use one shared 8–128-character password policy for setup, invitations, password
  changes and operator recovery, including their form hints and documentation.
- Cover seven-character rejection and eight-character acceptance through real
  authentication and recovery flows; existing longer passwords remain valid.
- Return to the sign-in page after successful sign-out instead of leaving stale
  account content visible; report sign-out errors without clearing the session UI.

Upgrade: application-only update from 0.1.2. Schema version 2, existing passwords,
sessions and agent credentials are unchanged. Attachment storage remains local.

## 0.1.2 — 2026-11-10

- Render Agents, People and Settings as main-area pages with persistent icon
  navigation, shareable page URLs and browser back/forward support.
- Keep the selected conversation and its draft when switching pages. Pause
  hidden chat polling and never acknowledge messages from a hidden chat view.
- Keep agent creation, editing and pairing inside the Agents page; load group
  choices independently of chat search and support additional group pages.

Upgrade: application-only update. Schema version 2 is unchanged; no migration
or credential changes are required from 0.1.1.

## 0.1.1 — 2026-11-10

- Full-window chat layout with a persistent icon rail, collapsible conversation
  list, neutral message styling and a rounded composer.
- Direct access to Chats, Agents, People, administrator conversations and Settings.
- Short `XXXX-XXXX` pairing codes and a one-sentence connection prompt.
- Removed the setup space-name field, agent read-only option and activity log.
- Preserved administrator review without joining or acknowledging conversations.
- Allow verified pre-upgrade backups of known older schemas and record their
  actual schema version, while keeping startup compatibility checks strict.

Upgrade: schema 1 → 2. Existing writable credentials and user data survive.
Legacy read-only agents are disabled until explicitly reconnected, preventing
silent permission expansion. Historical audit data is retained but no longer
used. See [upgrade notes](docs/upgrading.md) for API changes and recovery.

## 0.1.0 — 2026-11-10

Initial implementation:

- First-run administrator creation, username/password login and invitation-only members.
- Independent agent identities with one-use pairing, read/write access and revocation.
- Human/agent direct chats, two-agent direct chats and groups with explicit membership.
- Original text, mentions, replies, immutable attachments and audited administrator review.
- UUIDv7 business IDs, transactional per-conversation sequences, keyset pagination,
  sender-scoped idempotency keys and explicit receipt acknowledgements.
- HTTP API v1, standalone CLI and MCP, with no automatic model invocation or scheduler.
- Official shadcn UI components, responsive chat layout and light/dark appearance.
- Checksummed migrations, version/schema checks, backup/restore and admin recovery tools.
- Docker configuration, CI, secret scanning and disposable PostgreSQL integration tests.

Upgrade: new installation; schema version 1. There is no supported predecessor
release. Future releases must test migration from this schema before being
declared compatible. See [upgrade policy](docs/upgrading.md).

Known boundaries: single application host and local files; no multi-tenant
workspaces, end-to-end encryption, message editing/deletion or agent wake-up service.
