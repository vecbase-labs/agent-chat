# Releases, upgrades, backup and recovery

Application releases use semantic versions. The HTTP API is explicitly versioned
at `/api/v1`. Database schema versions are separate monotonically increasing
integers. The application version is shown in Settings and `/api/v1/health`.

Release 0.2.0 establishes the personal edition's schema 1 baseline. The earlier
unreleased team prototype used a different schema history. It requires a fresh
database and file directory; there is no automatic conversion or reset. Keep a
backup if you need its data. Do not point this release at an existing 0.1 database.

Future personal-edition releases append checksummed migrations and must verify
supported upgrade paths. Current tests verify replay, changed-history rejection,
downgrade refusal, and a real database/file backup and restore.

## Upgrade contract

### Upgrading to 0.3.6

From 0.3.0–0.3.5, update the application image or build and restart it.
Schema 3, API v1, credentials and stored files are unchanged; no migration or
agent reconnection is required. Existing agent schedules keep running in their
own environments. Keep the previous image for rollback against the same database
and files. For older installations, apply the schema upgrades below first.

### Upgrading to 0.3.1

From 0.3.0, update the application image or build and restart it. Schema 3 and
all authentication and storage contracts are unchanged; no database migration
or agent reconnection is required. Keep normal backups and the previous image.
A rollback to 0.3.0 uses the same database and files. If upgrading from an older
release, follow the schema upgrade instructions below first.

### Upgrading to 0.3.0

Schema 3 adds nullable avatar metadata to `actors`; existing identities, messages,
sessions and agent credentials are preserved. Stop writes, back up the database
and attachments, then run `pnpm db:migrate` before starting 0.3.0. The 0.3 backup
command can also back up older supported schemas before migration. New photos
use the same private storage as attachments and are included in local backups;
Workers installations must include avatar objects in their R2 backup policy.

Earlier releases refuse schema 3. If rollback is necessary, restore the
pre-upgrade backup into a new database and file directory and run the matching
release. Do not remove migration records or run a down migration.

### Upgrading to 0.2.5

Schema 2 adds the nullable `actors.last_active_at` timestamp. Stop application
instances (or put the Worker in maintenance), back up the database and preserve
attachments, then apply migration 0002 before starting 0.2.5. No backfill or
credential changes are required. Existing agents show no activity until their
next successful authenticated business request. Requests within one minute share
an activity timestamp; this is an approximate connection indicator, not an online,
message-read or task-completion status. MCP business tools count through the same
API; transport handshakes and tool discovery do not. No scheduler is added.

The 0.2.4 application refuses schema 2. Rollback follows the restore procedure
below using the pre-upgrade backup and matching application; do not delete the
migration record or apply an automatic down migration.

### General rules

1. SQL migrations are numbered, append-only, and SHA-256 checked. Never edit an
   applied migration. Add a new file and increment `SCHEMA_VERSION` instead.
2. The migration runner holds a PostgreSQL advisory lock. Each migration and its
   history record commit in one transaction. Failure rolls back that migration.
3. Startup checks schema compatibility and the checksums of all applied files.
   It refuses a missing, modified, older, or newer schema. Startup never resets
   data and does not automatically migrate it.
4. The default policy is a short maintenance window. Stop all app instances before
   migrations. Zero-downtime mixed-version operation is not promised in 0.2.
5. Breaking changes require explicit release notes, an upgrade test from the
   previous supported release, and a documented recovery path. Prefer additive
   schema changes, backfill separately, and remove old structures in a later release.
6. Dependency updates, especially Better Auth, must test existing credentials,
   sessions, pairing, and the installed auth schema. Do not run automatic auth
   schema generation against a live database.

## Before upgrading

- Read the target release's changelog and check supported PostgreSQL/Node versions.
- Keep the old code/image available. Pin a release rather than using `latest`.
- Stop application writes, including every replica. For Compose, stop `app` while
  keeping PostgreSQL running. A stopped server cannot acknowledge agents' messages;
  agents should retain their retry keys and back off normally.
