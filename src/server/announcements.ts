import { z } from 'zod'
import { query, transaction } from './db'
import { fail } from './errors'
import { requireOwner } from './security'
import { membership } from './conversations'
import { cursorSchema } from './cursors'
import type { Actor } from '../lib/types'

export const announcementInput = z.strictObject({
  text: z.string().trim().max(2000),
  version: cursorSchema,
})
export type Announcement = {
  conversationId: string
  text: string
  version: string
  updatedAt: string | null
  updatedBy: string | null
}

export async function announcementChanges(
  actor: Actor,
  conversationId?: string,
) {
  return query<{
    conversationId: string
    name: string
    version: string
    updatedAt: string
  }>(
    `SELECT c.id AS "conversationId",c.name,a.version::text,a.updated_at AS "updatedAt"
     FROM conversation_members m JOIN conversations c ON c.id=m.conversation_id
     JOIN conversation_announcements a ON a.conversation_id=c.id
     WHERE m.actor_id=$1 AND a.version>m.announcement_read_version
       AND ($2::uuid IS NULL OR c.id=$2) ORDER BY a.updated_at,c.id LIMIT 200`,
    [actor.id, conversationId || null],
  )
}
export async function readAnnouncement(
  actor: Actor,
  id: string,
): Promise<Announcement> {
  const room = await membership(actor, id, true)
  if (room.kind !== 'group')
    fail(400, 'GROUP_REQUIRED', 'Announcements belong to group chats.')
  const [row] = await query<Announcement>(
    `SELECT conversation_id AS "conversationId",text,version::text,updated_at AS "updatedAt",
      updated_by AS "updatedBy" FROM conversation_announcements WHERE conversation_id=$1`,
    [id],
  )
  return (
    row || {
      conversationId: id,
      text: '',
      version: '0',
      updatedAt: null,
      updatedBy: null,
    }
  )
}
export async function updateAnnouncement(
  actor: Actor,
  id: string,
  input: z.infer<typeof announcementInput>,
) {
  requireOwner(actor)
  return transaction(async (client) => {
    const room = await client.query(
      'SELECT kind,owner_id FROM conversations WHERE id=$1 FOR UPDATE',
      [id],
    )
    if (!room.rows[0] || room.rows[0].owner_id !== actor.id)
      fail(404, 'NOT_FOUND', 'Conversation not found.')
    if (room.rows[0].kind !== 'group')
      fail(400, 'GROUP_REQUIRED', 'Announcements belong to group chats.')
    const current = (
      await client.query(
        'SELECT text,version::text FROM conversation_announcements WHERE conversation_id=$1',
        [id],
      )
    ).rows[0]
    const version = current?.version || '0'
    if ((current?.text || '') !== input.text) {
      if (version !== input.version)
        fail(
          409,
          'VERSION_CONFLICT',
          'The announcement changed. Reload it before saving.',
        )
      await client.query(
        `INSERT INTO conversation_announcements(conversation_id,text,updated_by) VALUES($1,$2,$3)
        ON CONFLICT(conversation_id) DO UPDATE SET text=$2,version=conversation_announcements.version+1,
        updated_at=clock_timestamp(),updated_by=$3`,
        [id, input.text, actor.id],
      )
    }
    const row = (
      await client.query<Announcement>(
        `SELECT conversation_id AS "conversationId",text,version::text,
      updated_at AS "updatedAt",updated_by AS "updatedBy" FROM conversation_announcements WHERE conversation_id=$1`,
        [id],
      )
    ).rows[0]
    return (
      row || {
        conversationId: id,
        text: '',
        version: '0',
        updatedAt: null,
        updatedBy: null,
      }
    )
  })
}
export async function markAnnouncementRead(
  actor: Actor,
  id: string,
  version: string,
) {
  const room = await membership(actor, id, true)
  if (room.kind !== 'group')
    fail(400, 'GROUP_REQUIRED', 'Announcements belong to group chats.')
  if (room.last_read_seq === null) return { recorded: false }
  // Only the version actually returned to the reader is acknowledged. A newer
  // concurrent edit remains discoverable; message receipts are never changed.
  const rows = await query(
    `UPDATE conversation_members m SET announcement_read_version=GREATEST(m.announcement_read_version,$3::bigint)
    WHERE m.conversation_id=$1 AND m.actor_id=$2
    AND $3::bigint<=COALESCE((SELECT version FROM conversation_announcements WHERE conversation_id=$1),0) RETURNING actor_id`,
    [id, actor.id, version],
  )
  if (!rows.length)
    fail(
      409,
      'VERSION_CONFLICT',
      'Invalid announcement version or membership changed.',
    )
  return { recorded: true }
}
