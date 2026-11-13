import { newId } from '../lib/id'
import { query, transaction } from './db'
import { fail } from './errors'
import { hash, readBytes, requireOwner } from './security'
import { fileStorage } from './storage'
import type { Actor } from '../lib/types'

const maxBytes = 256 * 1024
const signature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])
const crcTable = Array.from({ length: 256 }, (_, value) => {
  for (let bit = 0; bit < 8; bit++)
    value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1
  return value >>> 0
})
function crc32(bytes: Uint8Array) {
  let crc = 0xffffffff
  for (const byte of bytes) crc = crcTable[(crc ^ byte) & 255] ^ (crc >>> 8)
  return (crc ^ 0xffffffff) >>> 0
}

// Browsers crop/re-encode uploads first. Validate the bounded PNG container again,
// retaining only pixels and the header; metadata and animation do not survive.
export function avatarPng(content: Buffer) {
  const invalid = () =>
    fail(
      400,
      'INVALID_AVATAR',
      'Choose a PNG, JPEG or WebP image using the photo picker.',
    )
  if (content.length > maxBytes || !content.subarray(0, 8).equals(signature))
    invalid()
  const chunks: Buffer[] = [signature]
  let offset = 8,
    header = false,
    pixels = false,
    ended = false
  while (offset + 12 <= content.length) {
    const length = content.readUInt32BE(offset)
    if (length > maxBytes || offset + length + 12 > content.length) invalid()
    const type = content.toString('ascii', offset + 4, offset + 8)
    const data = content.subarray(offset + 8, offset + 8 + length)
    const end = offset + length + 12
    if (
      crc32(content.subarray(offset + 4, end - 4)) !==
      content.readUInt32BE(end - 4)
    )
      invalid()
    if (!header && type !== 'IHDR') invalid()
    if (type === 'IHDR') {
      if (header || length !== 13) invalid()
      const width = data.readUInt32BE(0),
        height = data.readUInt32BE(4)
      if (
        !width ||
        !height ||
        width > 512 ||
        height > 512 ||
        width !== height ||
        data[8] !== 8 ||
        ![2, 6].includes(data[9]) ||
        data[10] ||
        data[11] ||
        data[12]
      )
        invalid()
      header = true
      chunks.push(content.subarray(offset, end))
    } else if (type === 'IDAT') {
      pixels = true
      chunks.push(content.subarray(offset, end))
    } else if (type === 'IEND') {
      if (length !== 0 || !pixels || end !== content.length) invalid()
      chunks.push(content.subarray(offset, end))
      ended = true
      break
    } else if (
      !/^[a-z][A-Za-z]{3}$/.test(type) ||
      ['acTL', 'fcTL', 'fdAT'].includes(type)
    ) {
      invalid()
    }
    offset = end
  }
  if (!ended) invalid()
  return Buffer.concat(chunks)
}

async function discard(id: string | null) {
  if (id)
    await fileStorage()
      .delete(id)
      .catch(() => {
        console.error('An unused avatar object could not be removed.')
      })
}

export async function updateAvatar(
  owner: Actor,
  agentId: string,
  request: Request,
) {
  requireOwner(owner)
  const remove = request.method === 'DELETE'
  if (
    !remove &&
    request.headers.get('content-type')?.split(';')[0] !== 'image/png'
  )
    fail(415, 'CONTENT_TYPE', 'Upload a normalized image/png avatar.')
  const content = remove ? null : avatarPng(await readBytes(request, maxBytes))
  const avatarId = content ? newId() : null
  if (content && avatarId) await fileStorage().put(avatarId, content)
  let previous: string | null
  try {
    previous = await transaction(async (client) => {
      const { rows } = await client.query<{ avatar_id: string | null }>(
        "SELECT avatar_id FROM actors WHERE id=$1 AND owner_id=$2 AND kind='agent' AND deleted_at IS NULL FOR UPDATE",
        [agentId, owner.id],
      )
      if (!rows[0]) fail(404, 'NOT_FOUND', 'Agent not found.')
      await client.query(
        'UPDATE actors SET avatar_id=$2,avatar_sha256=$3,avatar_bytes=$4 WHERE id=$1',
        [
          agentId,
          avatarId,
          content ? hash(content) : null,
          content?.length ?? null,
        ],
      )
      return rows[0].avatar_id
    })
  } catch (error) {
    await discard(avatarId)
    throw error
  }
  await discard(previous)
  return { avatar_id: avatarId }
}

export async function readAvatar(viewer: Actor, id: string, request: Request) {
  const [avatar] = await query<{ avatar_sha256: string }>(
    `SELECT a.avatar_sha256 FROM actors a WHERE a.avatar_id=$1 AND
      (a.id=$2 OR a.owner_id=$2 OR EXISTS (
        SELECT 1 FROM conversation_members mine JOIN conversation_members peer USING(conversation_id)
        WHERE mine.actor_id=$2 AND peer.actor_id=a.id)
       OR EXISTS (SELECT 1 FROM messages m JOIN conversation_members mine ON mine.conversation_id=m.conversation_id
         WHERE mine.actor_id=$2 AND m.sender_id=a.id))`,
    [id, viewer.id],
  )
  if (!avatar) fail(404, 'NOT_FOUND', 'Photo not found.')
  const headers = {
    'Content-Type': 'image/png',
    'Content-Disposition': 'inline; filename="avatar.png"',
    'Cache-Control': 'private, no-cache',
    Vary: 'Cookie, Authorization',
    ETag: `"${avatar.avatar_sha256}"`,
    'X-Content-Type-Options': 'nosniff',
    'Content-Security-Policy': "default-src 'none'; sandbox",
  }
  if (request.headers.get('if-none-match') === headers.ETag)
    return new Response(null, { status: 304, headers })
  const content = await fileStorage().get(id)
  if (!content) fail(404, 'NOT_FOUND', 'Photo not found.')
  if (hash(content) !== avatar.avatar_sha256)
    fail(500, 'FILE_INTEGRITY', 'Photo integrity check failed.')
  return new Response(new Uint8Array(content), { headers })
}
