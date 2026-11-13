import { newId } from '../lib/id'
import { query, transaction } from './db'
import { getEnv } from './env'
import { fail } from './errors'
import { membership, requireOpenConversation } from './conversations'
import { hash, readBytes } from './security'
import type { Actor, Attachment } from '../lib/types'
import { fileStorage } from './storage'

export async function uploadFile(
  actor: Actor,
  conversationId: string,
  request: Request,
) {
  await membership(actor, conversationId)
  const env = getEnv()
  let name: string
  try {
    name = decodeURIComponent(
      request.headers.get('x-file-name') || 'attachment',
    )
  } catch {
    fail(400, 'INVALID_NAME', 'Invalid file name.')
  }
  // Strip path separators and control characters from untrusted display metadata.
  name = name.replace(/[\p{Cc}/\\]/gu, '_').slice(0, 240) || 'attachment'
  const content = await readBytes(request, env.maxFileBytes)
  if (!content.byteLength) fail(400, 'EMPTY_FILE', 'Choose a non-empty file.')
  const id = newId()
  const storage = fileStorage()
  await storage.put(id, content)
  try {
    return await transaction(async (client) => {
      // Serialize quota accounting and revocation with uploads for this identity.
      const active = await client.query(
        'SELECT id FROM actors WHERE id=$1 AND disabled_at IS NULL FOR UPDATE',
        [actor.id],
      )
      if (!active.rowCount) fail(403, 'FORBIDDEN', 'Upload access was revoked.')
      const {
        rows: [usage],
      } = await client.query<{ bytes: string }>(
        'SELECT COALESCE(sum(bytes),0)::text AS bytes FROM files WHERE uploader_id=$1',
        [actor.id],
      )
      if (BigInt(usage.bytes) + BigInt(content.byteLength) > 1073741824n)
        fail(
          413,
          'STORAGE_QUOTA',
          'This identity has reached its 1 GiB file quota.',
        )
      await client.query('SELECT id FROM conversations WHERE id=$1 FOR SHARE', [
        conversationId,
      ])
      await requireOpenConversation(client, conversationId)
      if (
        !(
          await client.query(
            'SELECT 1 FROM conversation_members WHERE conversation_id=$1 AND actor_id=$2',
            [conversationId, actor.id],
          )
        ).rowCount
      )
        fail(403, 'FORBIDDEN', 'Conversation access was revoked.')
      const { rows } = await client.query<Attachment>(
        `INSERT INTO files(id,conversation_id,uploader_id,name,mime_type,bytes,sha256)
        VALUES($1,$2,$3,$4,$5,$6,$7) RETURNING id,name,mime_type,bytes,sha256`,
        [
          id,
          conversationId,
          actor.id,
          name,
          (
            request.headers.get('content-type') || 'application/octet-stream'
          ).slice(0, 100),
          content.byteLength,
          hash(content),
        ],
      )
      return rows[0]
    })
  } catch (error) {
    await storage.delete(id).catch(() => {})
    throw error
  }
}
export async function downloadFile(actor: Actor, id: string) {
  const [file] = await query<
    Attachment & {
      conversation_id: string
      uploader_id: string
      message_id: string | null
    }
  >('SELECT * FROM files WHERE id=$1', [id])
  if (!file) fail(404, 'NOT_FOUND', 'File not found.')
  await membership(actor, file.conversation_id, true)
  if (!file.message_id && file.uploader_id !== actor.id)
    fail(404, 'NOT_FOUND', 'File not found.')
  const content = await fileStorage().get(id)
  if (!content) {
    fail(
      404,
      'FILE_MISSING',
      'File content is unavailable. Check file storage on your installation.',
    )
  }
  if (hash(content) !== file.sha256)
    fail(500, 'FILE_INTEGRITY', 'File integrity check failed.')
  return new Response(new Uint8Array(content), {
    headers: {
      'Content-Type': 'application/octet-stream',
      'Content-Length': String(content.byteLength),
      'Content-Disposition': `attachment; filename="attachment"; filename*=UTF-8''${encodeURIComponent(file.name).replaceAll("'", '%27')}`,
      'X-Content-Type-Options': 'nosniff',
      'Cache-Control': 'private, no-store',
      'Content-Security-Policy': "default-src 'none'; sandbox",
      'X-Content-SHA256': file.sha256,
    },
  })
}
