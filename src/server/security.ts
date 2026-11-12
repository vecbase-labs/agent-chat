import { createHash } from 'node:crypto'
import { z } from 'zod'
import { getAuth } from './auth'
import { query } from './db'
import { getEnv } from './env'
import { fail } from './errors'
import type { Actor } from '../lib/types'

export const uuid = z.string().uuid()
export const hash = (value: string | Uint8Array) =>
  createHash('sha256').update(value).digest('hex')
export const actorColumns =
  'id,name,kind,owner_id,description,disabled_at,last_active_at,avatar_id'

export async function recordAgentActivity(actor: Actor) {
  if (
    actor.kind !== 'agent' ||
    (actor.last_active_at &&
      Date.now() - new Date(actor.last_active_at).getTime() < 60_000)
  )
    return
  // The database condition also coalesces concurrent requests across instances.
  await query(
    `UPDATE actors SET last_active_at=now() WHERE id=$1 AND kind='agent'
      AND disabled_at IS NULL
      AND (last_active_at IS NULL OR last_active_at < now()-interval '1 minute')`,
    [actor.id],
  )
}
export async function authenticate(
  request: Request,
  optional = false,
): Promise<Actor | null> {
  const authorization = request.headers.get('authorization')
  let actor: Actor | undefined
  if (authorization) {
    if (!/^Bearer ac_[a-zA-Z0-9_-]{40,100}$/.test(authorization))
      fail(401, 'UNAUTHORIZED', 'Invalid agent credential.')
    actor = (
      await query<Actor>(
        `SELECT ${actorColumns} FROM actors WHERE token_hash=$1 AND disabled_at IS NULL`,
        [hash(authorization.slice(7))],
      )
    )[0]
  } else {
    const session = await getAuth().api.getSession({ headers: request.headers })
    if (session)
      actor = (
        await query<Actor>(
          `SELECT ${actorColumns} FROM actors WHERE user_id=$1 AND disabled_at IS NULL`,
          [session.user.id],
        )
      )[0]
  }
  if (!actor) {
    if (optional) return null
    fail(401, 'UNAUTHORIZED', 'Sign in or connect an agent.')
  }
  return actor
}
export function requireOwner(actor: Actor) {
  if (actor.kind !== 'human' || actor.owner_id !== null)
    fail(
      403,
      'FORBIDDEN',
      'Only your personal account can manage agents and chats.',
    )
}
export function checkOrigin(request: Request) {
  if (['GET', 'HEAD', 'OPTIONS'].includes(request.method)) return
  const origin = request.headers.get('origin')
  if (origin && origin !== getEnv().appUrl)
    fail(403, 'ORIGIN_REJECTED', 'Request origin is not allowed.')
  if (!origin && request.headers.has('cookie'))
    fail(403, 'ORIGIN_REQUIRED', 'Browser mutations require an Origin header.')
}
export async function limit(key: string, max = 120) {
  const [row] = await query<{ count: number }>(
    `INSERT INTO request_limits(key,bucket,count) VALUES($1,date_trunc('minute',now()),1)
    ON CONFLICT(key) DO UPDATE SET bucket=date_trunc('minute',now()),count=CASE
    WHEN request_limits.bucket=date_trunc('minute',now()) THEN request_limits.count+1 ELSE 1 END RETURNING count`,
    [key],
  )
  if (row.count > max)
    fail(429, 'RATE_LIMITED', 'Too many requests. Try again in one minute.')
}
export async function readBytes(request: Request, maximum: number) {
  if (Number(request.headers.get('content-length')) > maximum)
    fail(413, 'TOO_LARGE', 'Request is too large.')
  const reader = request.body?.getReader()
  if (!reader) return Buffer.alloc(0)
  const chunks: Uint8Array[] = []
  let length = 0
  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      length += value.byteLength
      if (length > maximum) {
        await reader.cancel()
        fail(413, 'TOO_LARGE', 'Request is too large.')
      }
      chunks.push(value)
    }
  } finally {
    reader.releaseLock()
  }
  return Buffer.concat(chunks)
}
export async function body<T extends z.ZodType>(
  request: Request,
  schema: T,
): Promise<z.infer<T>> {
  if (!request.headers.get('content-type')?.includes('application/json'))
    fail(415, 'CONTENT_TYPE', 'Use application/json.')
  let data: unknown
  try {
    data = JSON.parse((await readBytes(request, 128 * 1024)).toString())
  } catch (error) {
    if (error instanceof SyntaxError)
      fail(400, 'INVALID_JSON', 'Invalid JSON body.')
    throw error
  }
  return schema.parse(data)
}
