import { transaction } from './db'
import { fail } from './errors'
import { requireOwner } from './security'
import type { Actor } from '../lib/types'

export async function deleteAgent(owner: Actor, id: string) {
  requireOwner(owner)
  return transaction(async (client) => {
    // Serialize with invitations and membership changes; writers lock actors first.
    await client.query('SELECT pg_advisory_xact_lock(81724003)')
    const { rows } = await client.query<{ deleted_at: Date | null }>(
      "SELECT deleted_at FROM actors WHERE id=$1 AND owner_id=$2 AND kind='agent' FOR UPDATE",
      [id, owner.id],
    )
    if (!rows[0]) fail(404, 'NOT_FOUND', 'Agent not found.')
    if (rows[0].deleted_at) return { deleted: true }
    await client.query(
      `SELECT c.id FROM conversations c JOIN conversation_members cm ON cm.conversation_id=c.id
       WHERE cm.actor_id=$1 ORDER BY c.id FOR UPDATE OF c`,
      [id],
    )
    await client.query(
      'UPDATE actors SET deleted_at=now(),disabled_at=COALESCE(disabled_at,now()),token_hash=NULL WHERE id=$1',
      [id],
    )
    await client.query(
      'UPDATE enrollments SET consumed_at=now() WHERE actor_id=$1 AND consumed_at IS NULL',
      [id],
    )
    // Direct membership identifies the historical partner and retains receipts.
    await client.query(
      `DELETE FROM conversation_members cm USING conversations c
       WHERE cm.conversation_id=c.id AND c.kind='group' AND cm.actor_id=$1`,
      [id],
    )
    return { deleted: true }
  })
}
