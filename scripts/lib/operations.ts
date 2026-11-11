import 'dotenv/config'
import { createHash } from 'node:crypto'
import { createReadStream } from 'node:fs'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { readdir, readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import pg from 'pg'
import { SCHEMA_VERSION } from '../../src/lib/version'

export const execute = promisify(execFile)
export const sha256 = (data: Uint8Array) =>
  createHash('sha256').update(data).digest('hex')
export async function hashFile(path: string) {
  const hash = createHash('sha256')
  for await (const chunk of createReadStream(path)) hash.update(chunk)
  return hash.digest('hex')
}
export const root = fileURLToPath(new URL('../../', import.meta.url))
export function databaseEnvironment(connectionString: string) {
  const url = new URL(connectionString)
  return {
    ...process.env,
    PGHOST: url.hostname,
    PGPORT: url.port || '5432',
    PGUSER: decodeURIComponent(url.username),
    PGPASSWORD: decodeURIComponent(url.password),
    PGDATABASE: decodeURIComponent(url.pathname.slice(1)),
    PGCONNECT_TIMEOUT: '10',
    ...(url.searchParams.get('sslmode')
      ? { PGSSLMODE: url.searchParams.get('sslmode')! }
      : {}),
  }
}
export async function pgCommand(
  command: string,
  args: string[],
  connectionString: string,
) {
  const binary = process.env.PG_BIN_DIR
    ? join(process.env.PG_BIN_DIR, command)
    : command
  try {
    return await execute(binary, args, {
      env: databaseEnvironment(connectionString),
      maxBuffer: 4 * 1024 * 1024,
    })
  } catch {
    throw new Error(
      `${command} failed. Check PostgreSQL client availability, target permissions and server/client major versions. Credentials were not printed.`,
    )
  }
}
export async function checkDatabase(
  connectionString: string,
  options: { allowOlder?: boolean } = {},
) {
  const client = new pg.Client({
    connectionString,
    connectionTimeoutMillis: 5000,
  })
  await client.connect()
  try {
    const result = await client.query<{
      version: number
      name: string
      checksum: string
    }>('SELECT version,name,checksum FROM schema_migrations ORDER BY version')
    const files = (await readdir(join(root, 'migrations')))
      .filter((name) => /^\d{4}_.+\.sql$/.test(name))
      .sort()
    const schema = result.rows.at(-1)?.version
    if (
      !schema ||
      schema > SCHEMA_VERSION ||
      result.rows.length > files.length ||
      (!options.allowOlder &&
        (result.rows.length !== files.length || schema !== SCHEMA_VERSION))
    )
      throw new Error(
        'Schema is incompatible. Run pnpm db:status and follow docs/upgrading.md.',
      )
    // Backups may inspect a known older prefix before migrations run. Startup
    // still requires the exact current schema; all applied checksums are checked.
    for (const file of files.slice(0, result.rows.length)) {
      const migration = result.rows.find(
        (row) => row.version === Number(file.slice(0, 4)),
      )
      if (
        !migration ||
        migration.name !== file ||
        migration.checksum !==
          sha256(await readFile(join(root, 'migrations', file)))
      )
        throw new Error(
          `Migration history mismatch: ${file}. Restore the original release.`,
        )
    }
    const server = await client.query<{ version: string; privileged: boolean }>(
      "SELECT current_setting('server_version') AS version,(rolsuper OR rolcreatedb OR rolcreaterole) AS privileged FROM pg_roles WHERE rolname=current_user",
    )
    return {
      schema,
      postgres: server.rows[0].version,
      privileged: server.rows[0].privileged,
    }
  } finally {
    await client.end()
  }
}
