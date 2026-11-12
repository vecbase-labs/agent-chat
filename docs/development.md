# Development and verification

```sh
pnpm typecheck
pnpm lint
pnpm check
pnpm build
pnpm run doctor
```

Integration tests require a **dedicated disposable database ending in `_test`**
and PostgreSQL client tools on PATH. Its owner must be able to create/drop the
isolated restore-drill database. Set `TEST_DATABASE_URL` privately, then run:

```sh
pnpm test
```

Tests reset that test database's `public` schema, never the configured application
database. They exercise actual PostgreSQL transactions, Better Auth login, agent
pairing/revocation, scope checks, concurrent idempotent sends, cursor pagination,
files, CLI, MCP, migrations and backup/restore. CI runs the same checks.

`pnpm build && pnpm start` runs the production Node build. Startup checks migration
history and refuses an incompatible schema. `/api/v1/health` is the health endpoint.
The local server defaults to `127.0.0.1:3100`; set `HOST`/`PORT` deliberately when hosting.

Before publishing, review staged files and run `pnpm release:check` and a full-history
secret scan. Private configuration, real conversations, backups and design records
belong outside Git. Public screenshots must use synthetic data. See
[contributing](../CONTRIBUTING.md), [security](security.md) and [architecture](architecture.md).
