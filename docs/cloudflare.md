# Cloudflare Workers deployment

Agent Chat can run on Cloudflare Workers with PostgreSQL through Hyperdrive and
private R2 attachments. The default Node deployment still uses local file storage.
Both deployments use the same schema, API, authentication and CLI.

## Provision resources

1. Create a dedicated PostgreSQL 18 database. Use a NOLOGIN object owner and a
   separate LOGIN runtime role. The runtime needs CONNECT, schema USAGE, table
   SELECT/INSERT/UPDATE/DELETE, and sequence USAGE/SELECT. Give it only SELECT on
   `schema_migrations`. It must not own objects, inherit the owner, create schemas,
   administer roles, replicate, or access other applications' databases.
2. Apply migrations with an operator connection, creating objects as the owner.
   Use a direct PostgreSQL endpoint, never a transaction pooler. Keep migration
   credentials out of the Worker. Review grants for each new migration.
3. Create Hyperdrive using the runtime role. Disable query caching: messages,
   unread counts, revocation and authentication must reflect committed data.
   Verify the origin's TLS certificate and hostname. Limit origin connections to
   the database's capacity; an example starting budget is 5 with a role limit of 8.
4. Create a dedicated private R2 bucket. Do not enable a public bucket domain.
5. Copy `wrangler.example.jsonc` to ignored `wrangler.local.jsonc`. Set your Worker
   name, APP_URL, Hyperdrive ID, R2 bucket and custom domain routes. Keep deployment
   identifiers and secrets in your private operations repository.

```json
"routes": [{ "pattern": "chat.example.com", "custom_domain": true }]
```

The Worker uses its own account owner login and agent credentials. A second
Cloudflare Access login is not required for agent pairing.

## Build and deploy

```sh
pnpm install --frozen-lockfile
AGENT_CHAT_CLOUDFLARE_CONFIG=wrangler.local.jsonc pnpm build:cloudflare
pnpm exec wrangler deploy --config dist/server/wrangler.json \
  --secrets-file /private/agent-chat/worker-secrets.json
```

The private JSON file contains `BETTER_AUTH_SECRET` (at least 32 random characters)
and `SETUP_TOKEN` (a separate random value). Do not use command-line `--var` for
secrets. APP_URL must be the exact HTTPS origin. Never enable local setup publicly.
The first account setup requires the setup token; subsequent signup is closed.
After setup, remove `SETUP_TOKEN` from the Worker and the deployment secret file.
Keep the authentication secret stable across upgrades.

Deploy the generated `dist/server/wrangler.json`, not the source example. Build
output and `.dev.vars` can contain local development secrets and must stay private;
never publish the entire build directory as an archive. Wrangler uploads Worker
modules and client assets, not the local development secrets file. Do not put
secrets in Vite client variables or public assets.

The Worker uses one lazy PostgreSQL pool and one auth adapter per request; pools
are closed with `waitUntil`. No database client is shared across requests. Files
are immutable R2 objects named by generated IDs; all downloads still require API
authorization and verify the stored SHA-256. No Durable Objects or scheduler are
required.

## Local runtime verification

Use an isolated PostgreSQL database ending in `_test`. Add its connection string
as `localConnectionString` on the local Hyperdrive binding, in ignored config.
Supply local APP_URL, BETTER_AUTH_SECRET and SETUP_TOKEN using an ignored
`.dev.vars` file. Run `pnpm dev:cloudflare`; R2 is simulated locally. Never point
fixture/reset tests at a production Hyperdrive or a real installation.

## Upgrades and backups

Read [upgrading](upgrading.md). Worker requests check the bundled migration
manifest against database history. Update the manifest with `pnpm db:manifest`
after adding a migration; builds reject a stale manifest. Do not change applied SQL.
Application and CLI versions are independent of API/schema versions.

For a migration, set `MAINTENANCE=true` in private Worker configuration, deploy,
and let active requests finish. Take a verified PostgreSQL backup and retain
all referenced R2 objects. Apply the reviewed migration via the operator endpoint,
verify ownership and runtime grants, build and deploy the matching app, then clear
maintenance. An older Worker cannot be used with incompatible schema history.

The Node `backup`/`restore` commands copy **local disk files only**. They are not
an R2 backup. Use the database host's encrypted backup policy plus a separate
private R2 export/copy policy. Record the database recovery point and attachment
inventory, and verify object hashes during recovery. Restore into a new database
and private bucket; never overwrite live data. An application rollback must keep
newer messages and attachments, not silently restore an older database snapshot.
