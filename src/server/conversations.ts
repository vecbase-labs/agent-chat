import { z } from 'zod'
import { newId } from '../lib/id'
import { query, transaction } from './db'
import { fail } from './errors'
import { actorColumns, hash, requireOwner, uuid } from './security'
import type { PoolClient } from 'pg'
import type { Actor, Conversation, Message } from '../lib/types'

export const cursorSchema = z
  .string()
  .regex(/^(0|[1-9]\d{0,18})$/)
  .refine((v) => BigInt(v) <= 9223372036854775807n, 'Invalid cursor')
export const sendInput = z
  .object({
    text: z.string().max(20000).default(''),
    idempotencyKey: z.string().min(8).max(100),
    replyTo: uuid.nullable().optional(),
    mentions: z.array(uuid).max(50).default([]),
    fileIds: z.array(uuid).max(4).default([]),
  })
  .refine(
    (v) => v.text.trim().length > 0 || v.fileIds.length > 0,
    'A message needs text or a file.',
  )

export async function membership(
  actor: Actor,
  id: string,
  allowReview = false,
) {
  const rows = await query<{
    last_seq: string
    last_read_seq: string | null
    created_by: string
    kind: string
    owner_id: string
  }>(
    `SELECT c.last_seq,cm.last_read_seq,c.created_by,c.kind,c.owner_id FROM conversations c
    LEFT JOIN conversation_members cm ON cm.conversation_id=c.id AND cm.actor_id=$2 WHERE c.id=$1`,
    [id, actor.id],
  )
  if (
    !rows[0] ||
    (rows[0].last_read_seq === null &&
      !(allowReview && actor.kind === 'human' && rows[0].owner_id === actor.id))
  )
    fail(404, 'NOT_FOUND', 'Conversation not found.')
  return rows[0]
}

async function lockWriter(
  client: PoolClient,
  actor: Actor,
  conversationId: string,
) {
  const current = await client.query<Actor>(
    `SELECT ${actorColumns} FROM actors WHERE id=$1 AND disabled_at IS NULL FOR SHARE`,
    [actor.id],
  )
  if (!current.rows[0]) fail(403, 'DISABLED', 'Access was revoked.')
  const room = await client.query(
    'SELECT id FROM conversations WHERE id=$1 FOR UPDATE',
    [conversationId],
  )
  if (!room.rowCount) fail(404, 'NOT_FOUND', 'Conversation not found.')
  if (
    !(
      await client.query(
        'SELECT 1 FROM conversation_members WHERE conversation_id=$1 AND actor_id=$2',
        [conversationId, actor.id],
      )
    ).rowCount
  )
    fail(403, 'NOT_A_MEMBER', 'Join this conversation before sending.')
}

