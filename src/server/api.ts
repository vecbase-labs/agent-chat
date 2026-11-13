import { randomUUID } from 'node:crypto'
import { z } from 'zod'
import { newId } from '../lib/id'
import { APP_VERSION, API_VERSION } from '../lib/version'
import { query, ensureSchema, transaction } from './db'
import { HttpError, fail } from './errors'
import {
  authenticate,
  actorColumns,
  recordAgentActivity,
  body,
  checkOrigin,
  limit,
  requireOwner,
  uuid,
} from './security'
import { accountInput, enrollment, pair, setup } from './accounts'
import { deleteAgent } from './agents'
import {
  conversationInput,
  createConversation,
  cursorSchema,
  dismissNotifications,
  inbox,
  inviteMembers,
  unreadMessages,
  markRead,
  listConversations,
  membership,
  readMessages,
  sendInput,
  sendMessage,
  updateMembers,
  archiveConversation,
} from './conversations'
import { downloadFile, uploadFile } from './files'
import { readAvatar, updateAvatar } from './avatars'
import type { Actor } from '../lib/types'

const agentInput = z.strictObject({
  name: z.string().trim().min(1).max(80),
  description: z.string().max(500).default(''),
  conversations: z.array(uuid).max(200).default([]),
})
const json = (data: unknown, status = 200) => Response.json(data, { status })

