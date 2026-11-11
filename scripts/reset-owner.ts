import 'dotenv/config'
import { lstat, readFile } from 'node:fs/promises'
import { hashPassword } from 'better-auth/crypto'
import pg from 'pg'
import {
  MIN_PASSWORD_LENGTH,
  MAX_PASSWORD_LENGTH,
} from '../src/lib/password-policy'

try {
  const username = process.argv[process.argv.indexOf('--username') + 1]
  const passwordFile = process.argv[process.argv.indexOf('--password-file') + 1]
  if (
    !process.argv.includes('--confirm-recovery') ||
    !process.argv.includes('--username') ||
    !process.argv.includes('--password-file') ||
    !process.env.MIGRATION_DATABASE_URL
  )
    throw new Error(
      'Use --username NAME --password-file /private/file --confirm-recovery with the operator MIGRATION_DATABASE_URL. No password is accepted on the command line.',
    )
  const info = await lstat(passwordFile)
  if (
    !info.isFile() ||
    info.isSymbolicLink() ||
    (process.platform !== 'win32' && info.mode & 0o077)
  )
    throw new Error('Password file must be a private regular file (0600).')
  const password = (await readFile(passwordFile, 'utf8')).replace(/\r?\n$/, '')
  if (
    password.length < MIN_PASSWORD_LENGTH ||
    password.length > MAX_PASSWORD_LENGTH
  )
    throw new Error(
      `Use a password of ${MIN_PASSWORD_LENGTH}–${MAX_PASSWORD_LENGTH} characters.`,
    )
  const passwordHash = await hashPassword(password)
  const client = new pg.Client({
    connectionString: process.env.MIGRATION_DATABASE_URL,
  })
  await client.connect()
  try {
    await client.query('BEGIN')
    const result = await client.query(
      "SELECT a.id,a.user_id FROM actors a JOIN ac_user u ON u.id=a.user_id WHERE a.kind='human' AND a.id=(SELECT owner_id FROM instance) AND u.username=$1 FOR UPDATE OF a",
      [username.toLowerCase()],
    )
    if (result.rowCount !== 1) throw new Error('Personal account not found.')
    const actor = result.rows[0]
    await client.query(
      'UPDATE ac_account SET password=$1,"updatedAt"=now() WHERE "userId"=$2 AND "providerId"=\'credential\'',
      [passwordHash, actor.user_id],
    )
    await client.query('DELETE FROM ac_session WHERE "userId"=$1', [
      actor.user_id,
    ])
    await client.query('COMMIT')
    console.log(
      'Personal account password updated; existing sessions revoked. Delete the temporary password file securely.',
    )
  } catch (error) {
    await client.query('ROLLBACK')
    throw error
  } finally {
    await client.end()
  }
} catch (error) {
  console.error(
    error instanceof Error && !('code' in error)
      ? error.message
      : 'Personal account recovery failed. Check operator access.',
  )
  process.exitCode = 1
}
