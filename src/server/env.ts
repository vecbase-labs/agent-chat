import 'dotenv/config'
import { resolve } from 'node:path'
import { requestRuntime } from './runtime'

function variables() {
  return requestRuntime.getStore()?.variables ?? process.env
}
function required(name: string) {
  const value = variables()[name]
  if (!value) throw new Error(`Missing ${name}. See .env.example.`)
  return value
}

export function getEnv() {
  const vars = variables()
  const appUrl = new URL(required('APP_URL'))
  if (
    !['http:', 'https:'].includes(appUrl.protocol) ||
    appUrl.username ||
    appUrl.password ||
    appUrl.search ||
    appUrl.hash ||
    appUrl.pathname !== '/'
  )
    throw new Error(
      'APP_URL must be an HTTP(S) origin without credentials, path, query, or fragment.',
    )
  const secret = required('BETTER_AUTH_SECRET')
  if (secret.length < 32 || secret.includes('REPLACE_WITH')) {
    throw new Error('Set BETTER_AUTH_SECRET to at least 32 random characters.')
  }
  const loopback = ['localhost', '127.0.0.1', '[::1]'].includes(appUrl.hostname)
  if (!loopback && appUrl.protocol !== 'https:')
    throw new Error('Public installations require HTTPS.')
  const localSetup = vars.ALLOW_LOCAL_SETUP === 'true'
  if (localSetup && !loopback)
    throw new Error('Local setup is only allowed with a loopback APP_URL.')
  const maxFileBytes = Number(vars.MAX_FILE_BYTES || 10485760)
  if (
    !Number.isSafeInteger(maxFileBytes) ||
    maxFileBytes < 1 ||
    maxFileBytes > 26214400
  )
    throw new Error('MAX_FILE_BYTES must be an integer between 1 and 26214400.')
  return {
    appUrl: appUrl.origin,
    databaseUrl:
      requestRuntime.getStore()?.databaseUrl ?? required('DATABASE_URL'),
    secret,
    localSetup,
    setupToken: vars.SETUP_TOKEN || '',
    filesDir: resolve(vars.FILES_DIR || './data/files'),
    maxFileBytes,
  }
}