export async function listConversations(
  actor: Actor,
  search = '',
  cursor?: string,
) {
  let boundary: [string, string] | undefined
  if (cursor) {
    try {
      boundary = z
        .tuple([z.string().datetime({ offset: true }), uuid])
        .parse(JSON.parse(Buffer.from(cursor, 'base64url').toString()))
    } catch {
      fail(400, 'INVALID_CURSOR', 'Invalid conversation cursor.')
    }
  }
  // The initial release caps membership at 200 conversations per identity. The UI
  // returns a bounded list; incremental message history uses separate cursors.
  const rows = await query<Conversation & { page_time: string }>(
    `SELECT c.*,to_char(c.updated_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS page_time, cm.last_read_seq, (cm.actor_id IS NOT NULL) AS joined,
    COALESCE((SELECT jsonb_agg(jsonb_build_object('id',a.id,'name',a.name,'kind',a.kind,'owner_id',a.owner_id,'description',a.description,'disabled_at',a.disabled_at,'avatar_id',a.avatar_id) ORDER BY a.name)
      FROM conversation_members m JOIN actors a ON a.id=m.actor_id WHERE m.conversation_id=c.id),'[]') AS members,
    (SELECT left(text,160) FROM messages WHERE conversation_id=c.id ORDER BY seq DESC LIMIT 1) AS preview,
    (SELECT count(*)::int FROM messages msg WHERE msg.conversation_id=c.id AND cm.actor_id IS NOT NULL AND msg.seq>GREATEST(cm.last_read_seq,CASE WHEN $2::boolean THEN cm.dismissed_through_seq ELSE 0 END) AND NOT(cm.read_ranges @> msg.seq::numeric) AND msg.sender_id<>$1
      AND (c.kind='direct' OR EXISTS(SELECT 1 FROM message_mentions mm WHERE mm.message_id=msg.id AND mm.actor_id=$1)
      OR EXISTS(SELECT 1 FROM messages parent WHERE parent.id=msg.reply_to AND parent.sender_id=$1))) AS attention,
    (SELECT count(*)::int FROM messages msg WHERE msg.conversation_id=c.id AND cm.actor_id IS NOT NULL AND msg.seq>GREATEST(cm.last_read_seq,CASE WHEN $2::boolean THEN cm.dismissed_through_seq ELSE 0 END) AND NOT(cm.read_ranges @> msg.seq::numeric) AND msg.sender_id<>$1) AS unread
    FROM conversations c LEFT JOIN conversation_members cm ON cm.conversation_id=c.id AND cm.actor_id=$1
    WHERE (cm.actor_id IS NOT NULL OR ($2::boolean AND c.owner_id=$1))
      AND ($3='' OR c.name ILIKE '%' || $3 || '%' OR EXISTS (SELECT 1 FROM conversation_members search_member JOIN actors search_actor ON search_actor.id=search_member.actor_id WHERE search_member.conversation_id=c.id AND search_actor.name ILIKE '%' || $3 || '%'))
      AND ($4::timestamptz IS NULL OR (c.updated_at,c.id)<($4::timestamptz,$5::uuid))
    ORDER BY c.updated_at DESC,c.id DESC LIMIT 201`,
    [
      actor.id,
      actor.kind === 'human',
      search.slice(0, 100),
      boundary?.[0] || null,
      boundary?.[1] || null,
    ],
  )
  const page = rows.slice(0, 200),
    last = page.at(-1)
  return {
    conversations: page.map(
      ({ page_time: _time, ...conversation }) => conversation,
    ),
    truncated: rows.length > 200,
    nextCursor:
      rows.length > 200 && last
        ? Buffer.from(JSON.stringify([last.page_time, last.id])).toString(
            'base64url',
          )
        : null,
  }
}

export async function inbox(actor: Actor) {
  const rooms = await query<{
    id: string
    name: string
    kind: string
    after: string
    latest: string
    unread: number
    attention: number
  }>(
    `SELECT c.id,c.name,c.kind,cm.last_read_seq AS after,c.last_seq AS latest,
    (SELECT count(*)::int FROM messages m WHERE m.conversation_id=c.id AND m.seq>cm.last_read_seq AND NOT(cm.read_ranges @> m.seq::numeric) AND m.sender_id<>$1) AS unread,
    (SELECT count(*)::int FROM messages m WHERE m.conversation_id=c.id AND m.seq>cm.last_read_seq AND NOT(cm.read_ranges @> m.seq::numeric) AND m.sender_id<>$1 AND
      (c.kind='direct' OR EXISTS(SELECT 1 FROM message_mentions mm WHERE mm.message_id=m.id AND mm.actor_id=$1)
      OR EXISTS(SELECT 1 FROM messages p WHERE p.id=m.reply_to AND p.sender_id=$1))) AS attention
    FROM conversation_members cm JOIN conversations c ON c.id=cm.conversation_id
    WHERE cm.actor_id=$1 AND c.last_seq>cm.last_read_seq ORDER BY c.updated_at,c.id LIMIT 200`,
    [actor.id],
  )
  return {
    conversations: rooms.filter((r) => r.unread > 0),
    needsAttention: rooms.some((r) => r.attention > 0),
    unread: rooms.reduce((sum, room) => sum + room.unread, 0),
  }
}

