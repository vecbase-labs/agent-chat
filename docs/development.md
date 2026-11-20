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

## Development dependency overrides

Two temporary pnpm overrides keep development tooling on patched parsers while
its parent packages still request older versions:

- `minimatch` 11.0.5 replaces vulnerable 7–10.x dependencies used by ESLint
  tooling ([upstream advisory](https://github.com/isaacs/minimatch/security/advisories/GHSA-g3hv-75wg-m249)). Its Node requirement is compatible with this project's Node 22 baseline.
- `postcss-selector-parser` 6.1.5 replaces 6.0.10 pinned by Tailwind Typography
  ([upstream advisory](https://github.com/postcss/postcss-selector-parser/security/advisories/GHSA-rj75-hqrm-r3gf)).

These are build/lint dependencies, not message processing services. Remove each
override when all parent dependency ranges resolve to patched versions. Validate
lint, tests and both production builds after changing them.