async function route(request: Request, activity: { actor?: Actor }) {
  await ensureSchema()
  checkOrigin(request)
  const url = new URL(request.url)
  const path = url.pathname
    .replace(/^\/api\/v1\/?/, '')
    .split('/')
    .filter(Boolean)
  const [resource, id, action] = path
  const method = request.method
  if (path.length > 3) fail(404, 'NOT_FOUND', 'Unknown endpoint.')
  if (resource === 'health' && method === 'GET')
    return json({ ok: true, version: APP_VERSION, apiVersion: API_VERSION })
  if (resource === 'bootstrap' && method === 'GET') {
    const [instance] = await query<{ name: string }>(
      'SELECT name FROM instance WHERE id=1',
    )
    const actor = await authenticate(request, true)
    return json({
      initialized: !!instance,
      name: instance?.name || 'Agent Chat',
      actor,
      version: APP_VERSION,
      apiVersion: API_VERSION,
    })
  }
  if (resource === 'setup' && method === 'POST') {
    await limit('anonymous:setup', 5)
    return json(await setup(await body(request, accountInput)), 201)
  }
  if (resource === 'pair' && method === 'POST') {
    await limit('anonymous:pair', 30)
    return json(
      await pair(
        (await body(request, z.object({ code: z.string().min(8).max(100) })))
          .code,
      ),
    )
  }
  const actor = (await authenticate(request))!
  activity.actor = actor
  await limit(
    actor.id + (method === 'GET' ? ':read' : ':write'),
    method === 'GET' ? 600 : 120,
  )
  if (resource === 'me' && method === 'GET') return json({ actor })
  if (resource === 'avatars' && id && !action && method === 'GET')
    return readAvatar(actor, uuid.parse(id), request)
  if (resource === 'check' && method === 'GET') return json(await inbox(actor))
  if (resource === 'inbox' && method === 'GET')
    return json(
      await unreadMessages(
        actor,
        z.coerce
          .number()
          .int()
          .min(1)
          .max(100)
          .parse(url.searchParams.get('limit') || 30),
      ),
    )
  if (resource === 'actors' && method === 'GET')
    return json({
      actors: await query<Actor>(
        `SELECT ${actorColumns},(token_hash IS NOT NULL) AS paired FROM actors WHERE deleted_at IS NULL AND (id=$1 OR owner_id=$1) AND ($2::boolean OR disabled_at IS NULL) ORDER BY kind,name,id LIMIT 1000`,
        [actor.owner_id || actor.id, actor.kind === 'human'],
      ),
    })
  if (resource === 'agents') {
    requireOwner(actor)
    if (!id && method === 'POST') {
      const input = await body(request, agentInput)
      const agentId = newId()
      await transaction(async (client) => {
        await client.query('SELECT pg_advisory_xact_lock(81724004)')
        if (
          Number(
            (
              await client.query(
                'SELECT count(*) FROM actors WHERE deleted_at IS NULL',
              )
            ).rows[0].count,
          ) >= 1000
        )
          fail(409, 'LIMIT_REACHED', 'Identity limit reached for this release.')
        const rooms = [...new Set(input.conversations)]
        if (rooms.length)
          await client.query(
            'SELECT id FROM conversations WHERE id=ANY($1::uuid[]) ORDER BY id FOR UPDATE',
            [rooms],
          )
        if (
          rooms.length &&
          (
            await client.query(
              "SELECT id FROM conversations WHERE id=ANY($1::uuid[]) AND kind='group' AND owner_id=$2",
              [rooms, actor.id],
            )
          ).rowCount !== rooms.length
        )
          fail(
            400,
            'INVALID_CONVERSATION',
            'Select existing group conversations.',
          )
        if (
          rooms.length &&
          (
            await client.query(
              'SELECT conversation_id FROM conversation_members WHERE conversation_id=ANY($1::uuid[]) GROUP BY conversation_id HAVING count(*)>=50',
              [rooms],
            )
          ).rowCount
        )
          fail(
            409,
            'LIMIT_REACHED',
            'A selected group already has 50 participants.',
          )
        await client.query(
          `INSERT INTO actors(id,kind,name,description,owner_id) VALUES($1,'agent',$2,$3,$4)`,
          [agentId, input.name, input.description, actor.id],
        )
        if (rooms.length)
          await client.query(
            'INSERT INTO conversation_members(conversation_id,actor_id) SELECT unnest($1::uuid[]),$2',
            [rooms, agentId],
          )
      })
      return json(await enrollment(agentId), 201)
    }
    uuid.parse(id)
    if (!action && method === 'DELETE')
      return json(await deleteAgent(actor, id))
    if (
      !(
        await query(
          "SELECT 1 FROM actors WHERE id=$1 AND owner_id=$2 AND kind='agent' AND deleted_at IS NULL",
          [id, actor.id],
        )
      ).length
    )
      fail(404, 'NOT_FOUND', 'Agent not found.')
    if (action === 'enrollment' && method === 'POST')
      return json(await enrollment(id, true))
    if (action === 'avatar' && ['PUT', 'DELETE'].includes(method)) {
      await limit(actor.id + ':avatar', 20)
      return json(await updateAvatar(actor, id, request))
    }
    if (!action && method === 'PATCH') {
      const input = await body(
        request,
        z.strictObject({
          name: z.string().trim().min(1).max(80).optional(),
          description: z.string().max(500).optional(),
          disabled: z.boolean().optional(),
        }),
      )
      await transaction(async (client) => {
        const result = await client.query(
          `UPDATE actors SET name=COALESCE($2,name),description=COALESCE($3,description),
          disabled_at=CASE WHEN $4::boolean=true THEN now() WHEN $4::boolean=false THEN NULL ELSE disabled_at END,
          token_hash=CASE WHEN $4::boolean=true THEN NULL ELSE token_hash END WHERE id=$1 AND kind='agent' AND deleted_at IS NULL RETURNING id`,
          [id, input.name, input.description, input.disabled],
        )
        if (!result.rowCount) fail(404, 'NOT_FOUND', 'Agent not found.')
        if (input.disabled)
          await client.query(
            'UPDATE enrollments SET consumed_at=now() WHERE actor_id=$1 AND consumed_at IS NULL',
            [id],
          )
      })
      return json({ updated: true })
    }
  }
  if (resource === 'conversations') {
    if (!id && method === 'GET')
      return json(
        await listConversations(
          actor,
          z
            .string()
            .max(100)
            .parse(url.searchParams.get('q') || ''),
          z
            .string()
            .max(400)
            .optional()
            .parse(url.searchParams.get('cursor') || undefined),
          z
            .enum(['all', 'active', 'archived'])
            .parse(url.searchParams.get('archive') || 'all'),
        ),
      )
    if (!id && method === 'POST') {
      const input = await body(request, conversationInput)
      return json(await createConversation(actor, input), 201)
    }
    uuid.parse(id)
    if (action === 'archive' && method === 'PUT')
      return json(
        await archiveConversation(
          actor,
          id,
          (await body(request, z.strictObject({ archived: z.boolean() })))
            .archived,
        ),
      )
    if (action === 'messages' && method === 'GET') {
      const after = url.searchParams.get('after'),
        before = url.searchParams.get('before'),
        around = url.searchParams.get('around')
      return json(
        await readMessages(actor, id, {
          after: after === null ? undefined : cursorSchema.parse(after),
          before: before === null ? undefined : cursorSchema.parse(before),
          around: around === null ? undefined : cursorSchema.parse(around),
          latest: url.searchParams.get('latest') === 'true',
          limit: z.coerce
            .number()
            .int()
            .min(1)
            .max(100)
            .parse(url.searchParams.get('limit') || 50),
        }),
      )
    }
    if (action === 'messages' && method === 'POST')
      return json(
        await sendMessage(actor, id, await body(request, sendInput)),
        201,
      )
    if (action === 'dismiss-notifications' && method === 'POST')
      return json(
        await dismissNotifications(
          actor,
          id,
          (await body(request, z.strictObject({ messageId: uuid }))).messageId,
        ),
      )
    if (action === 'read' && method === 'POST')
      return json(
        await markRead(
          actor,
          id,
          (
            await body(
              request,
              z.object({ messageIds: z.array(uuid).min(1).max(100) }),
            )
          ).messageIds,
        ),
      )
    if (action === 'files' && method === 'POST') {
      await limit(actor.id + ':upload', 20)
      return json(await uploadFile(actor, id, request), 201)
    }
    if (action === 'members' && method === 'POST')
      return json(
        await inviteMembers(
          actor,
          id,
          (
            await body(
              request,
              z.strictObject({ members: z.array(uuid).min(1).max(50) }),
            )
          ).members,
        ),
      )
    if (action === 'members' && method === 'PUT') {
      requireOwner(actor)
      return json(
        await updateMembers(
          actor,
          id,
          (
            await body(
              request,
              z.object({ members: z.array(uuid).min(1).max(50) }),
            )
          ).members,
        ),
      )
    }
    if (action === 'members' && method === 'GET') {
      await membership(actor, id, true)
      return json({
        members: await query(
          `SELECT a.id,a.name,a.kind,cm.last_read_seq,COALESCE((SELECT jsonb_agg(jsonb_build_array(lower(r)::text,upper(r)::text)) FROM unnest(cm.read_ranges) r),'[]') AS read_ranges FROM conversation_members cm JOIN actors a ON a.id=cm.actor_id WHERE cm.conversation_id=$1`,
          [id],
        ),
      })
    }
  }
  if (resource === 'files' && method === 'GET')
    return downloadFile(actor, uuid.parse(id))

  fail(404, 'NOT_FOUND', 'Unknown endpoint.')
}

