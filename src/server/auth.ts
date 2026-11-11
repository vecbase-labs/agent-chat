import { betterAuth } from 'better-auth'
import { username } from 'better-auth/plugins'
import {
  MIN_PASSWORD_LENGTH,
  MAX_PASSWORD_LENGTH,
} from '../lib/password-policy'
import { ensureSchema, getPool } from './db'
import { getEnv } from './env'
import { checkOrigin, limit, readBytes } from './security'
import { HttpError } from './errors'
import { requestRuntime } from './runtime'

let instance: ReturnType<typeof createAuth> | undefined
function createAuth() {
  const env = getEnv()
  return betterAuth({
    appName: 'Agent Chat',
    baseURL: env.appUrl,
    secret: env.secret,
    database: getPool(),
    trustedOrigins: [env.appUrl],
    user: { modelName: 'ac_user' },
    session: { modelName: 'ac_session', expiresIn: 60 * 60 * 24 * 7 },
    account: { modelName: 'ac_account' },
    verification: { modelName: 'ac_verification' },
    emailAndPassword: {
      enabled: true,
      disableSignUp: true,
      minPasswordLength: MIN_PASSWORD_LENGTH,
      maxPasswordLength: MAX_PASSWORD_LENGTH,
    },
    rateLimit: {
      enabled: true,
      storage: 'database',
      modelName: 'ac_rate_limit',
      window: 60,
      max: 30,
    },
    advanced: {
      useSecureCookies: env.appUrl.startsWith('https:'),
      ipAddress: { ipAddressHeaders: [] },
    },
    plugins: [username({ minUsernameLength: 3, maxUsernameLength: 40 })],
  })
}
export function getAuth() {
  const runtime = requestRuntime.getStore()
  if (runtime) {
    let auth = runtime.memo.get('auth') as
      ReturnType<typeof createAuth> | undefined
    if (!auth) {
      auth = createAuth()
      runtime.memo.set('auth', auth)
    }
    return auth
  }
  instance ??= createAuth()
  return instance
}

export async function handleAuth(request: Request) {
  const path = new URL(request.url).pathname.replace('/api/auth', '')
  const allowed = new Set([
    '/sign-in/username',
    '/sign-out',
    '/get-session',
    '/change-password',
  ])
  if (!allowed.has(path))
    return Response.json(
      {
        error: {
          code: 'NOT_FOUND',
          message: 'This auth endpoint is disabled.',
        },
      },
      { status: 404 },
    )
  try {
    await ensureSchema()
    checkOrigin(request)
    if (request.method === 'POST') {
      await limit('anonymous:auth', 60)
      const content = await readBytes(request, 16 * 1024)
      request = new Request(request.url, {
        method: request.method,
        headers: request.headers,
        body: new Uint8Array(content),
      })
    }
    const response = await getAuth().handler(request)
    response.headers.set('Cache-Control', 'no-store')
    response.headers.set('X-Content-Type-Options', 'nosniff')
    return response
  } catch (error) {
    const status = error instanceof HttpError ? error.status : 503
    return Response.json(
      {
        error: {
          code: error instanceof HttpError ? error.code : 'AUTH_UNAVAILABLE',
          message:
            error instanceof HttpError
              ? error.message
              : 'Authentication is unavailable. Check the database and migration status.',
        },
      },
      {
        status,
        headers: {
          'Cache-Control': 'no-store',
          ...(status === 429 ? { 'Retry-After': '60' } : {}),
        },
      },
    )
  }
}
