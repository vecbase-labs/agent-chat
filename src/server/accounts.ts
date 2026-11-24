import { randomBytes, randomInt, randomUUID } from 'node:crypto'
import { hashPassword } from 'better-auth/crypto'
import { z } from 'zod'
import { newId } from '../lib/id'
import {
  MIN_PASSWORD_LENGTH,
  MAX_PASSWORD_LENGTH,
} from '../lib/password-policy'
import { query, transaction } from './db'
import { actorColumns, hash } from './security'
import { getEnv } from './env'
import { openCredential, sealCredential } from './pairing-recovery'
import { fail } from './errors'
import type { PoolClient } from 'pg'
import type { Actor } from '../lib/types'

export const accountInput = z.object({
  name: z.string().trim().min(1).max(80),
  username: z
    .string()
    .trim()
    .toLowerCase()
    .regex(/^[a-z0-9_]{3,40}$/),
  password: z.string().min(MIN_PASSWORD_LENGTH).max(MAX_PASSWORD_LENGTH),
})
type AccountInput = z.infer<typeof accountInput>
async function createHuman(
  client: PoolClient,
  data: AccountInput,
  passwordHash: string,
) {
  await client.query('SELECT pg_advisory_xact_lock(81724004)')
  if (
    Number((await client.query('SELECT count(*) FROM actors')).rows[0].count) >=
    1000
  )
    fail(409, 'LIMIT_REACHED', 'Identity limit reached for this release.')
  const userId = randomUUID(),
    actorId = newId()
  if (
    (
      await client.query('SELECT id FROM ac_user WHERE username=$1', [
        data.username,
      ])
    ).rowCount
  )
    fail(409, 'USERNAME_TAKEN', 'Choose another username.')
  // Internal identifier only. No email service or password-reset email is implied.
  await client.query(
    `INSERT INTO ac_user(id,name,email,username,"displayUsername") VALUES($1,$2,$3,$4,$4)`,
    [userId, data.name, `${data.username}@users.invalid`, data.username],
  )
  await client.query(
    `INSERT INTO ac_account(id,"accountId","providerId","userId",password) VALUES($1,$2,'credential',$2,$3)`,
    [randomUUID(), userId, passwordHash],
  )
  await client.query(
    `INSERT INTO actors(id,user_id,kind,name) VALUES($1,$2,'human',$3)`,
    [actorId, userId, data.name],
  )
  return actorId
}
export async function setup(data: AccountInput) {
  const passwordHash = await hashPassword(data.password)
  return transaction(async (client) => {
    await client.query('SELECT pg_advisory_xact_lock(81724002)')
    if ((await client.query('SELECT id FROM instance')).rowCount)
      fail(
        409,
        'ALREADY_INITIALIZED',
        'This installation is already configured.',
      )
    const ownerId = await createHuman(client, data, passwordHash)
    await client.query(
      "INSERT INTO instance(id,name,owner_id) VALUES(1,'Agent Chat',$1)",
      [ownerId],
    )
    return { initialized: true }
  })
}
const pairingAlphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'

function normalizePairingCode(code: string) {
  const compact = code.replace(/[\s-]/g, '').toUpperCase()
  // Legacy 24-character codes remain case-sensitive until their normal expiry.
  return /^[A-HJ-NP-Z2-9]{8}$/.test(compact)
    ? `${compact.slice(0, 4)}-${compact.slice(4)}`
    : code.trim()
}