export async function handleApi(request: Request) {
  let response: Response
  const activity: { actor?: Actor } = {}
  try {
    response = await route(request, activity)
    if (response.ok && activity.actor) {
      // Activity is informational: a failed timestamp write must not turn an
      // already committed message into a reported send failure.
      try {
        await recordAgentActivity(activity.actor)
      } catch {
        console.error('Agent activity timestamp could not be recorded')
      }
    }
  } catch (error) {
    if (error instanceof HttpError)
      response = json(
        { error: { code: error.code, message: error.message } },
        error.status,
      )
    else if (error instanceof z.ZodError)
      response = json(
        {
          error: {
            code: 'VALIDATION',
            message: error.issues
              .map((i) => `${i.path.join('.') || 'input'}: ${i.message}`)
              .join('; '),
          },
        },
        400,
      )
    else {
      const reference = randomUUID()
      // Never log request bodies, credentials, SQL parameters or cookie headers.
      console.error(
        'API failure',
        reference,
        error instanceof Error ? error.name : 'UnknownError',
      )
      response = json(
        {
          error: {
            code: 'INTERNAL_ERROR',
            message: `Request failed. Reference: ${reference}`,
          },
        },
        500,
      )
    }
  }
  if (!response.headers.has('Cache-Control'))
    response.headers.set('Cache-Control', 'no-store')
  response.headers.set('X-Content-Type-Options', 'nosniff')
  response.headers.set('Referrer-Policy', 'no-referrer')
  response.headers.set('X-Frame-Options', 'DENY')
  if (response.status === 429) response.headers.set('Retry-After', '60')
  return response
}
