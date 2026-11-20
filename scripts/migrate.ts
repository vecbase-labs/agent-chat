import 'dotenv/config'
import { createHash } from 'node:crypto'
import { readdir, readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import pg from 'pg'

const directory = fileURLToPath(new URL('../migrations/', import.meta.url))
const statusOnly = process.argv.includes('--status')
const pool = new pg.Pool({
  connectionString:
    process.env.MIGRATION_DATABASE_URL || process.env.DATABASE_URL,
  max: 1,
})
const client = await pool.connect()
try {
  await client.query('SELECT pg_advisory_lock(81724001)')
  await client.query(`CREATE TABLE IF NOT EXISTS schema_migrations (
    version integer PRIMARY KEY, name text NOT NULL, checksum text NOT NULL, applied_at timestamptz NOT NULL DEFAULT now())`)
  const files = (await readdir(directory))
    .filter((f) => /^\d{4}_.+\.sql$/.test(f))
    .sort()
  const applied = (
    await client.query<{ version: number; checksum: string }>(
      'SELECT version,checksum FROM schema_migrations ORDER BY version',
    )
  ).rows
  if (
    applied.some(
      (row) => !files.some((f) => Number(f.slice(0, 4)) === row.version),
    )
  )
    throw new Error('Database is newer than this release. Refusing downgrade.')
  for (const file of files) {
    const version = Number(file.slice(0, 4))
    const sql = await readFile(directory + file, 'utf8')
    const checksum = createHash('sha256').update(sql).digest('hex')
    const existing = applied.find((row) => row.version === version)
    if (existing && existing.checksum !== checksum)
      throw new Error(
        `Checksum mismatch: ${file}. Restore the original migration; do not edit history.`,
      )
    if (existing) {
      console.log(`Applied: ${file}`)
      continue
    }
    if (statusOnly) {
      console.log(`Pending: ${file}`)
      continue
    }
    await client.query('BEGIN')
    try {
      await client.query(sql)
      await client.query(
        'INSERT INTO schema_migrations(version,name,checksum) VALUES($1,$2,$3)',
        [version, file, checksum],
      )
      // A separate application login receives DML privileges, never DDL ownership.
      if (process.env.DATABASE_URL) {
        const role = decodeURIComponent(
          new URL(process.env.DATABASE_URL).username,
        )
        const identifier = '"' + role.replaceAll('"', '""') + '"'
        await client.query(`GRANT USAGE ON SCHEMA public TO ${identifier}`)
        await client.query(
          `GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO ${identifier}`,
        )
        await client.query(
          `GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO ${identifier}`,
        )
        await client.query(
          `REVOKE INSERT, UPDATE, DELETE ON schema_migrations FROM ${identifier}`,
        )
      }
      await client.query('COMMIT')
      console.log(`Migrated: ${file}`)
    } catch (error) {
      await client.query('ROLLBACK')
      throw error
    }
  }
} catch (error) {
  console.error(error instanceof Error ? error.message : 'Migration failed')
  process.exitCode = 1
} finally {
  await client.query('SELECT pg_advisory_unlock(81724001)').catch(() => {})
  client.release()
  await pool.end()
}
