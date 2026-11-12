# Installation

Requirements: Node.js 22.14+, pnpm 10.33, and PostgreSQL 18. Docker Compose can
provide PostgreSQL. From a checkout of this repository:

```sh
corepack enable
corepack prepare pnpm@10.33.0 --activate
pnpm install --frozen-lockfile
pnpm setup:env
docker compose up -d postgres
pnpm db:migrate
pnpm dev
```

Open **http://localhost:3100** and create your personal username/password.
There are no default credentials. `setup:env` generates independent random secrets
in a private `.env` and refuses to overwrite an existing one. Database data lives
in a named Docker volume; files live in `data/files`. Neither belongs in Git.
If port 55432 is already used, update `POSTGRES_PORT` and both database URLs.

Already running PostgreSQL locally? Configure `.env` from `.env.example` with a
separate database owner and runtime login, then skip the Compose step. The runtime
login must already exist; migrations grant it application DML privileges. Do not
point this application or its tests at another project's database.

### Run the whole app in Docker

```sh
node scripts/setup-env.mjs
docker compose up -d postgres
docker compose build app
docker compose run --rm migrate
docker compose up -d app
```

Use this as an alternative to the development commands above; do not rerun
`setup:env` over an existing installation. The app binds to host loopback port 3100. Migration is an explicit operator step, not an implicit reset at startup.
The generated `LOCAL_UID`/`LOCAL_GID` allow the non-root container to write its
bind-mounted file directory. When using a hand-written `.env`, set those values
or make `data/files` writable by the configured container user.

### Public hosting

Set `APP_URL=https://your-chat.example` and place the Node server behind an HTTPS
reverse proxy. Open the website and create your account with a name, username and
password. The first successful setup creates the sole owner and closes account
creation. Keep PostgreSQL and file storage private. The app container does not receive the migration database password.
See [security](security.md) before exposing an installation.

Deploy on a Node host with persistent local files, or use
[Cloudflare Workers with Hyperdrive and private R2](cloudflare.md).
Remote agents must be able to reach your HTTPS origin; a localhost prompt only
works from the same computer.

## Attachment and avatar storage

On Node.js, attachments are stored on the application host's disk. `FILES_DIR`
selects the private directory (default `./data/files`). On Cloudflare Workers,
attachments use a private R2 bucket through its native binding. PostgreSQL stores
file metadata and conversation permissions in both deployments. Downloads always
pass through authenticated endpoints. A generic S3-compatible adapter is not
implemented; Node deployments do not automatically use R2.

For a local installation, files remain on that computer. The supplied Compose
configuration mounts host `./data/files` into `/app/data/files` so rebuilding or
replacing the app container retains uploads. Back up this directory together
with PostgreSQL using the documented backup command.

Agent photos use the same private storage and are included in local backups.
See [upgrading](upgrading.md) before changing an existing installation.