const messageSelect = `SELECT m.id,m.conversation_id,m.seq,m.sender_id,m.text,m.reply_to,m.created_at,a.name AS sender_name,a.kind AS sender_kind,a.avatar_id AS sender_avatar_id,
  left(p.text,240) AS reply_preview,p.seq AS reply_seq,pa.name AS reply_name,
  COALESCE((SELECT jsonb_agg(actor_id) FROM message_mentions WHERE message_id=m.id),'[]') AS mentions,
  COALESCE((SELECT jsonb_agg(jsonb_build_object('id',id,'name',name,'bytes',bytes,'mime_type',mime_type,'sha256',sha256)) FROM files WHERE message_id=m.id),'[]') AS files,
  COALESCE((SELECT jsonb_agg(jsonb_build_object('id',ra.id,'name',ra.name)) FROM conversation_members rm JOIN actors ra ON ra.id=rm.actor_id WHERE rm.conversation_id=m.conversation_id AND rm.actor_id<>m.sender_id AND (rm.last_read_seq>=m.seq OR rm.read_ranges @> m.seq::numeric)),'[]') AS read_by
  FROM messages m JOIN actors a ON a.id=m.sender_id LEFT JOIN messages p ON p.id=m.reply_to LEFT JOIN actors pa ON pa.id=p.sender_id`

export async function readMessages(
  actor: Actor,
  id: string,
  options: {
    after?: string
    before?: string
    around?: string
    latest?: boolean
    limit?: number
  },
) {
  if (
    [
      options.after !== undefined,
      options.before !== undefined,
      options.around !== undefined,
      !!options.latest,
    ].filter(Boolean).length > 1
  )
    fail(
      400,
      'INVALID_CURSOR',
      'Choose after, before, around, or latest, not multiple boundaries.',
    )
  const member = await membership(actor, id, true)
  const review = member.last_read_seq === null
  const count = Math.min(options.limit || 50, 100)
  const descending = options.latest || options.before !== undefined
  const boundary =
    options.before ?? options.after ?? member.last_read_seq ?? '0'
  if (options.around !== undefined) {
    const rows = await query<Message>(
      `${messageSelect} WHERE m.conversation_id=$1 AND m.seq >= GREATEST(1,$2::numeric-$3::int)::bigint ORDER BY m.seq LIMIT $4`,
      [id, options.around, Math.floor(count / 2), count + 1],
    )
    const messages = rows.slice(0, count)
    return {
      messages,
      hasMore: rows.length > count,
      nextCursor: messages.at(-1)?.seq ?? options.around,
      previousCursor: messages[0]?.seq ?? options.around,
      review,
      latest: member.last_seq,
    }
  }
  const condition = options.latest
    ? ''
    : `AND m.seq ${options.before ? '<' : '>'} $2::bigint`
  const unreadOnly =
    !options.latest &&
    options.before === undefined &&
    options.after === undefined &&
    !review
  const unreadCondition = unreadOnly
    ? `AND NOT EXISTS (SELECT 1 FROM conversation_members seen WHERE seen.conversation_id=m.conversation_id AND seen.actor_id=$4 AND seen.read_ranges @> m.seq::numeric)`
    : ''
  const values = options.latest ? [id, count + 1] : [id, boundary, count + 1]
  const limitParameter = values.length
  if (unreadOnly) values.push(actor.id)
  const rows = await query<Message>(
    `${messageSelect} WHERE m.conversation_id=$1 ${condition} ${unreadCondition}
    ORDER BY m.seq ${descending ? 'DESC' : 'ASC'} LIMIT $${limitParameter}`,
    values,
  )
  const hasMore = rows.length > count
  const messages = rows.slice(0, count)
  if (descending) messages.reverse()
  return {
    messages,
    hasMore,
    nextCursor:
      (descending ? messages[0]?.seq : messages.at(-1)?.seq) ?? boundary,
    previousCursor: messages[0]?.seq ?? boundary,
    review,
    latest: member.last_seq,
  }
}

