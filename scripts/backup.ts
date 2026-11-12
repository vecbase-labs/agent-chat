import { copyFile, mkdir, chmod, writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import pg from 'pg'
import { getEnv } from '../src/server/env'
import { APP_VERSION } from '../src/lib/version'
import { checkDatabase, hashFile, pgCommand } from './lib/operations'

try {
  if (!process.argv.includes('--confirm-paused'))
    throw new Error(
      'Pause application writes first, then run pnpm backup --confirm-paused --out /private/path/new-backup. See docs/upgrading.md.',
    )
  const index = process.argv.indexOf('--out')
  if (index < 0 || !process.argv[index + 1])
    throw new Error('Supply --out with a new private backup directory.')
  const env = getEnv()
  const url = process.env.MIGRATION_DATABASE_URL || env.databaseUrl
  const database = await checkDatabase(url, { allowOlder: true })
  const destination = resolve(process.argv[index + 1])
  await mkdir(destination, { mode: 0o700 }) // Refuse existing destinations.
  await mkdir(join(destination, 'files'), { mode: 0o700 })
  await pgCommand(
    'pg_dump',
    [
      '--format=custom',
      '--no-owner',
      '--no-privileges',
      '--file',
      join(destination, 'database.dump'),
    ],
    url,
  )
  await chmod(join(destination, 'database.dump'), 0o600)
  const files: { id: string; sha256: string }[] = []
  const client = new pg.Client({ connectionString: url })
  await client.connect()
  try {
    const stored = await client.query<{ id: string; sha256: string }>(
      database.schema >= 3
        ? 'SELECT id,sha256 FROM files UNION ALL SELECT avatar_id AS id,avatar_sha256 AS sha256 FROM actors WHERE avatar_id IS NOT NULL ORDER BY id'
        : 'SELECT id,sha256 FROM files ORDER BY id',
    )
    for (const file of stored.rows) {
      if ((await hashFile(join(env.filesDir, file.id))) !== file.sha256)
        throw new Error(
          'An attachment is missing or damaged. Backup is incomplete; investigate storage before upgrading.',
        )
      await copyFile(
        join(env.filesDir, file.id),
        join(destination, 'files', file.id),
      )
      await chmod(join(destination, 'files', file.id), 0o600)
      files.push(file)
    }
  } finally {
    await client.end()
  }
  const manifest = {
    format: 1,
    applicationVersion: APP_VERSION,
    schemaVersion: database.schema,
    createdAt: new Date().toISOString(),
    databaseSha256: await hashFile(join(destination, 'database.dump')),
    files,
  }
  await writeFile(
    join(destination, 'manifest.json'),
    JSON.stringify(manifest, null, 2) + '\n',
    { mode: 0o600, flag: 'wx' },
  )
  console.log(
    JSON.stringify({ saved: destination, files: files.length, complete: true }),
  )
} catch (error) {
  console.error(
    error instanceof Error && !('code' in error)
      ? error.message
      : 'Backup failed. Check destination permissions and database availability. An incomplete destination must not be used for restore.',
  )
  process.exitCode = 1
}
