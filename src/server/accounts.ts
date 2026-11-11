import { randomBytes, randomInt, randomUUID } from 'node:crypto'
import { hashPassword } from 'better-auth/crypto'
import { z } from 'zod'
import { newId } from '../lib/id'
import {
  MIN_PASSWORD_LENGTH,
  MAX_PASSWORD_LENGTH,
} from '../lib/password-policy'
import { transaction } from './db'
import { actorColumns, hash, sameSecret } from './security'
import { getEnv } from './env'
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
  token: z.string().max(200).optional(),
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
  const env = getEnv()
  if (
    !env.localSetup &&
    (!env.setupToken || !sameSecret(data.token || '', env.setupToken))
  )
    fail(403, 'SETUP_TOKEN_REQUIRED', 'Enter the installation setup token.')
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

export async function enrollment(agentId: string, reconnect = false) {
  return transaction(async (client) => {
    const result = await client.query(
      `SELECT id FROM actors WHERE id=$1 AND kind='agent' FOR UPDATE`,
      [agentId],
    )
    if (!result.rowCount) fail(404, 'NOT_FOUND', 'Agent not found.')
    await client.query(
      `UPDATE enrollments SET consumed_at=now() WHERE actor_id=$1 AND consumed_at IS NULL`,
      [agentId],
    )
    if (reconnect)
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
        `INSERT INTO enrollments(id,actor_id,code_hash,expires_at) VALUES($1,$2,$3,now()+interval '10 minutes') ON CONFLICT (code_hash) DO NOTHING RETURNING id`,
        [newId(), agentId, hash(code)],
      )
      if (inserted.rowCount)
        return { code, expiresIn: 600, server: getEnv().appUrl, agentId }
    }
    fail(
      503,
      'PAIRING_UNAVAILABLE',
      'Unable to create a pairing code. Try again.',
    )
  })
}
export async function pair(code: string) {
  code = normalizePairingCode(code)
  const token = 'ac_' + randomBytes(32).toString('base64url')
  return transaction(async (client) => {
    // Every credential mutation locks the identity first, then its codes.
    // This order also applies to reconnect and disable, avoiding a deadlock.
    const candidate = await client.query<{ actor_id: string }>(
      'SELECT actor_id FROM enrollments WHERE code_hash=$1',
      [hash(code)],
    )
    if (!candidate.rows[0])
      fail(
        400,
        'INVALID_CODE',
        'The pairing code is invalid, expired, or already used.',
      )
    await client.query('SELECT id FROM actors WHERE id=$1 FOR UPDATE', [
      candidate.rows[0].actor_id,
    ])
    const { rows } = await client.query<{ actor_id: string }>(
      `UPDATE enrollments SET consumed_at=now()
      WHERE code_hash=$1 AND expires_at>now() AND consumed_at IS NULL RETURNING actor_id`,
      [hash(code)],
    )
    if (!rows[0])
      fail(
        400,
        'INVALID_CODE',
        'The pairing code is invalid, expired, or already used.',
      )
    const agent = await client.query<Actor>(
      `UPDATE actors SET token_hash=$2
      WHERE id=$1 AND disabled_at IS NULL RETURNING ${actorColumns}`,
      [rows[0].actor_id, hash(token)],
    )
    if (!agent.rows[0]) fail(403, 'DISABLED', 'This agent is disabled.')
    return { token, actor: agent.rows[0] }
  })
}