export async function sendMessage(
  actor: Actor,
  conversationId: string,
  input: z.infer<typeof sendInput>,
) {
  const mentions = [...new Set(input.mentions)].sort()
  const fileIds = [...new Set(input.fileIds)].sort()
  const requestHash = hash(
    JSON.stringify({
      conversationId,
      text: input.text,
      replyTo: input.replyTo || null,
      mentions,
      fileIds,
    }),
  )
  return transaction(async (client) => {
    await lockWriter(client, actor, conversationId)
    // Sender-scoped lock serializes reuse of the same retry key even across rooms.
    await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))', [
      actor.id + ':' + input.idempotencyKey,
    ])
    const existing = await client.query<{
      id: string
      seq: string
      request_hash: string
    }>(
      'SELECT id,seq,request_hash FROM messages WHERE sender_id=$1 AND idempotency_key=$2',
      [actor.id, input.idempotencyKey],
    )
    if (existing.rows[0]) {
      if (existing.rows[0].request_hash !== requestHash)
        fail(
          409,
          'IDEMPOTENCY_CONFLICT',
          'This retry key belongs to a different message.',
        )
      return {
        id: existing.rows[0].id,
        seq: existing.rows[0].seq,
        duplicate: true,
      }
    }
    if (mentions.length) {
      const count = await client.query(
        'SELECT actor_id FROM conversation_members WHERE conversation_id=$1 AND actor_id=ANY($2::uuid[])',
        [conversationId, mentions],
      )
      if (count.rowCount !== mentions.length)
        fail(
          400,
          'INVALID_MENTION',
          'Mentions must be members of this conversation.',
        )
    }
    if (
      input.replyTo &&
      !(
        await client.query(
          'SELECT id FROM messages WHERE id=$1 AND conversation_id=$2',
          [input.replyTo, conversationId],
        )
      ).rowCount
    )
      fail(400, 'INVALID_REPLY', 'Reply target is not in this conversation.')
    if (fileIds.length) {
      const result = await client.query(
        `SELECT id FROM files WHERE id=ANY($1::uuid[]) AND conversation_id=$2 AND uploader_id=$3 AND message_id IS NULL FOR UPDATE`,
        [fileIds, conversationId, actor.id],
      )
      if (result.rowCount !== fileIds.length)
        fail(
          400,
          'INVALID_FILE',
          'Attachment is unavailable or already attached.',
        )
    }
    const id = newId()
    const {
      rows: [room],
    } = await client.query<{ last_seq: string }>(
      'UPDATE conversations SET last_seq=last_seq+1,updated_at=now() WHERE id=$1 RETURNING last_seq',
      [conversationId],
    )
    await client.query(
      `INSERT INTO messages(id,conversation_id,seq,sender_id,text,reply_to,idempotency_key,request_hash) VALUES($1,$2,$3,$4,$5,$6,$7,$8)`,
      [
        id,
        conversationId,
        room.last_seq,
        actor.id,
        input.text,
        input.replyTo || null,
        input.idempotencyKey,
        requestHash,
      ],
    )
    if (mentions.length)
      await client.query(
        'INSERT INTO message_mentions(message_id,actor_id) SELECT $1,unnest($2::uuid[])',
        [id, mentions],
      )
    if (fileIds.length)
      await client.query(
        'UPDATE files SET message_id=$1 WHERE id=ANY($2::uuid[])',
        [id, fileIds],
      )
    return { id, seq: room.last_seq, duplicate: false }
  })
}

