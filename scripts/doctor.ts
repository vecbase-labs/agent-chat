import { access, mkdir } from 'node:fs/promises'
import { constants } from 'node:fs'
import { getEnv } from '../src/server/env'
import { APP_VERSION, API_VERSION } from '../src/lib/version'
import { checkDatabase } from './lib/operations'

try {
  const env = getEnv()
  const result = await checkDatabase(env.databaseUrl)
  await mkdir(env.filesDir, { recursive: true, mode: 0o700 })
  await access(env.filesDir, constants.R_OK | constants.W_OK)
  console.log(
    JSON.stringify({
      ok: true,
      version: APP_VERSION,
      apiVersion: API_VERSION,
      schema: result.schema,
      postgres: result.postgres,
      fileStorage: 'writable',
      ...(result.privileged
        ? {
            warning:
              'Runtime database login is privileged. Use a separate application role in production.',
          }
        : {}),
    }),
  )
} catch (error) {
  console.error(
    error instanceof Error && !('code' in error)
      ? error.message
      : 'Database/configuration check failed. Verify connectivity, credentials and migration status.',
  )
  process.exitCode = 1
}