export async function enrollment(
  agentId: string,
  mode: 'new' | 'reconnect' | 'refresh' = 'new',
) {
  return transaction(async (client) => {
    const result = await client.query(
      `SELECT id,token_hash,disabled_at FROM actors WHERE id=$1 AND kind='agent' AND deleted_at IS NULL FOR UPDATE`,
      [agentId],
    )
    if (!result.rowCount) fail(404, 'NOT_FOUND', 'Agent not found.')
    if (
      mode === 'refresh' &&
      (result.rows[0].token_hash || result.rows[0].disabled_at)
    )
      fail(
        409,
        'PAIRING_CHANGED',
        'This agent is connected or disabled. Return to Agents to reconnect it.',
      )
    await client.query(
      `UPDATE enrollments SET consumed_at=COALESCE(consumed_at,now()),retry_hash=NULL,recovery_ciphertext=NULL,recovery_until=NULL,issued_token_hash=NULL WHERE actor_id=$1`,
      [agentId],
    )
    if (mode === 'reconnect')
      await client.query(
        'UPDATE actors SET token_hash=NULL,disabled_at=NULL WHERE id=$1',
        [agentId],
      )
    // Collision retries stay inside the transaction without aborting it.
    for (let attempt = 0; attempt < 5; attempt++) {
      const symbols = Array.from(
        { length: 8 },
        () => pairingAlphabet[randomInt(pairingAlphabet.length)],
      ).join('')
      const code = `${symbols.slice(0, 4)}-${symbols.slice(4)}`
      const inserted = await client.query(
        `INSERT INTO enrollments(id,actor_id,code_hash,expires_at) VALUES($1,$2,$3,now()+interval '10 minutes') ON CONFLICT (code_hash) DO NOTHING RETURNING id,expires_at`,
        [newId(), agentId, hash(code)],
      )
      if (inserted.rowCount)
        return {
          code,
          expiresIn: 600,
          expiresAt: inserted.rows[0].expires_at,
          enrollmentId: inserted.rows[0].id,
          server: getEnv().appUrl,
          agentId,
        }
    }
    fail(
      503,
      'PAIRING_UNAVAILABLE',
      'Unable to create a pairing code. Try again.',
    )
  })
}
export async function enrollmentStatus(agentId: string, enrollmentId: string) {
  const [row] = await query<{
    status: 'active' | 'expired' | 'replaced' | 'paired' | 'disabled'
    expires_at: Date
    expires_in: number
  }>(
    `SELECT CASE
      WHEN a.disabled_at IS NOT NULL THEN 'disabled'
      WHEN a.token_hash IS NOT NULL THEN 'paired'
      WHEN e.consumed_at IS NOT NULL THEN 'replaced'
      WHEN e.expires_at<=clock_timestamp() THEN 'expired'
      ELSE 'active' END AS status,
      e.expires_at,GREATEST(0,CEIL(EXTRACT(EPOCH FROM (e.expires_at-clock_timestamp()))))::int AS expires_in
     FROM enrollments e JOIN actors a ON a.id=e.actor_id
     WHERE e.id=$1 AND e.actor_id=$2 AND a.deleted_at IS NULL`,
    [enrollmentId, agentId],
  )
  if (!row) fail(404, 'NOT_FOUND', 'Pairing code not found.')
  return {
    status: row.status,
    expiresAt: row.expires_at,
    expiresIn: row.expires_in,
  }
}
export const pairInput = z.object({
  code: z.string().min(8).max(100),
  retrySecret: z
    .string()
    .regex(/^[A-Za-z0-9_-]{43}$/)
    .optional(),
})

export async function pair(code: string, retrySecret?: string) {
  code = normalizePairingCode(code)
  // Bounded, opportunistic cleanup; expiry is enforced even before cleanup runs.
  await query(`UPDATE enrollments SET retry_hash=NULL,recovery_ciphertext=NULL,
    recovery_until=NULL,issued_token_hash=NULL WHERE id IN
    (SELECT id FROM enrollments WHERE recovery_until<=clock_timestamp() LIMIT 100)`)
  return transaction(async (client) => {
    const invalid = () =>
      fail(
        400,
        'INVALID_CODE',
        'The pairing code is invalid, expired, or already used. Get a new code if recovery has expired.',
      )
    const candidate = await client.query<{ actor_id: string }>(
      'SELECT actor_id FROM enrollments WHERE code_hash=$1',
      [hash(code)],
    )
    if (!candidate.rows[0]) return invalid()
    // All credential mutations lock the actor before its enrollments.
    const current = await client.query<Actor & { token_hash: string | null }>(
      `SELECT ${actorColumns},token_hash FROM actors WHERE id=$1 AND disabled_at IS NULL AND deleted_at IS NULL FOR UPDATE`,
      [candidate.rows[0].actor_id],
    )
    if (!current.rows[0]) return invalid()
    const { rows } = await client.query<{
      id: string
      consumed_at: Date | null
      valid: boolean
      recoverable: boolean
      retry_hash: string | null
      recovery_ciphertext: string | null
      issued_token_hash: string | null
    }>(
      `SELECT *,expires_at>clock_timestamp() AS valid,
      recovery_until>clock_timestamp() AS recoverable FROM enrollments WHERE code_hash=$1 FOR UPDATE`,
      [hash(code)],
    )
    const grant = rows[0]
    const { token_hash: currentHash, ...actor } = current.rows[0]
    const binding = `${getEnv().appUrl}:${grant.id}:${actor.id}`
    if (grant.consumed_at) {
      if (
        !retrySecret ||
        !grant.recoverable ||
        grant.retry_hash !== hash(retrySecret) ||
        !grant.recovery_ciphertext ||
        !grant.issued_token_hash ||
        currentHash !== grant.issued_token_hash
      )
        return invalid()
      let token: string
      try {
        token = openCredential(grant.recovery_ciphertext, retrySecret, binding)
      } catch {
        return invalid()
      }
      if (hash(token) !== currentHash) return invalid()
      return { token, actor }
    }
    if (!grant.valid) return invalid()
    const token = 'ac_' + randomBytes(32).toString('base64url')
    await client.query(
      `UPDATE enrollments SET consumed_at=clock_timestamp(),retry_hash=$2,
      recovery_ciphertext=$3,recovery_until=CASE WHEN $2::text IS NULL THEN NULL ELSE clock_timestamp()+interval '10 minutes' END,
      issued_token_hash=$4 WHERE id=$1`,
      [
        grant.id,
        retrySecret ? hash(retrySecret) : null,
        retrySecret ? sealCredential(token, retrySecret, binding) : null,
        retrySecret ? hash(token) : null,
      ],
    )
    await client.query('UPDATE actors SET token_hash=$2 WHERE id=$1', [
      actor.id,
      hash(token),
    ])
    return { token, actor }
  })
}
