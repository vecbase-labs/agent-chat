import { copyFile, mkdir, readdir, readFile, chmod } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import pg from 'pg'
import { z } from 'zod'
import { getEnv } from '../src/server/env'
import { SCHEMA_VERSION } from '../src/lib/version'
import { hashFile, pgCommand } from './lib/operations'

const manifestSchema = z.object({
  format: z.literal(1),
  applicationVersion: z.string(),
  schemaVersion: z.number().int(),
  databaseSha256: z.string().regex(/^[a-f0-9]{64}$/),
  files: z.array(
    z.object({
      id: z.string().uuid(),
      sha256: z.string().regex(/^[a-f0-9]{64}$/),
    }),
  ),
})
try {
  if (!process.argv.includes('--confirm-empty-target'))
    throw new Error(
      'Restore requires a paused application and a new, empty database/file directory. Supply --confirm-empty-target --from /private/backup. Never restore over live data.',
    )
  const index = process.argv.indexOf('--from')
  if (index < 0 || !process.argv[index + 1]) throw new Error('Supply --from.')
  const source = resolve(process.argv[index + 1]),
    env = getEnv()
  const manifest = manifestSchema.parse(
    JSON.parse(await readFile(join(source, 'manifest.json'), 'utf8')),
  )
  if (manifest.schemaVersion > SCHEMA_VERSION)
    throw new Error(
      'Backup is from a newer schema. Use that release or a later compatible release.',
    )
  if (
    (await hashFile(join(source, 'database.dump'))) !== manifest.databaseSha256
  )
    throw new Error('Database backup checksum failed.')
  for (const file of manifest.files)
    if ((await hashFile(join(source, 'files', file.id))) !== file.sha256)
      throw new Error('Attachment backup checksum failed.')
  if (
    (
      await readdir(env.filesDir).catch((error: NodeJS.ErrnoException) => {
        if (error.code === 'ENOENT') return []
        throw error
      })
    ).length
  )
    throw new Error('Target file directory is not empty.')
  const connectionString = process.env.MIGRATION_DATABASE_URL || env.databaseUrl
  const client = new pg.Client({ connectionString })
  await client.connect()
  try {
    if (
      (
        await client.query(
          "SELECT 1 FROM information_schema.tables WHERE table_schema NOT IN ('pg_catalog','information_schema') LIMIT 1",
        )
      ).rowCount
    )
      throw new Error(
        'Target database is not empty. Refusing to overwrite data.',
      )
    await pgCommand(
      'pg_restore',
      [
        '--exit-on-error',
        '--single-transaction',
        '--no-owner',
        '--no-privileges',
        '--dbname',
        new URL(connectionString).pathname.slice(1),
        join(source, 'database.dump'),
      ],
      connectionString,
    )
    const role = decodeURIComponent(new URL(env.databaseUrl).username)
    const identifier = '"' + role.replaceAll('"', '""') + '"'
    await client.query(
      `GRANT USAGE ON SCHEMA public TO ${identifier}; GRANT SELECT,INSERT,UPDATE,DELETE ON ALL TABLES IN SCHEMA public TO ${identifier}; GRANT USAGE,SELECT ON ALL SEQUENCES IN SCHEMA public TO ${identifier}; REVOKE INSERT,UPDATE,DELETE ON schema_migrations FROM ${identifier}`,
    )
  } finally {
    await client.end()
  }
  await mkdir(env.filesDir, { recursive: true, mode: 0o700 })
  for (const file of manifest.files) {
    await copyFile(join(source, 'files', file.id), join(env.filesDir, file.id))
    await chmod(join(env.filesDir, file.id), 0o600)
  }
  console.log(
    JSON.stringify({
      restored: true,
      files: manifest.files.length,
      schema: manifest.schemaVersion,
      next: 'Run pnpm db:migrate if needed, then pnpm run doctor before starting the app.',
    }),
  )
} catch (error) {
  console.error(
    error instanceof Error && !('code' in error)
      ? error.message
      : 'Restore failed. Keep the application stopped, inspect the target, and restart recovery using an empty destination.',
  )
  process.exitCode = 1
}