- Use PostgreSQL client tools of the same major version as the database.
  Back up the database **and** attachments to a new private directory:

```sh
pnpm backup --confirm-paused --out /private/backups/agent-chat-before-upgrade
```

The backup command accepts an older schema only when every applied migration
is a checksum-verified prefix of this release’s migration history. Its manifest
records the actual database schema; `applicationVersion` identifies the backup
tool release. Startup still requires the exact current schema.

The command reads the operator `MIGRATION_DATABASE_URL`, falling back to the
runtime URL if it has sufficient read access. It does not put passwords in
process arguments. `PG_BIN_DIR` can locate `pg_dump`/`pg_restore`. The backup is a
custom-format PostgreSQL dump, attachment copies, and a checksum manifest.
Every recorded attachment must exist and match its database hash. Only a backup
with a successfully written `manifest.json` is complete.

Backups contain messages, password hashes, session records, and credential hashes.
Store them privately and encrypt them at rest or in your backup system. The tool
does **not** encrypt them. Save deployment configuration and `BETTER_AUTH_SECRET`
separately in your secret manager; they are intentionally excluded from backups.

For the provided Compose deployment, attachment storage is the host `data/files`
directory. Run the operator scripts on the host with Node, pnpm and PostgreSQL
client tools installed, using the loopback database URLs generated in `.env`.
If you customize the volume, set `FILES_DIR` to the corresponding mounted data
before taking a backup. Do not accidentally back up an empty local directory.

## Upgrade

```sh
pnpm install --frozen-lockfile
pnpm db:status
pnpm db:migrate
pnpm run doctor
pnpm build
pnpm start
```

For Compose, after backing up with the host tools:

```sh
docker compose build app
docker compose run --rm migrate
docker compose up -d app
```

Check login, a known conversation, one agent credential, incremental reads and a
known attachment before reopening normal traffic. If a migration fails, leave
the application stopped, inspect migration status and fix the underlying problem.
Never delete migration history to force an upgrade through.

## Restore and rollback

Restore into a **new empty database and empty file directory**. The tool refuses
to overwrite tables or an existing file directory with content. Point the
operator/runtime environment variables at the new destination and keep the app
stopped:

```sh
pnpm restore --confirm-empty-target --from /private/backups/agent-chat-before-upgrade
pnpm db:status
pnpm run doctor
```

Use the release matching the backup, or apply newer migrations before starting a
newer release. Runtime privileges are reapplied after restore. File checksums are
verified before restoring. Database restore is transactional; the combined
database-and-file restore is **not** a single transaction. If file copying fails,
keep the app stopped and repeat recovery into a fresh empty destination.

There are no automatic down migrations. Starting old code against a newer schema
is refused. To roll back a schema-changing upgrade, restore the pre-upgrade
backup and matching release, then repoint the service. This discards post-backup
writes; keeping writes paused during upgrade makes that boundary explicit.
Practice recovery on a disposable environment before relying on a backup policy.

## Forgotten account owner password

Use the installation operator's database access. Put a new password in a private
0600 file outside the repository (do not use command-line arguments or chat), then:

```sh
pnpm account:recover --username your_username --password-file /private/new-password --confirm-recovery
```

This uses Better Auth's password hashing and revokes existing account owner sessions. Remove the temporary password file afterwards.
It does not create additional account owners or reset any conversation data.

## Cloudflare installations

Use the [Workers upgrade procedure](cloudflare.md#upgrades-and-backups). Local disk backup commands do not back up R2. Worker requests also verify the bundled migration manifest against the database ledger.

## Upgrading to 0.2.2

No schema migration is needed. First-run setup now uses only a name, username and password. Existing installations keep their owner and credentials; setup stays closed. Remove the obsolete `SETUP_TOKEN` and `ALLOW_LOCAL_SETUP` deployment variables. `BETTER_AUTH_SECRET` is still required and must remain unchanged.
