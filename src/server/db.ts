import { Pool } from 'pg'
import type { PoolClient, QueryResultRow } from 'pg'
import { getEnv } from './env'
import { SCHEMA_VERSION } from '../lib/version'
import { requestRuntime } from './runtime'
import manifest from '../../migrations/manifest.json'

let pool: Pool | undefined
export function getPool() {
  const runtime = requestRuntime.getStore()
  if (runtime) {
    runtime.pool ??= new Pool({
      connectionString: runtime.databaseUrl,
      max: 2,
      connectionTimeoutMillis: 5_000,
      application_name: 'agent-chat-worker',
    })
    return runtime.pool
  }
  pool ??= new Pool({
    connectionString: getEnv().databaseUrl,
    max: 12,
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 5_000,
    statement_timeout: 15_000,
    application_name: 'agent-chat',
  })
  return pool
}
export async function query<T extends QueryResultRow>(
  sql: string,
  values: unknown[] = [],
) {
  return (await getPool().query<T>(sql, values)).rows
}
export async function transaction<T>(fn: (client: PoolClient) => Promise<T>) {
  const client = await getPool().connect()
  try {
    await client.query('BEGIN')
    const result = await fn(client)
    await client.query('COMMIT')
    return result
  } catch (error) {
    await client.query('ROLLBACK')
    throw error
  } finally {
    client.release()
  }
}
let checkedAt = 0
export async function ensureSchema() {
  const runtime = requestRuntime.getStore()
  if (
    runtime ? runtime.memo.has('schemaChecked') : Date.now() - checkedAt < 5_000
  )
    return
  const rows = await query<{ version: number; name: string; checksum: string }>(
    'SELECT version,name,checksum FROM schema_migrations ORDER BY version',
  )
  if (
    rows.at(-1)?.version !== SCHEMA_VERSION ||
    rows.length !== manifest.length ||
    rows.some(
      (row, index) =>
        row.version !== manifest[index].version ||
        row.name !== manifest[index].name ||
        row.checksum !== manifest[index].checksum,
    )
  ) {
    throw new Error(
      'Database version is incompatible. Run pnpm db:status and follow docs/upgrading.md.',
    )
  }
  if (runtime) runtime.memo.set('schemaChecked', true)
  else checkedAt = Date.now()
}
