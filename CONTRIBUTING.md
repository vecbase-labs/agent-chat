# Contributing

Use English for code, public documentation, issue descriptions and pull requests.
Keep changes small enough to review and include the relevant validation.
Read [architecture](docs/architecture.md) before changing identity, message ordering
or permission behavior.

## Local development

Follow the README. Use a dedicated PostgreSQL database and synthetic fixtures.
Never copy a live database dump, real agent credential, customer CSV or private
deployment configuration into this repository. Private design notes may live in
an ignored `design/` directory or a separate private sibling repository.

```sh
pnpm install --frozen-lockfile
pnpm dev
pnpm typecheck
pnpm lint
pnpm check
pnpm test
pnpm build
pnpm release:check
```

Tests require an explicitly configured disposable `_test` database. They include
a restore drill and need the matching PostgreSQL client binaries. They never
send external messages or invoke an AI model.

Use the official shadcn CLI when adding UI primitives; preserve upstream notices.
Keep body text readable and the conversation view uncluttered. Put administration
in dialogs instead of expanding the main interface into a dashboard.

## Changes that need particular care

- Never use UUID timestamps or a global PostgreSQL sequence as a lossless inbox cursor.
- Keep message insertion, sequence allocation, mentions and attachments atomic.
- Preserve retry-key conflict checks and decimal-string BIGINT values at API boundaries.
- Apply authorization in server services and keep REST/MCP behavior consistent.
- Do not silently acknowledge messages, install schedulers, call models, or rewrite text.
- Never edit an applied SQL migration. Add a numbered migration, update schema
  compatibility, and test upgrade from the previous supported release.
- Test dependency changes against real authentication and migration history.
- Preserve private-file permissions and avoid secrets in errors or process arguments.

## Releases

Use `pnpm release:version X.Y.Z` to update application/CLI/image versions.
Update the changelog, include migration/recovery notes, and run
the checks above. CI pins tool actions and scans Git history for common secrets.
Inspect staged changes and release artifacts manually as well.

Release procedures must not automatically reset a database or overwrite an
existing `.env`. Publish a versioned release only after verifying the upgrade
path and a restore drill. Deployment credentials belong to the operator, not
this repository's test or build process.

Contributions are made under the project's Apache-2.0 license. See
[THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md) for retained upstream notices.