export const conversationInput = z.object({
  kind: z.enum(['direct', 'group']),
  name: z.string().trim().min(1).max(100).optional(),
  members: z.array(uuid).min(1).max(50),
  idempotencyKey: z.string().min(8).max(100).optional(),
})
export async function createConversation(
  actor: Actor,
  input: z.infer<typeof conversationInput>,
) {
  // The owner can create a direct conversation between two other
  // identities without becoming a participant. Review does not join the conversation.
  const ownerId = actor.owner_id || actor.id
  if (actor.kind === 'agent' && input.kind === 'group' && !input.idempotencyKey)
    fail(
      400,
      'RETRY_KEY_REQUIRED',
      'Use an idempotencyKey when creating a group.',
    )
  const explicitPair =
    actor.kind === 'human' &&
    input.kind === 'direct' &&
    input.members.length === 2
  const members = [
    ...new Set(
      explicitPair
        ? input.members
        : [
            actor.id,
            ...input.members,
            ...(input.kind === 'group' ? [ownerId] : []),
          ],
    ),
  ].sort()
  if (members.length > 50)
    fail(400, 'LIMIT_REACHED', 'A conversation supports up to 50 participants.')
  if (input.kind === 'direct' && members.length !== 2)
    fail(
      400,
      'INVALID_MEMBERS',
      'A direct conversation has exactly two members.',
    )
  if (input.kind === 'group' && !input.name)
    fail(400, 'NAME_REQUIRED', 'Give this group a name.')
  return transaction(async (client) => {
    await client.query('SELECT pg_advisory_xact_lock(81724003)')
    const requestHash = hash(
      JSON.stringify({
        kind: input.kind,
        name: input.kind === 'group' ? input.name : 'Direct message',
        members,
      }),
    )
    if (input.idempotencyKey) {
      const previous = await client.query<{
        id: string
        creation_hash: string
      }>(
        'SELECT id,creation_hash FROM conversations WHERE created_by=$1 AND creation_key=$2 AND owner_id=$3',
        [actor.id, input.idempotencyKey, ownerId],
      )
      if (previous.rows[0]) {
        if (previous.rows[0].creation_hash !== requestHash)
          fail(
            409,
            'IDEMPOTENCY_CONFLICT',
            'This retry key belongs to a different conversation request.',
          )
        if (actor.kind === 'agent')
          await lockWriter(client, actor, previous.rows[0].id)
        return { id: previous.rows[0].id }
      }
    }
    const existingActors = await client.query(
      'SELECT id FROM actors WHERE id=ANY($1::uuid[]) AND disabled_at IS NULL AND (id=$2 OR owner_id=$2) ORDER BY id FOR SHARE',
      [members, ownerId],
    )
    if (existingActors.rowCount !== members.length)
      fail(400, 'INVALID_MEMBERS', 'One or more members are unavailable.')
    const key = input.kind === 'direct' ? members.join(':') : null
    if (key) {
      const existing = await client.query<{ id: string }>(
        'SELECT id FROM conversations WHERE direct_key=$1',
        [key],
      )
      if (existing.rows[0]) return existing.rows[0]
    }
    if (
      (
        await client.query(
          'SELECT actor_id FROM conversation_members WHERE actor_id=ANY($1::uuid[]) GROUP BY actor_id HAVING count(*)>=200',
          [members],
        )
      ).rowCount
    )
      fail(
        409,
        'LIMIT_REACHED',
        'An identity can join up to 200 conversations in this release.',
      )
    const id = newId()
    await client.query(
      'INSERT INTO conversations(id,kind,name,created_by,direct_key,owner_id,creation_key,creation_hash) VALUES($1,$2,$3,$4,$5,$6,$7,$8)',
      [
        id,
        input.kind,
        input.kind === 'group' ? input.name : 'Direct message',
        actor.id,
        key,
        ownerId,
        input.idempotencyKey || null,
        input.idempotencyKey ? requestHash : null,
      ],
    )
    await client.query(
      'INSERT INTO conversation_members(conversation_id,actor_id) SELECT $1,unnest($2::uuid[])',
      [id, members],
    )
    return { id }
  })
}

