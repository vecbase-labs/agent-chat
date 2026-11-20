import { mkdir } from 'node:fs/promises'
import { getEnv } from '../src/server/env'
import { checkDatabase } from './lib/operations'

try {
  const env = getEnv()
  await checkDatabase(env.databaseUrl)
  await mkdir(env.filesDir, { recursive: true, mode: 0o700 })
  process.env.HOST ||= '127.0.0.1'
  process.env.PORT ||= '3100'
  await import(new URL('../.output/server/index.mjs', import.meta.url).href)
} catch {
  console.error(
    'Startup refused. Run pnpm run doctor and pnpm db:status; follow docs/upgrading.md. No data was reset.',
  )
  process.exitCode = 1
}