export async function updateMembers(
  actor: Actor,
  id: string,
  members: string[],
) {
  requireOwner(actor)
  return transaction(async (client) => {
    await client.query('SELECT pg_advisory_xact_lock(81724003)')
    const room = await client.query<{ kind: string; created_by: string }>(
      'SELECT kind,created_by FROM conversations WHERE id=$1 AND owner_id=$2 FOR UPDATE',
      [id, actor.id],
    )
    if (!room.rows[0]) fail(404, 'NOT_FOUND', 'Conversation not found.')
    if (room.rows[0].kind !== 'group')
      fail(
        400,
        'DIRECT_MEMBERS_FIXED',
        'Direct conversation members cannot change.',
      )
    const unique = [...new Set(members)]
    if (!unique.length)
      fail(400, 'MEMBER_REQUIRED', 'A group needs at least one member.')
    if (
      (
        await client.query(
          'SELECT id FROM actors WHERE id=ANY($1::uuid[]) AND disabled_at IS NULL AND (id=$2 OR owner_id=$2)',
          [unique, actor.id],
        )
      ).rowCount !== unique.length
    )
      fail(400, 'INVALID_MEMBERS', 'One or more members are unavailable.')
    if (
      (
        await client.query(
          'SELECT actor_id FROM conversation_members WHERE actor_id=ANY($1::uuid[]) AND conversation_id<>$2 GROUP BY actor_id HAVING count(*)>=200',
          [unique, id],
        )
      ).rowCount
    )
      fail(409, 'LIMIT_REACHED', 'Conversation limit reached.')
    await client.query(
      'DELETE FROM conversation_members WHERE conversation_id=$1 AND NOT(actor_id=ANY($2::uuid[]))',
      [id, unique],
    )
    await client.query(
      'INSERT INTO conversation_members(conversation_id,actor_id) SELECT $1,unnest($2::uuid[]) ON CONFLICT DO NOTHING',
      [id, unique],
    )
    return { updated: true }
  })
}

/** Add participants without replacing membership or resetting existing receipts. */
export async function inviteMembers(
  actor: Actor,
  id: string,
  members: string[],
) {
  const ownerId = actor.owner_id || actor.id
  return transaction(async (client) => {
    await client.query('SELECT pg_advisory_xact_lock(81724003)')
    if (actor.kind === 'agent') await lockWriter(client, actor, id)
    const room = await client.query<{ kind: string }>(
      'SELECT kind FROM conversations WHERE id=$1 AND owner_id=$2 FOR UPDATE',
      [id, ownerId],
    )
    if (!room.rows[0]) fail(404, 'NOT_FOUND', 'Conversation not found.')
    if (room.rows[0].kind !== 'group')
      fail(
        400,
        'DIRECT_MEMBERS_FIXED',
        'Invite participants to a group, not a direct conversation.',
      )
    const unique = [...new Set(members)].sort()
    const available = await client.query(
      'SELECT id FROM actors WHERE id=ANY($1::uuid[]) AND disabled_at IS NULL AND (id=$2 OR owner_id=$2) ORDER BY id FOR SHARE',
      [unique, ownerId],
    )
    if (available.rowCount !== unique.length)
      fail(400, 'INVALID_MEMBERS', 'One or more participants are unavailable.')
    const current = await client.query<{ actor_id: string }>(
      'SELECT actor_id FROM conversation_members WHERE conversation_id=$1',
      [id],
    )
    const existing = new Set(current.rows.map((m) => m.actor_id))
    const added = unique.filter((member) => !existing.has(member))
    if (existing.size + added.length > 50)
      fail(
        409,
        'LIMIT_REACHED',
        'A conversation supports up to 50 participants.',
      )
    if (added.length) {
      if (
        (
          await client.query(
            'SELECT actor_id FROM conversation_members WHERE actor_id=ANY($1::uuid[]) GROUP BY actor_id HAVING count(*)>=200',
            [added],
          )
        ).rowCount
      )
        fail(
          409,
          'LIMIT_REACHED',
          'An identity can join up to 200 conversations in this release.',
        )
      await client.query(
        'INSERT INTO conversation_members(conversation_id,actor_id) SELECT $1,unnest($2::uuid[]) ON CONFLICT DO NOTHING',
        [id, added],
      )
    }
    return { added }
  })
}

/** Fetch bodies without side effects; clients confirm only the IDs they received. */
export async function unreadMessages(actor: Actor, count = 30) {
  const rows = await query<
    Message & { conversation_name: string; conversation_kind: string }
  >(
    `${messageSelect}
    JOIN conversation_members mine ON mine.conversation_id=m.conversation_id AND mine.actor_id=$1
    JOIN conversations c ON c.id=m.conversation_id
    WHERE m.sender_id<>$1 AND m.seq>mine.last_read_seq AND NOT(mine.read_ranges @> m.seq::numeric)
    ORDER BY m.created_at,m.id LIMIT $2`,
    [actor.id, count + 1],
  )
  const messages = rows.slice(0, count)
  const roomIds = [...new Set(messages.map((m) => m.conversation_id))]
  const conversations = roomIds.length
    ? await query<{ id: string; name: string; kind: string }>(
        'SELECT id,name,kind FROM conversations WHERE id=ANY($1::uuid[])',
        [roomIds],
      )
    : []
  return { messages, conversations, hasMore: rows.length > count }
}

/** Dismiss owner notifications through an observed message, without receipts. */
export async function dismissNotifications(
  actor: Actor,
  id: string,
  messageId: string,
) {
  requireOwner(actor)
  await membership(actor, id)
  return transaction(async (client) => {
    const member = await client.query(
      'SELECT 1 FROM conversation_members WHERE conversation_id=$1 AND actor_id=$2 FOR UPDATE',
      [id, actor.id],
    )
    if (!member.rowCount)
      fail(404, 'NOT_FOUND', 'Conversation access was revoked.')
    const message = await client.query<{ seq: string }>(
      'SELECT seq FROM messages WHERE conversation_id=$1 AND id=$2',
      [id, messageId],
    )
    if (!message.rows[0])
      fail(400, 'INVALID_MESSAGE', 'Choose a message in this conversation.')
    const result = await client.query<{ dismissed_through_seq: string }>(
      `UPDATE conversation_members
       SET dismissed_through_seq=GREATEST(dismissed_through_seq,$3::bigint)
       WHERE conversation_id=$1 AND actor_id=$2 RETURNING dismissed_through_seq`,
      [id, actor.id, message.rows[0].seq],
    )
    return { dismissedThrough: result.rows[0].dismissed_through_seq }
  })
}

/** Receipt writes are idempotent, exact, and never bridge unread gaps. */
export async function markRead(actor: Actor, id: string, messageIds: string[]) {
  const member = await membership(actor, id, true)
  if (member.last_read_seq === null) return { read: 0, review: true }
  return transaction(async (client) => {
    const result = await client.query(
      'SELECT 1 FROM conversation_members WHERE conversation_id=$1 AND actor_id=$2 FOR UPDATE',
      [id, actor.id],
    )
    if (!result.rowCount)
      fail(404, 'NOT_FOUND', 'Conversation access was revoked.')
    const ids = [...new Set(messageIds)]
    const found = await client.query(
      'SELECT id FROM messages WHERE conversation_id=$1 AND id=ANY($2::uuid[])',
      [id, ids],
    )
    if (found.rowCount !== ids.length)
      fail(
        400,
        'INVALID_RECEIPT',
        'Read receipts must reference messages in this conversation.',
      )
    await client.query(
      `UPDATE conversation_members SET read_ranges=read_ranges +
      (SELECT range_agg(numrange(seq::numeric,seq::numeric+1,'[)')) FROM messages WHERE conversation_id=$1 AND id=ANY($3::uuid[]))
      WHERE conversation_id=$1 AND actor_id=$2`,
      [id, actor.id, ids],
    )
    await client.query(
      `UPDATE conversation_members SET last_read_seq=GREATEST(last_read_seq,
      COALESCE((SELECT (upper(r)-1)::bigint FROM unnest(read_ranges) r WHERE lower(r)=1),0))
      WHERE conversation_id=$1 AND actor_id=$2`,
      [id, actor.id],
    )
    return { read: ids.length }
  })
}
