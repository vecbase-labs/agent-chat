import 'dotenv/config'
import { randomUUID } from 'node:crypto'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createServer } from 'node:http'
import { SCHEMA_VERSION } from '../src/lib/version'
import { avatarFixture } from './avatar-fixture'
import pg from 'pg'
import { afterAll, beforeAll, beforeEach, describe, expect, test } from 'vitest'
import type { Actor } from '../src/lib/types'
import type { handleApi } from '../src/server/api'
import type { handleAuth } from '../src/server/auth'
import type { handleMcp } from '../src/server/mcp'

const execute = promisify(execFile)
const databaseUrl = process.env.TEST_DATABASE_URL
if (!databaseUrl)
  throw new Error(
    'Set TEST_DATABASE_URL to a disposable PostgreSQL database ending in _test.',
  )
const target = new URL(databaseUrl)
if (
  !/^\/[a-zA-Z0-9_]+_test$/.test(target.pathname) ||
  !['localhost', '127.0.0.1', 'postgres'].includes(target.hostname)
)
  throw new Error(
    'Refusing to reset a database that is not an explicitly named local test database.',
  )
process.env.DATABASE_URL = databaseUrl
process.env.MIGRATION_DATABASE_URL = databaseUrl
process.env.BETTER_AUTH_SECRET =
  'integration-test-secret-not-for-production-1234567890'
const filesDir = await mkdtemp(join(tmpdir(), 'agent-chat-test-'))
process.env.FILES_DIR = join(filesDir, 'files')

const adminDb = new pg.Pool({ connectionString: databaseUrl })
let api: typeof handleApi
let auth: typeof handleAuth
let mcp: typeof handleMcp
let origin = ''
let cookie = ''
let admin: Actor
let agent: Actor, token: string, outsiderToken: string, participantToken: string
let uploadedFileId: string
let savedAvatarId: string
let room: string, otherRoom: string
const password = 'Test8-ok'
const server = createServer(async (req, res) => {
  try {
    const chunks: Buffer[] = []
    for await (const chunk of req) chunks.push(Buffer.from(chunk))
    const url = origin + req.url
    const incoming = new Request(url, {
      method: req.method,
      headers: req.headers as HeadersInit,
      ...(req.method !== 'GET' && req.method !== 'HEAD'
        ? { body: Buffer.concat(chunks) }
        : {}),
    })
    const response = url.includes('/api/auth/')
      ? await auth(incoming)
      : url.endsWith('/mcp')
        ? await mcp(incoming)
        : await api(incoming)
    res.statusCode = response.status
    response.headers.forEach((value, name) => {
      if (name !== 'set-cookie') res.setHeader(name, value)
    })
    if (response.headers.getSetCookie().length)
      res.setHeader('set-cookie', response.headers.getSetCookie())
    res.end(Buffer.from(await response.arrayBuffer()))
  } catch {
    res.writeHead(500).end('Test server failure')
  }
})

type Payload = Record<string, any>
async function request(
  path: string,
  options: {
    method?: string
    data?: unknown
    bearer?: string
    anonymous?: boolean
    headers?: Record<string, string>
  } = {},
) {
  const headers = new Headers({ Origin: origin, ...options.headers })
  if (options.bearer) headers.set('Authorization', `Bearer ${options.bearer}`)
  else if (!options.anonymous && cookie) headers.set('Cookie', cookie)
  if (options.data !== undefined)
    headers.set('Content-Type', 'application/json')
  const response = await fetch(origin + '/api/v1/' + path, {
    method: options.method || (options.data === undefined ? 'GET' : 'POST'),
    headers,
    body: options.data === undefined ? undefined : JSON.stringify(options.data),
  })
  const data: Payload = await response.json()
  return { status: response.status, data }
}
async function createAgent(name: string, conversations: string[] = []) {
  const created = await request('agents', {
    data: { name, conversations },
  })
  expect(created.status).toBe(201)
  expect(created.data.code).toMatch(/^[A-HJ-NP-Z2-9]{4}-[A-HJ-NP-Z2-9]{4}$/)
  const paired = await request('pair', {
    data: { code: created.data.code.toLowerCase().replaceAll('-', ' ') },
    anonymous: true,
  })
  expect(paired.status).toBe(200)
  return { ...paired.data, code: created.data.code } as {
    actor: Actor
    token: string
    code: string
  }
}
beforeAll(async () => {
  await adminDb.query('DROP SCHEMA public CASCADE; CREATE SCHEMA public')
  await execute(process.execPath, ['--import', 'tsx', 'scripts/migrate.ts'], {
    env: process.env,
  })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const address = server.address()
  if (!address || typeof address === 'string') throw new Error('No test port')
  origin = `http://127.0.0.1:${address.port}`
  process.env.APP_URL = origin
  api = (await import('../src/server/api')).handleApi
  auth = (await import('../src/server/auth')).handleAuth
  mcp = (await import('../src/server/mcp')).handleMcp
})
afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()))
  await (await import('../src/server/db')).getPool().end()
  await adminDb.end()
  await rm(filesDir, { recursive: true, force: true })
})
// Each scenario has its own rate-limit window; production limits remain unchanged.
beforeEach(async () => {
  await adminDb.query('DELETE FROM request_limits')
})

describe('PostgreSQL, authentication, API and agent protocol', () => {
  test('first owner setup is atomic; public signup is closed', async () => {
    expect(
      (await request('bootstrap', { anonymous: true })).data.initialized,
    ).toBe(false)
    expect(
      (
        await request('setup', {
          anonymous: true,
          data: {
            name: 'Test Admin',
            username: 'test_admin',
            password: 'Short7!',
          },
        })
      ).status,
    ).toBe(400)
    expect(
      (await request('bootstrap', { anonymous: true })).data.initialized,
    ).toBe(false)
    const results = await Promise.all(
      [1, 2].map(() =>
        request('setup', {
          anonymous: true,
          data: { name: 'Test Admin', username: 'test_admin', password },
        }),
      ),
    )
    expect(results.map((r) => r.status).sort()).toEqual([201, 409])
    const response = await fetch(origin + '/api/auth/sign-in/username', {
      method: 'POST',
      headers: { Origin: origin, 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: 'test_admin', password }),
    })
    expect(response.status).toBe(200)
    cookie = response.headers
      .getSetCookie()
      .map((c) => c.split(';')[0])
      .join('; ')
    expect(cookie.length).toBeGreaterThan(20)
    admin = (await request('me')).data.actor
    expect(admin.kind).toBe('human')
    expect(admin.owner_id).toBeNull()
    expect(admin.id[14]).toBe('7')
    expect(
      (await fetch(origin + '/api/auth/sign-up/email', { method: 'POST' }))
        .status,
    ).toBe(404)
  })

  test('pairing is single-use; identities cannot claim owner access', async () => {
    const a = await createAgent('Research Agent')
    agent = a.actor
    token = a.token
    outsiderToken = (await createAgent('Outside Agent')).token
    participantToken = (await createAgent('Team Agent')).token
    expect(
      (await request('pair', { anonymous: true, data: { code: a.code } }))
        .status,
    ).toBe(400)
    expect(
      (
        await request('agents', {
          bearer: token,
          data: { name: 'Impersonation' },
        })
      ).status,
    ).toBe(403)
    expect((await request('me', { bearer: token })).data.actor.owner_id).toBe(
      admin.id,
    )
    const stored = (
      await adminDb.query('SELECT token_hash FROM actors WHERE id=$1', [
        agent.id,
      ])
    ).rows[0].token_hash
    expect(stored).not.toBe(token)
    expect(stored).toHaveLength(64)
  })

  test('short pairing codes are normalized, rate-limited and consumed atomically', async () => {
    // Retired access flags must be rejected rather than silently granting write access.
    expect(
      (
        await request('agents', {
          data: { name: 'Retired role', access: 'read' },
        })
      ).status,
    ).toBe(400)
    const created = await request('agents', { data: { name: 'Pairing race' } })
    expect(
      (
        await request(`agents/${created.data.agentId}`, {
          method: 'PATCH',
          data: { access: 'read' },
        })
      ).status,
    ).toBe(400)
    const code = created.data.code as string
    const attempts = await Promise.all(
      [
        code,
        code.toLowerCase().replace('-', ''),
        code.toLowerCase().replace('-', ' '),
      ].map((value) =>
        request('pair', { anonymous: true, data: { code: value } }),
      ),
    )
    expect(attempts.map((r) => r.status).sort()).toEqual([200, 400, 400])
    const { hash } = await import('../src/server/security')
    const legacy = 'LegacyCaseSensitiveCode01'
    await adminDb.query(
      "INSERT INTO enrollments(id,actor_id,code_hash,expires_at) VALUES($1,$2,$3,now()+interval '10 minutes')",
      [randomUUID(), created.data.agentId, hash(legacy)],
    )
    expect(
      (
        await request('pair', {
          anonymous: true,
          data: { code: legacy.toLowerCase() },
        })
      ).status,
    ).toBe(400)
    expect(
      (await request('pair', { anonymous: true, data: { code: legacy } }))
        .status,
    ).toBe(200)
    for (let i = 0; i < 30; i++) {
      const result = await request('pair', {
        anonymous: true,
        data: { code: 'AAAA-AAAA' },
      })
      if (result.status === 429) break
    }
    expect(
      (await request('pair', { anonymous: true, data: { code: 'AAAA-AAAA' } }))
        .status,
    ).toBe(429)
    await adminDb.query("DELETE FROM request_limits WHERE key='anonymous:pair'")
  })

  test('agent activity records successful requests, coalesces writes and never implies read', async () => {
    const a = await createAgent('Activity fixture')
    const activity = async () =>
      (
        await adminDb.query('SELECT last_active_at FROM actors WHERE id=$1', [
          a.actor.id,
        ])
      ).rows[0].last_active_at
    expect(await activity()).toBeNull()
    await request('actors')
    await request(`agents/${a.actor.id}`, {
      method: 'PATCH',
      data: { description: 'Owner edit' },
    })
    await request('health', { bearer: a.token })
    expect(
      (
        await request('agents', {
          bearer: a.token,
          data: { name: 'Forbidden' },
        })
      ).status,
    ).toBe(403)
    expect(
      (await request('unknown-endpoint', { bearer: a.token })).status,
    ).toBe(404)
    expect(
      (await request('me', { bearer: 'ac_' + 'x'.repeat(48) })).status,
    ).toBe(401)
    expect(await activity()).toBeNull()
    const checked = await request('check', { bearer: a.token })
    expect(checked.status).toBe(200)
    expect(checked.data.needsAttention).toBe(false)
    const first = await activity()
    expect(first).toBeInstanceOf(Date)
    await Promise.all(
      Array.from({ length: 5 }, () => request('me', { bearer: a.token })),
    )
    expect(await activity()).toEqual(first)
    const chat = (
      await request('conversations', {
        data: { kind: 'direct', members: [a.actor.id] },
      })
    ).data.id
    await request(`conversations/${chat}/messages`, {
      data: { text: 'Unread activity fixture', idempotencyKey: randomUUID() },
    })
    await adminDb.query(
      "UPDATE actors SET last_active_at=now()-interval '2 minutes' WHERE id=$1",
      [a.actor.id],
    )
    expect((await request('check', { bearer: a.token })).data.unread).toBe(1)
    expect((await activity()).getTime()).toBeGreaterThan(first.getTime())
    expect(
      (
        await adminDb.query(
          'SELECT last_read_seq FROM conversation_members WHERE conversation_id=$1 AND actor_id=$2',
          [chat, a.actor.id],
        )
      ).rows[0].last_read_seq,
    ).toBe('0')
    expect(
      (await request('actors')).data.actors.find(
        (actor: Actor) => actor.id === a.actor.id,
      ).last_active_at,
    ).toBeTruthy()
    expect(
      (
        await adminDb.query('SELECT last_active_at FROM actors WHERE id=$1', [
          admin.id,
        ])
      ).rows[0].last_active_at,
    ).toBeNull()
  })

  test('MCP tool success records activity but tool errors do not', async () => {
    const a = await createAgent('MCP activity fixture')
    async function call(name: string, args: Record<string, unknown> = {}) {
      const response = await fetch(origin + '/mcp', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${a.token}`,
          'Content-Type': 'application/json',
          Accept: 'application/json, text/event-stream',
        },
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: 1,
          method: 'tools/call',
          params: { name, arguments: args },
        }),
      })
      return response.json()
    }
    const rejected = await call('unknown-tool')
    expect(rejected.error || rejected.result?.isError).toBeTruthy()
    expect(
      (
        await adminDb.query('SELECT last_active_at FROM actors WHERE id=$1', [
          a.actor.id,
        ])
      ).rows[0].last_active_at,
    ).toBeNull()
    expect((await call('check')).result.isError).not.toBe(true)
    expect(
      (
        await adminDb.query('SELECT last_active_at FROM actors WHERE id=$1', [
          a.actor.id,
        ])
      ).rows[0].last_active_at,
    ).toBeInstanceOf(Date)
  })

  test('groups, direct conversations and explicit membership permissions', async () => {
    const reader = (await request('me', { bearer: participantToken })).data
      .actor
    room = (
      await request('conversations', {
        data: {
          kind: 'group',
          name: 'Integration room',
          members: [agent.id, reader.id],
        },
      })
    ).data.id
    expect(room).toBeTruthy()
    otherRoom = (
      await request('conversations', {
        data: { kind: 'direct', members: [agent.id] },
      })
    ).data.id
    expect(
      (
        await request('conversations', {
          data: { kind: 'direct', members: [agent.id] },
        })
      ).data.id,
    ).toBe(otherRoom)
    expect(
      (
        await request(`conversations/${room}/messages`, {
          bearer: outsiderToken,
        })
      ).status,
    ).toBe(404)
    expect(
      (
        await request(`conversations/${room}/messages`, {
          bearer: outsiderToken,
          data: { text: 'blocked', idempotencyKey: randomUUID() },
        })
      ).status,
    ).toBe(403)
    expect(
      (
        await request('conversations', {
          bearer: token,
          data: {
            kind: 'group',
            name: 'Missing retry key',
            members: [admin.id],
          },
        })
      ).status,
    ).toBe(400)
  })

  test('independent agents discover peers and organize chats without gaining unrelated history', async () => {
    const leader = await createAgent('Collaboration leader')
    const peer = await createAgent('Collaboration peer')
    const invited = await createAgent('Collaboration invitee')
    const disabled = await createAgent('Disabled collaborator')
    await request(`agents/${disabled.actor.id}`, {
      method: 'PATCH',
      data: { disabled: true },
    })
    expect(
      (await request('conversations', { bearer: leader.token })).data
        .conversations,
    ).toEqual([])
    const directory = (await request('actors', { bearer: leader.token })).data
      .actors
    expect(directory.map((a: Actor) => a.id)).toContain(peer.actor.id)
    expect(directory.map((a: Actor) => a.id)).not.toContain(disabled.actor.id)
    expect(
      directory.every(
        (a: Payload) => !('token_hash' in a) && !('user_id' in a),
      ),
    ).toBe(true)
    expect(
      (
        await request(`conversations/${room}/messages`, {
          bearer: leader.token,
        })
      ).status,
    ).toBe(404)
    const input = {
      kind: 'group',
      name: 'Flexible collaboration',
      members: [peer.actor.id],
      idempotencyKey: randomUUID(),
    }
    const retries = await Promise.all(
      Array.from({ length: 4 }, () =>
        request('conversations', { bearer: leader.token, data: input }),
      ),
    )
    expect(retries.map((r) => r.status)).toEqual([201, 201, 201, 201])
    const chat = retries[0].data.id
    expect(new Set(retries.map((r) => r.data.id)).size).toBe(1)
    const created = (await request('conversations', { bearer: leader.token }))
      .data.conversations[0]
    expect(created.created_by).toBe(leader.actor.id)
    expect(created.owner_id).toBe(admin.id)
    expect(created.members.map((a: Actor) => a.id).sort()).toEqual(
      [admin.id, leader.actor.id, peer.actor.id].sort(),
    )
    expect(
      (
        await request('conversations', {
          bearer: leader.token,
          data: { ...input, name: 'Different request' },
        })
      ).status,
    ).toBe(409)
    const sent = await request(`conversations/${chat}/messages`, {
      bearer: leader.token,
      data: {
        text: 'Please review the outline.',
        mentions: [peer.actor.id],
        idempotencyKey: randomUUID(),
      },
    })
    expect(sent.status).toBe(201)
    expect(
      (await request('check', { bearer: peer.token })).data.needsAttention,
    ).toBe(true)
    expect(
      (await request('inbox', { bearer: peer.token })).data.messages[0].id,
    ).toBe(sent.data.id)
    await request(`conversations/${chat}/read`, {
      bearer: peer.token,
      data: { messageIds: [sent.data.id] },
    })
    const receipts = (
      await adminDb.query(
        'SELECT * FROM conversation_members WHERE conversation_id=$1 ORDER BY actor_id',
        [chat],
      )
    ).rows
    const invitations = await Promise.all(
      [1, 2].map(() =>
        request(`conversations/${chat}/members`, {
          bearer: leader.token,
          data: { members: [invited.actor.id] },
        }),
      ),
    )
    expect(invitations.map((r) => r.status)).toEqual([200, 200])
    expect(invitations.flatMap((r) => r.data.added)).toEqual([invited.actor.id])
    expect(
      (
        await adminDb.query(
          'SELECT * FROM conversation_members WHERE conversation_id=$1 AND actor_id<>$2 ORDER BY actor_id',
          [chat, invited.actor.id],
        )
      ).rows,
    ).toEqual(receipts)
    expect(
      (
        await request(`conversations/${chat}/messages`, {
          bearer: invited.token,
        })
      ).data.messages[0].id,
    ).toBe(sent.data.id)
    expect(
      (
        await request(`conversations/${room}/messages`, {
          bearer: invited.token,
        })
      ).status,
    ).toBe(404)
    expect(
      (
        await request(`conversations/${chat}/members`, {
          bearer: leader.token,
          method: 'PUT',
          data: { members: [leader.actor.id] },
        })
      ).status,
    ).toBe(403)
    expect(
      (
        await request(`conversations/${room}/members`, {
          bearer: leader.token,
          data: { members: [leader.actor.id] },
        })
      ).status,
    ).toBe(403)
    expect(
      (
        await request(`conversations/${chat}/members`, {
          bearer: leader.token,
          data: { members: [disabled.actor.id] },
        })
      ).status,
    ).toBe(400)
    expect(
      (
        await request(`conversations/${chat}/members`, {
          bearer: leader.token,
          data: { members: [randomUUID()] },
        })
      ).status,
    ).toBe(400)
    const direct = await request('conversations', {
      bearer: leader.token,
      data: { kind: 'direct', members: [peer.actor.id] },
    })
    expect(direct.status).toBe(201)
    expect(
      (
        await request('conversations', {
          bearer: peer.token,
          data: { kind: 'direct', members: [leader.actor.id] },
        })
      ).data.id,
    ).toBe(direct.data.id)
    expect(
      (
        await request(`conversations/${direct.data.id}/members`, {
          bearer: leader.token,
          data: { members: [invited.actor.id] },
        })
      ).status,
    ).toBe(400)
    expect(
      (
        await request('conversations', {
          bearer: leader.token,
          data: { kind: 'direct', members: [peer.actor.id, invited.actor.id] },
        })
      ).status,
    ).toBe(400)
    await request(`conversations/${chat}/members`, {
      method: 'PUT',
      data: { members: [admin.id, leader.actor.id] },
    })
    expect(
      (await request('conversations', { bearer: leader.token, data: input }))
        .data.id,
    ).toBe(chat)
    expect(
      (await request(`conversations/${chat}/members`)).data.members.map(
        (a: Actor) => a.id,
      ),
    ).not.toContain(peer.actor.id)
    await request(`conversations/${chat}/members`, {
      method: 'PUT',
      data: { members: [admin.id] },
    })
    expect(
      (await request('conversations', { bearer: leader.token, data: input }))
        .status,
    ).toBe(403)
    expect(
      (
        await request(`conversations/${chat}/members`, {
          bearer: leader.token,
          data: { members: [leader.actor.id] },
        })
      ).status,
    ).toBe(403)
  })

  test('simultaneous invitations respect the group size limit and reject partial additions', async () => {
    const creator = await createAgent('Capacity fixture')
    const peerIds = Array.from({ length: 49 }, () => randomUUID())
    await adminDb.query(
      "INSERT INTO actors(id,kind,name,owner_id) SELECT unnest($1::uuid[]),'agent','Capacity peer',$2",
      [peerIds, admin.id],
    )
    const chat = (
      await request('conversations', {
        bearer: creator.token,
        data: {
          kind: 'group',
          name: 'Capacity',
          members: peerIds.slice(0, 47),
          idempotencyKey: randomUUID(),
        },
      })
    ).data.id
    const concurrent = await Promise.all(
      peerIds.slice(47).map((id) =>
        request(`conversations/${chat}/members`, {
          bearer: creator.token,
          data: { members: [id] },
        }),
      ),
    )
    expect(concurrent.map((r) => r.status).sort()).toEqual([200, 409])
    expect(
      (await request(`conversations/${chat}/members`)).data.members,
    ).toHaveLength(50)
    const failed = await request('conversations', {
      bearer: creator.token,
      data: {
        kind: 'group',
        name: 'Too many',
        members: peerIds,
        idempotencyKey: randomUUID(),
      },
    })
    expect(failed.status).toBe(400)
    expect(
      (await request('conversations', { bearer: creator.token })).data
        .conversations,
    ).toHaveLength(1)
  })

  test('concurrent retries create one message and conflicting retry bodies fail', async () => {
    const data = {
      text: 'A single logical message',
      mentions: [agent.id],
      idempotencyKey: randomUUID(),
    }
    const results = await Promise.all(
      Array.from({ length: 8 }, () =>
        request(`conversations/${room}/messages`, { data }),
      ),
    )
    expect(results.every((r) => r.status === 201)).toBe(true)
    expect(new Set(results.map((r) => r.data.id)).size).toBe(1)
    expect(results.filter((r) => !r.data.duplicate)).toHaveLength(1)
    expect(
      (
        await request(`conversations/${room}/messages`, {
          data: { ...data, text: 'changed' },
        })
      ).status,
    ).toBe(409)
    expect(
      (await request(`conversations/${otherRoom}/messages`, { data })).status,
    ).toBe(409)
  })

  test('concurrent messages have contiguous committed cursors and lossless pagination', async () => {
    const results = await Promise.all(
      Array.from({ length: 40 }, (_, n) =>
        request(`conversations/${room}/messages`, {
          data: { text: `Concurrent ${n}`, idempotencyKey: randomUUID() },
        }),
      ),
    )
    expect(results.every((r) => r.status === 201)).toBe(true)
    const seqs = results.map((r) => Number(r.data.seq)).sort((a, b) => a - b)
    expect(seqs).toEqual(Array.from({ length: 40 }, (_, n) => n + 2))
    const ids = new Set<string>()
    let cursor = '0',
      more = true
    while (more) {
      const page = (
        await request(
          `conversations/${room}/messages?after=${cursor}&limit=7`,
          { bearer: token },
        )
      ).data
      expect(
        page.messages.every((m: Payload) => typeof m.seq === 'string'),
      ).toBe(true)
      page.messages.forEach((m: Payload) => ids.add(m.id))
      cursor = page.nextCursor
      more = page.hasMore
    }
    expect(ids.size).toBe(41)
    expect(cursor).toBe('41')
    const pending = (await request('check', { bearer: token })).data
    expect(pending.needsAttention).toBe(true)
    expect(pending.conversations[0].after).toBe('0') // Reading never silently acknowledges.
    for (let repeat = 0; repeat < 2; repeat++)
      expect(
        (
          await request(`conversations/${room}/read`, {
            bearer: token,
            data: { messageIds: [...ids] },
          })
        ).data.read,
      ).toBe(41)
    expect(
      (
        await request(`conversations/${room}/read`, {
          bearer: token,
          data: { messageIds: [randomUUID()] },
        })
      ).status,
    ).toBe(400)
    expect(
      (await request('check', { bearer: token })).data.needsAttention,
    ).toBe(false)
  })

  test('mentions and replies are scoped; unrelated group chatter does not need attention', async () => {
    await request(`conversations/${room}/messages`, {
      data: { text: 'General information', idempotencyKey: randomUUID() },
    })
    expect(
      (await request('check', { bearer: token })).data.needsAttention,
    ).toBe(false)
    const original = (
      await request(`conversations/${room}/messages`, {
        bearer: token,
        data: { text: 'Question', idempotencyKey: randomUUID() },
      })
    ).data
    expect(
      (
        await request(`conversations/${otherRoom}/messages`, {
          data: {
            text: 'wrong reply',
            replyTo: original.id,
            idempotencyKey: randomUUID(),
          },
        })
      ).status,
    ).toBe(400)
    await request(`conversations/${room}/messages`, {
      data: {
        text: 'Answer',
        replyTo: original.id,
        idempotencyKey: randomUUID(),
      },
    })
    expect(
      (await request('check', { bearer: token })).data.needsAttention,
    ).toBe(true)
  })

  test('attachments are immutable, scoped and integrity checked', async () => {
    const upload = await fetch(`${origin}/api/v1/conversations/${room}/files`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'X-File-Name': encodeURIComponent('../input.csv'),
        'Content-Type': 'text/csv',
      },
      body: 'username,language\nexample,en\n',
    })
    expect(upload.status).toBe(201)
    const file = await upload.json()
    uploadedFileId = file.id
    expect(file.name).toBe('.._input.csv')
    expect(
      (
        await fetch(`${origin}/api/v1/files/${file.id}`, {
          headers: { Cookie: cookie },
        })
      ).status,
    ).toBe(404)
    expect(
      (
        await request(`conversations/${otherRoom}/messages`, {
          bearer: token,
          data: { fileIds: [file.id], idempotencyKey: randomUUID() },
        })
      ).status,
    ).toBe(400)
    expect(
      (
        await request(`conversations/${room}/messages`, {
          bearer: token,
          data: { fileIds: [file.id], idempotencyKey: randomUUID() },
        })
      ).status,
    ).toBe(201)
    const downloaded = await fetch(`${origin}/api/v1/files/${file.id}`, {
      headers: { Cookie: cookie },
    })
    expect(downloaded.headers.get('Content-Disposition')).toContain(
      'attachment;',
    )
    expect(await downloaded.text()).toBe('username,language\nexample,en\n')
    expect(
      (
        await fetch(`${origin}/api/v1/files/${file.id}`, {
          headers: { Authorization: `Bearer ${outsiderToken}` },
        })
      ).status,
    ).toBe(404)
    await writeFile(join(process.env.FILES_DIR!, file.id), 'tampered')
    expect(
      (
        await fetch(`${origin}/api/v1/files/${file.id}`, {
          headers: { Cookie: cookie },
        })
      ).status,
    ).toBe(500)
    await writeFile(
      join(process.env.FILES_DIR!, file.id),
      'username,language\nexample,en\n',
    )
  })

  test('owner review never joins or acknowledges another identity', async () => {
    expect(
      (
        await request(`conversations/${room}/members`, {
          method: 'PUT',
          data: { members: [agent.id] },
        })
      ).status,
    ).toBe(200)
    const review = await request(`conversations/${room}/messages?latest=true`)
    expect(review.data.review).toBe(true)
    expect(
      (await request(`conversations/${room}/ack`, { data: { seq: '1' } }))
        .status,
    ).toBe(404)
    expect(
      (
        await request(`conversations/${room}/messages`, {
          data: { text: 'not joined', idempotencyKey: randomUUID() },
        })
      ).status,
    ).toBe(403)
    expect((await request('audit')).status).toBe(404)
    expect(
      (await adminDb.query("SELECT to_regclass('public.audit_events') AS name"))
        .rows[0].name,
    ).toBeNull()
    expect(
      (await request('conversations?all=true')).data.conversations.some(
        (c: Payload) => c.id === room && !c.joined,
      ),
    ).toBe(true)
  })

  test('personal accounts have no invitations or additional-human signup', async () => {
    expect((await request('invitations', { data: {} })).status).toBe(404)
    expect(
      (
        await request('join', {
          anonymous: true,
          data: {
            name: 'Other',
            username: 'other',
            password,
            token: 'invalid',
          },
        })
      ).status,
    ).toBe(401)
    expect(
      (
        await request(`members/${admin.id}`, {
          method: 'PATCH',
          data: { disabled: true },
        })
      ).status,
    ).toBe(404)
    expect(
      (await request('actors', { bearer: outsiderToken })).data.actors.map(
        (a: Payload) => a.id,
      ),
    ).toContain(agent.id)
    expect(
      (await adminDb.query("SELECT count(*) FROM actors WHERE kind='human'"))
        .rows[0].count,
    ).toBe('1')
    expect(
      (
        await adminDb.query(
          "SELECT column_name FROM information_schema.columns WHERE table_name='actors' AND column_name IN ('role','access')",
        )
      ).rowCount,
    ).toBe(0)
  })

  test('revocation rejects old credentials, expired codes and repeated pairing', async () => {
    const reconnect = (
      await request(`agents/${agent.id}/enrollment`, { data: {} })
    ).data
    expect((await request('me', { bearer: token })).status).toBe(401)
    const renewed = await request('pair', {
      anonymous: true,
      data: { code: reconnect.code },
    })
    expect(renewed.status).toBe(200)
    token = renewed.data.token
    expect(
      (
        await request('pair', {
          anonymous: true,
          data: { code: reconnect.code },
        })
      ).status,
    ).toBe(400)
    const expiring = (
      await request(`agents/${agent.id}/enrollment`, { data: {} })
    ).data
    await adminDb.query(
      "UPDATE enrollments SET expires_at=now()-interval '1 second' WHERE actor_id=$1",
      [agent.id],
    )
    expect(
      (
        await request('pair', {
          anonymous: true,
          data: { code: expiring.code },
        })
      ).status,
    ).toBe(400)
    const valid = (await request(`agents/${agent.id}/enrollment`, { data: {} }))
      .data
    token = (
      await request('pair', { anonymous: true, data: { code: valid.code } })
    ).data.token
  })

  test('MCP uses the same scoped identities and structured messages', async () => {
    const response = await fetch(origin + '/mcp', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
        Accept: 'application/json, text/event-stream',
      },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        method: 'tools/call',
        params: { name: 'inbox', arguments: {} },
      }),
    })
    expect(response.status).toBe(200)
    const result = await response.json()
    expect(result.error).toBeUndefined()
    expect(result.result.isError).not.toBe(true)
    expect(JSON.parse(result.result.content[0].text)).toHaveProperty('messages')
  })

  test('an official MCP client initializes and reads an authorized text attachment', async () => {
    const { Client } = await import('@modelcontextprotocol/sdk/client/index.js')
    const { StreamableHTTPClientTransport } =
      await import('@modelcontextprotocol/sdk/client/streamableHttp.js')
    const client = new Client({ name: 'integration-test', version: '0.1.0' })
    try {
      await client.connect(
        new StreamableHTTPClientTransport(new URL(origin + '/mcp'), {
          requestInit: { headers: { Authorization: `Bearer ${token}` } },
        }),
      )
      expect(
        (await client.listTools()).tools.some(
          (tool) => tool.name === 'read_file',
        ),
      ).toBe(true)
      const result = await client.callTool({
        name: 'read_file',
        arguments: { fileId: uploadedFileId },
      })
      expect(result.isError).not.toBe(true)
      expect(JSON.stringify(result.content)).toContain('username,language')
      const oversized = await client.callTool({
        name: 'read_file',
        arguments: { fileId: uploadedFileId, maxBytes: 1 },
      })
      expect(oversized.isError).toBe(true)
      const peers = await client.callTool({
        name: 'list_agents',
        arguments: {},
      })
      const agents = (peers.structuredContent as Payload).agents
      expect(agents.some((peer: Actor) => peer.id === agent.id)).toBe(true)
      const peer = agents.find((a: Actor) => a.id !== agent.id)
      const key = randomUUID()
      const created = await client.callTool({
        name: 'create_conversation',
        arguments: {
          kind: 'group',
          name: 'MCP collaboration',
          members: [peer.id],
          idempotencyKey: key,
        },
      })
      expect(created.isError).not.toBe(true)
      const chat = (created.structuredContent as Payload).id
      const repeated = await client.callTool({
        name: 'create_conversation',
        arguments: {
          kind: 'group',
          name: 'MCP collaboration',
          members: [peer.id],
          idempotencyKey: key,
        },
      })
      expect((repeated.structuredContent as Payload).id).toBe(chat)
      const extra = await createAgent('MCP invited peer')
      const invitation = await client.callTool({
        name: 'invite_members',
        arguments: { conversationId: chat, members: [extra.actor.id] },
      })
      expect((invitation.structuredContent as Payload).added).toEqual([
        extra.actor.id,
      ])
      const members = await client.callTool({
        name: 'list_members',
        arguments: { conversationId: chat },
      })
      expect(
        (members.structuredContent as Payload).members.map((a: Actor) => a.id),
      ).toContain(extra.actor.id)
    } finally {
      await client.close()
    }
  })

  test('two agents can talk directly while the owner only reviews', async () => {
    const outside = (await request('me', { bearer: outsiderToken })).data.actor
    const direct = await request('conversations', {
      data: { kind: 'direct', members: [agent.id, outside.id] },
    })
    expect(direct.status).toBe(201)
    const message = await request(`conversations/${direct.data.id}/messages`, {
      bearer: token,
      data: { text: 'Peer communication', idempotencyKey: randomUUID() },
    })
    expect(message.status).toBe(201)
    expect(
      (await request('check', { bearer: outsiderToken })).data.needsAttention,
    ).toBe(true)
    expect(
      (await request(`conversations/${direct.data.id}/messages`)).data.review,
    ).toBe(true)
  })

  test('standalone CLI pairs, stores private credentials and sends retry-safe messages', async () => {
    const created = await request('agents', {
      data: { name: 'CLI Agent', conversations: [room] },
    })
    const env = {
      ...process.env,
      AGENT_CHAT_CONFIG_DIR: join(filesDir, 'config'),
    }
    const run = (...args: string[]) =>
      execute(process.execPath, ['public/agent-chat.mjs', ...args], { env })
    const pairing = await run(
      'pair',
      '--server',
      origin,
      '--code',
      created.data.code,
    )
    expect(pairing.stdout).not.toContain('ac_')
    const saved = JSON.parse(
      await readFile(join(env.AGENT_CHAT_CONFIG_DIR, 'default.json'), 'utf8'),
    )
    expect(
      (await stat(join(env.AGENT_CHAT_CONFIG_DIR, 'default.json'))).mode &
        0o777,
    ).toBe(0o600)
    expect(saved.token).toMatch(/^ac_/)
    const sent = JSON.parse(
      (await run('send', room, '--text', 'CLI test', '--key', randomUUID()))
        .stdout,
    )
    expect(typeof sent.seq).toBe('string')
    const messages = JSON.parse(
      (await run('read', room, '--after', '0', '--limit', '100')).stdout,
    )
    expect(messages.messages.at(-1).text).toBe('CLI test')
    expect(
      (
        await adminDb.query(
          'SELECT last_read_seq FROM conversation_members WHERE conversation_id=$1 AND actor_id=$2',
          [room, saved.actorId],
        )
      ).rows[0].last_read_seq,
    ).toBe(sent.seq)
    const peers = JSON.parse((await run('agents')).stdout).agents
    expect(peers.some((a: Actor) => a.id === agent.id)).toBe(true)
    const direct = JSON.parse((await run('dm', agent.id)).stdout)
    expect(JSON.parse((await run('dm', agent.id)).stdout).id).toBe(direct.id)
    const key = randomUUID()
    const group = JSON.parse(
      (
        await run(
          'group',
          '--name',
          'CLI collaboration',
          '--member',
          agent.id,
          '--key',
          key,
        )
      ).stdout,
    )
    expect(
      JSON.parse(
        (
          await run(
            'group',
            '--name',
            'CLI collaboration',
            '--member',
            agent.id,
            '--key',
            key,
          )
        ).stdout,
      ).id,
    ).toBe(group.id)
    const invited = await createAgent('CLI invited peer')
    expect(
      JSON.parse(
        (await run('invite', group.id, '--member', invited.actor.id)).stdout,
      ).added,
    ).toEqual([invited.actor.id])
    expect(
      JSON.parse((await run('members', group.id)).stdout).members.map(
        (a: Actor) => a.id,
      ),
    ).toContain(invited.actor.id)
  })

  test('cross-origin mutations, invalid cursors and missing credentials fail closed', async () => {
    const response = await api(
      new Request(origin + '/api/v1/conversations', {
        method: 'POST',
        headers: {
          Cookie: cookie,
          Origin: 'https://attacker.invalid',
          'Content-Type': 'application/json',
        },
        body: '{}',
      }),
    )
    expect(response.status).toBe(403)
    expect((await request('me', { anonymous: true })).status).toBe(401)
    expect(
      (
        await request(
          `conversations/${room}/messages?after=9223372036854775808`,
          { bearer: token },
        )
      ).status,
    ).toBe(400)
    expect(
      (
        await request(`conversations/${room}/messages?after=-1`, {
          bearer: token,
        })
      ).status,
    ).toBe(400)
  })

  test('personal baseline contains ownership and no team or audit tables', async () => {
    expect(
      (await adminDb.query('SELECT max(version) FROM schema_migrations'))
        .rows[0].max,
    ).toBe(SCHEMA_VERSION)
    expect(
      (
        await adminDb.query(
          "SELECT table_name FROM information_schema.tables WHERE table_schema='public' AND table_name IN ('invitations','audit_events','legacy_invitations','legacy_audit_events')",
        )
      ).rowCount,
    ).toBe(0)
    expect(
      (
        await adminDb.query("SELECT owner_id FROM actors WHERE kind='agent'")
      ).rows.every((row) => row.owner_id === admin.id),
    ).toBe(true)
    expect(
      (await adminDb.query('SELECT owner_id FROM conversations')).rows.every(
        (row) => row.owner_id === admin.id,
      ),
    ).toBe(true)
  })

  test('migration replay preserves data and rejects modified history or downgrade', async () => {
    const before = (await adminDb.query('SELECT count(*) FROM messages'))
      .rows[0].count
    await execute(process.execPath, ['--import', 'tsx', 'scripts/migrate.ts'], {
      env: process.env,
    })
    expect(
      (await adminDb.query('SELECT count(*) FROM messages')).rows[0].count,
    ).toBe(before)
    const original = (
      await adminDb.query(
        'SELECT checksum FROM schema_migrations WHERE version=1',
      )
    ).rows[0].checksum
    await adminDb.query(
      "UPDATE schema_migrations SET checksum='modified' WHERE version=1",
    )
    await expect(
      execute(process.execPath, ['--import', 'tsx', 'scripts/migrate.ts'], {
        env: process.env,
      }),
    ).rejects.toThrow()
    await adminDb.query(
      'UPDATE schema_migrations SET checksum=$1 WHERE version=1',
      [original],
    )
    await adminDb.query(
      "INSERT INTO schema_migrations(version,name,checksum) VALUES(9999,'future','future')",
    )
    await expect(
      execute(process.execPath, ['--import', 'tsx', 'scripts/migrate.ts'], {
        env: process.env,
      }),
    ).rejects.toThrow()
    await adminDb.query('DELETE FROM schema_migrations WHERE version=9999')
  })

  test('owner conversation browsing reaches every page', async () => {
    const { newId } = await import('../src/lib/id')
    const ids = Array.from({ length: 205 }, () => newId())
    await adminDb.query(
      "INSERT INTO conversations(id,kind,name,created_by,owner_id) SELECT unnest($1::uuid[]),'group','Pagination fixture',$2,$2",
      [ids, admin.id],
    )
    const first = await request('conversations?all=true&q=Pagination%20fixture')
    expect(first.data.conversations).toHaveLength(200)
    expect(first.data.nextCursor).toBeTruthy()
    const second = await request(
      'conversations?all=true&q=Pagination%20fixture&cursor=' +
        encodeURIComponent(first.data.nextCursor),
    )
    expect(second.data.conversations).toHaveLength(5)
    expect(
      new Set(
        [...first.data.conversations, ...second.data.conversations].map(
          (r: Payload) => r.id,
        ),
      ).size,
    ).toBe(205)
    expect(second.data.nextCursor).toBeNull()
    await adminDb.query('DELETE FROM conversations WHERE id=ANY($1::uuid[])', [
      ids,
    ])
  })

  test('uncommitted messages cannot be skipped by a polling cursor', async () => {
    const dedicated = (
      await request('conversations', {
        data: { kind: 'group', name: 'Commit ordering', members: [agent.id] },
      })
    ).data.id
    const writer = await adminDb.connect()
    const { newId } = await import('../src/lib/id')
    try {
      await writer.query('BEGIN')
      await writer.query('UPDATE conversations SET last_seq=1 WHERE id=$1', [
        dedicated,
      ])
      await writer.query(
        "INSERT INTO messages(id,conversation_id,seq,sender_id,text,idempotency_key,request_hash) VALUES($1,$2,1,$3,'Uncommitted first message',$4,'fixture')",
        [newId(), dedicated, agent.id, randomUUID()],
      )
      const second = request(`conversations/${dedicated}/messages`, {
        bearer: token,
        data: { text: 'Second message', idempotencyKey: randomUUID() },
      })
      const during = (
        await request(`conversations/${dedicated}/messages?after=0`)
      ).data
      expect(during.latest).toBe('0')
      expect(during.messages).toHaveLength(0)
      await writer.query('COMMIT')
      expect((await second).data.seq).toBe('2')
      expect(
        (
          await request(`conversations/${dedicated}/messages?after=0`)
        ).data.messages.map((m: Payload) => m.seq),
      ).toEqual(['1', '2'])
    } finally {
      await writer.query('ROLLBACK')
      writer.release()
    }
  })

  test('BIGINT cursors preserve values beyond JavaScript safe integers', async () => {
    const dedicated = (
      await request('conversations', {
        data: { kind: 'group', name: 'Large cursor', members: [agent.id] },
      })
    ).data.id
    await adminDb.query(
      'UPDATE conversations SET last_seq=9007199254740992 WHERE id=$1',
      [dedicated],
    )
    const sent = await request(`conversations/${dedicated}/messages`, {
      bearer: token,
      data: { text: 'Exact cursor', idempotencyKey: randomUUID() },
    })
    expect(sent.data.seq).toBe('9007199254740993')
    const page = (
      await request(
        `conversations/${dedicated}/messages?after=9007199254740992`,
        { bearer: token },
      )
    ).data
    expect(page.nextCursor).toBe('9007199254740993')
    expect(
      (
        await request(`conversations/${dedicated}/read`, {
          bearer: token,
          data: { messageIds: [sent.data.id] },
        })
      ).data.read,
    ).toBe(1)
    const receipt = (
      await adminDb.query(
        'SELECT read_ranges::text FROM conversation_members WHERE conversation_id=$1 AND actor_id=$2',
        [dedicated, agent.id],
      )
    ).rows[0].read_ranges
    expect(receipt).toContain('[9007199254740993,9007199254740994)')
    expect(
      (
        await request(`conversations/${dedicated}/messages?after=0&before=10`, {
          bearer: token,
        })
      ).status,
    ).toBe(400)
  })

  test('completed setup stays closed and cannot replace the owner', async () => {
    const result = await request('setup', {
      anonymous: true,
      data: { name: 'Another person', username: 'another_person', password },
    })
    expect(result.status).toBe(409)
    expect(result.data.error.code).toBe('ALREADY_INITIALIZED')
    expect((await adminDb.query('SELECT owner_id FROM instance')).rows).toEqual(
      [{ owner_id: admin.id }],
    )
    expect(
      (await adminDb.query('SELECT count(*)::int AS count FROM ac_user'))
        .rows[0].count,
    ).toBe(1)
  })

  test('avatars are owner-managed, private, replaceable and revoked with membership', async () => {
    const portrait = await createAgent('Portrait fixture')
    const peer = await createAgent('Portrait peer')
    const portraitRoom = (
      await request('conversations', {
        data: {
          kind: 'group',
          name: 'Photo fixture',
          members: [portrait.actor.id, peer.actor.id],
        },
      })
    ).data.id
    const upload = (
      bearer?: string,
      bytes = avatarFixture,
      mime = 'image/png',
      extra: Record<string, string> = {},
    ) =>
      fetch(origin + `/api/v1/agents/${portrait.actor.id}/avatar`, {
        method: 'PUT',
        headers: {
          Origin: origin,
          ...(bearer
            ? { Authorization: `Bearer ${bearer}` }
            : { Cookie: cookie }),
          'Content-Type': mime,
          ...extra,
        },
        body: new Uint8Array(bytes),
      })
    expect((await upload(portrait.token)).status).toBe(403)
    expect(
      (await upload(undefined, avatarFixture, 'image/svg+xml')).status,
    ).toBe(415)
    expect((await upload(undefined, Buffer.from('<svg/>'))).status).toBe(400)
    expect((await upload(undefined, Buffer.alloc(262145))).status).toBe(413)
    expect(
      (
        await upload(undefined, avatarFixture, 'image/png', {
          Origin: 'https://attacker.invalid',
        })
      ).status,
    ).toBe(403)
    const first = await upload()
    expect(first.status).toBe(200)
    const firstId = (await first.json()).avatar_id
    const read = (id: string, bearer?: string, etag?: string) =>
      fetch(origin + `/api/v1/avatars/${id}`, {
        headers: {
          ...(bearer
            ? { Authorization: `Bearer ${bearer}` }
            : { Cookie: cookie }),
          ...(etag ? { 'If-None-Match': etag } : {}),
        },
      })
    expect((await fetch(origin + `/api/v1/avatars/${firstId}`)).status).toBe(
      401,
    )
    expect((await read(firstId, outsiderToken)).status).toBe(404)
    const peerRead = await read(firstId, peer.token)
    expect(peerRead.status).toBe(200)
    expect(peerRead.headers.get('content-type')).toBe('image/png')
    expect(Buffer.from(await peerRead.arrayBuffer())).toEqual(avatarFixture)
    const etag = peerRead.headers.get('etag')!
    expect((await read(firstId, peer.token, etag)).status).toBe(304)
    await request(`conversations/${portraitRoom}/members`, {
      method: 'PUT',
      data: { members: [admin.id, portrait.actor.id] },
    })
    expect((await read(firstId, peer.token, etag)).status).toBe(404)
    const secondId = (await (await upload()).json()).avatar_id
    expect(secondId).not.toBe(firstId)
    expect((await read(firstId)).status).toBe(404)
    await expect(
      readFile(join(process.env.FILES_DIR!, firstId)),
    ).rejects.toThrow()
    expect(
      (
        await request(`agents/${portrait.actor.id}/avatar`, {
          method: 'DELETE',
        })
      ).status,
    ).toBe(200)
    expect((await read(secondId)).status).toBe(404)
    await expect(
      readFile(join(process.env.FILES_DIR!, secondId)),
    ).rejects.toThrow()
    const concurrent = await Promise.all([upload(), upload()])
    expect(concurrent.map((r) => r.status)).toEqual([200, 200])
    savedAvatarId = (await request('me', { bearer: portrait.token })).data.actor
      .avatar_id
    const ids = await Promise.all(
      concurrent.map(async (r) => (await r.json()).avatar_id),
    )
    for (const id of ids)
      expect((await read(id)).status).toBe(id === savedAvatarId ? 200 : 404)
    const listed = (await request('conversations')).data.conversations.find(
      (c: Payload) => c.id === portraitRoom,
    )
    expect(
      listed.members.find((a: Payload) => a.id === portrait.actor.id).avatar_id,
    ).toBe(savedAvatarId)
    const sent = await request(`conversations/${portraitRoom}/messages`, {
      bearer: portrait.token,
      data: { text: 'Avatar fixture', idempotencyKey: randomUUID() },
    })
    const page = (
      await request(`conversations/${portraitRoom}/messages?latest=true`)
    ).data
    expect(
      page.messages.find((m: Payload) => m.id === sent.data.id)
        .sender_avatar_id,
    ).toBe(savedAvatarId)
  })

  test('owner notification dismissal preserves exact receipts and agent unread delivery', async () => {
    const sender = await createAgent('Notification sender')
    const reader = await createAgent('Notification reader')
    const chat = (
      await request('conversations', {
        data: {
          kind: 'group',
          name: 'Notification regression',
          members: [sender.actor.id, reader.actor.id],
        },
      })
    ).data.id
    const sent: Payload[] = []
    for (let i = 0; i < 6; i++) {
      const result = await request(`conversations/${chat}/messages`, {
        bearer: sender.token,
        data: {
          text: `Notification ${i}`,
          idempotencyKey: randomUUID(),
          mentions: [admin.id, reader.actor.id],
        },
      })
      expect(result.status).toBe(201)
      sent.push(result.data)
    }
    const listed = async (bearer?: string) =>
      (await request('conversations', { bearer })).data.conversations.find(
        (c: Payload) => c.id === chat,
      )
    expect((await listed()).unread).toBe(6)
    await request(`conversations/${chat}/read`, {
      data: { messageIds: [sent[5].id] },
    })
    const exactState = async () =>
      (
        await adminDb.query(
          'SELECT actor_id,last_read_seq,read_ranges::text FROM conversation_members WHERE conversation_id=$1 ORDER BY actor_id',
          [chat],
        )
      ).rows
    const before = await exactState()
    const checkBefore = (await request('check', { bearer: reader.token })).data
    const inboxBefore = (await request('inbox', { bearer: reader.token })).data
    const dismiss = (messageId: string, bearer?: string) =>
      request(`conversations/${chat}/dismiss-notifications`, {
        bearer,
        data: { messageId },
      })
    expect((await dismiss(sent[4].id)).data.dismissedThrough).toBe('5')
    expect((await listed()).unread).toBe(0)
    expect((await listed()).attention).toBe(0)
    expect(await exactState()).toEqual(before)
    expect((await listed(reader.token)).unread).toBe(6)
    expect((await request('check', { bearer: reader.token })).data).toEqual(
      checkBefore,
    )
    expect((await request('inbox', { bearer: reader.token })).data).toEqual(
      inboxBefore,
    )
    const history = (await request(`conversations/${chat}/messages?after=0`))
      .data.messages
    expect(
      history
        .slice(0, 5)
        .every(
          (m: Payload) => !m.read_by.some((a: Payload) => a.id === admin.id),
        ),
    ).toBe(true)
    expect(history[5].read_by.some((a: Payload) => a.id === admin.id)).toBe(
      true,
    )

    const next = (
      await request(`conversations/${chat}/messages`, {
        bearer: sender.token,
        data: {
          text: 'Arrived after viewing',
          idempotencyKey: randomUUID(),
          mentions: [admin.id],
        },
      })
    ).data
    // Retrying an older tab's boundary must not swallow newer messages or regress it.
    const results = await Promise.all([
      dismiss(sent[5].id),
      dismiss(sent[0].id),
      dismiss(sent[4].id),
    ])
    expect(results.every((r) => r.status === 200)).toBe(true)
    expect((await listed()).unread).toBe(1)
    expect((await listed()).attention).toBe(1)
    expect((await dismiss(next.id, reader.token)).status).toBe(403)
    expect((await dismiss(next.id, outsiderToken)).status).toBe(403)
    expect((await dismiss(randomUUID())).status).toBe(400)
    const foreign = (
      await request(`conversations/${room}/messages?latest=true`)
    ).data.messages.at(-1)
    expect((await dismiss(foreign.id)).status).toBe(400)

    const agentOnly = (
      await request('conversations', {
        data: { kind: 'direct', members: [sender.actor.id, reader.actor.id] },
      })
    ).data.id
    const reviewMessage = (
      await request(`conversations/${agentOnly}/messages`, {
        bearer: sender.token,
        data: { text: 'Agents only', idempotencyKey: randomUUID() },
      })
    ).data
    expect(
      (
        await request(`conversations/${agentOnly}/dismiss-notifications`, {
          data: { messageId: reviewMessage.id },
        })
      ).status,
    ).toBe(404)
    expect(
      (
        await adminDb.query(
          'SELECT 1 FROM conversation_members WHERE conversation_id=$1 AND actor_id=$2',
          [agentOnly, admin.id],
        )
      ).rowCount,
    ).toBe(0)

    const large = (
      await request('conversations', {
        data: { kind: 'direct', members: [reader.actor.id] },
      })
    ).data.id
    await adminDb.query(
      'UPDATE conversations SET last_seq=9007199254740992 WHERE id=$1',
      [large],
    )
    const largeMessage = (
      await request(`conversations/${large}/messages`, {
        bearer: reader.token,
        data: {
          text: 'Large notification cursor',
          idempotencyKey: randomUUID(),
        },
      })
    ).data
    expect(
      (
        await request(`conversations/${large}/dismiss-notifications`, {
          data: { messageId: largeMessage.id },
        })
      ).data.dismissedThrough,
    ).toBe('9007199254740993')
  })

  test('backup restores database, attachments, avatars, notifications and credentials into an empty target', async () => {
    const destination = join(filesDir, 'backup')
    await execute(
      process.execPath,
      [
        '--import',
        'tsx',
        'scripts/backup.ts',
        '--confirm-paused',
        '--out',
        destination,
      ],
      { env: process.env },
    )
    const manifest = JSON.parse(
      await readFile(join(destination, 'manifest.json'), 'utf8'),
    )
    expect(manifest.files).toHaveLength(2)
    expect(
      manifest.files.some((file: { id: string }) => file.id === savedAvatarId),
    ).toBe(true)
    const restoredUrl = new URL(databaseUrl)
    const restoreName = `agent_chat_restore_${randomUUID().replaceAll('-', '')}_test`
    restoredUrl.pathname = '/' + restoreName
    await adminDb.query(`CREATE DATABASE "${restoreName}"`)
    const restored = new pg.Client({ connectionString: restoredUrl.href })
    try {
      const restoreEnv = {
        ...process.env,
        DATABASE_URL: restoredUrl.href,
        MIGRATION_DATABASE_URL: restoredUrl.href,
        FILES_DIR: join(filesDir, 'restored-files'),
      }
      await execute(
        process.execPath,
        [
          '--import',
          'tsx',
          'scripts/restore.ts',
          '--confirm-empty-target',
          '--from',
          destination,
        ],
        { env: restoreEnv },
      )
      await restored.connect()
      expect(
        (await restored.query('SELECT count(*) FROM messages')).rows[0].count,
      ).toBe(
        (await adminDb.query('SELECT count(*) FROM messages')).rows[0].count,
      )
      const memberState =
        'SELECT conversation_id,actor_id,last_read_seq,read_ranges::text,dismissed_through_seq FROM conversation_members ORDER BY conversation_id,actor_id'
      expect((await restored.query(memberState)).rows).toEqual(
        (await adminDb.query(memberState)).rows,
      )
      const creationState =
        'SELECT id,created_by,owner_id,creation_key,creation_hash FROM conversations ORDER BY id'
      expect((await restored.query(creationState)).rows).toEqual(
        (await adminDb.query(creationState)).rows,
      )
      expect(
        (
          await restored.query('SELECT token_hash FROM actors WHERE id=$1', [
            agent.id,
          ])
        ).rows[0].token_hash,
      ).toBe(
        (
          await adminDb.query('SELECT token_hash FROM actors WHERE id=$1', [
            agent.id,
          ])
        ).rows[0].token_hash,
      )
      expect(
        await readFile(join(restoreEnv.FILES_DIR, uploadedFileId), 'utf8'),
      ).toContain('username,language')
      expect(await readFile(join(restoreEnv.FILES_DIR, savedAvatarId))).toEqual(
        avatarFixture,
      )
      expect(
        (
          await restored.query('SELECT id FROM actors WHERE avatar_id=$1', [
            savedAvatarId,
          ])
        ).rowCount,
      ).toBe(1)
      await execute(
        process.execPath,
        ['--import', 'tsx', 'scripts/doctor.ts'],
        { env: restoreEnv },
      )
      await expect(
        execute(
          process.execPath,
          [
            '--import',
            'tsx',
            'scripts/restore.ts',
            '--confirm-empty-target',
            '--from',
            destination,
          ],
          { env: restoreEnv },
        ),
      ).rejects.toThrow()
    } finally {
      await restored.end()
      await adminDb.query(`DROP DATABASE "${restoreName}"`)
    }
  })
  test('exact receipts preserve gaps, concurrent reads merge, and check stays read-only', async () => {
    const reader = await createAgent('Exact receipts')
    const chat = (
      await request('conversations', {
        data: { kind: 'direct', members: [reader.actor.id] },
      })
    ).data.id
    const sent = []
    for (let i = 0; i < 5; i++)
      sent.push(
        (
          await request(`conversations/${chat}/messages`, {
            data: { text: `Original ${i}`, idempotencyKey: randomUUID() },
          })
        ).data,
      )
    const firstCheck = await request('check', { bearer: reader.token })
    expect(firstCheck.data.unread).toBe(5)
    const tail = await request(
      `conversations/${chat}/messages?latest=true&limit=2`,
      { bearer: reader.token },
    )
    expect(tail.data.messages.map((m: Payload) => m.seq)).toEqual(['4', '5'])
    expect((await request('check', { bearer: reader.token })).data.unread).toBe(
      5,
    )
    expect(
      (
        await request(`conversations/${chat}/read`, {
          bearer: reader.token,
          data: { messageIds: tail.data.messages.map((m: Payload) => m.id) },
        })
      ).status,
    ).toBe(200)
    expect((await request('check', { bearer: reader.token })).data.unread).toBe(
      3,
    )
    const page = await request('inbox?limit=2', { bearer: reader.token })
    expect(page.data.messages.map((m: Payload) => m.seq)).toEqual(['1', '2'])
    expect(page.data.hasMore).toBe(true)
    await Promise.all(
      sent.slice(0, 3).map((m) =>
        request(`conversations/${chat}/read`, {
          bearer: reader.token,
          data: { messageIds: [m.id] },
        }),
      ),
    )
    expect((await request('check', { bearer: reader.token })).data.unread).toBe(
      0,
    )
    const read = await request(`conversations/${chat}/messages?after=0`)
    expect(
      read.data.messages.every((m: Payload) =>
        m.read_by.some((a: Payload) => a.id === reader.actor.id),
      ),
    ).toBe(true)
    expect(
      (
        await request(`conversations/${chat}/read`, {
          bearer: reader.token,
          data: { messageIds: [randomUUID()] },
        })
      ).status,
    ).toBe(400)
    expect(
      (
        await request(`conversations/${chat}/read`, {
          bearer: outsiderToken,
          data: { messageIds: [sent[0].id] },
        })
      ).status,
    ).toBe(404)
    const older = await request(
      `conversations/${chat}/messages?before=5&limit=2`,
      { bearer: reader.token },
    )
    expect(older.data.messages.map((m: Payload) => m.seq)).toEqual(['3', '4'])
    expect(older.data.nextCursor).toBe('3')
    const around = await request(
      `conversations/${chat}/messages?around=3&limit=3`,
      { bearer: reader.token },
    )
    expect(around.data.messages.map((m: Payload) => m.seq)).toEqual([
      '2',
      '3',
      '4',
    ])
    expect(
      (
        await request(`conversations/${chat}/messages?around=3&after=0`, {
          bearer: reader.token,
        })
      ).status,
    ).toBe(400)
  })

  test('CLI inbox returns original unread bodies across rooms and marks only those read', async () => {
    const reader = await createAgent('Inbox reader')
    const rooms = []
    for (let i = 0; i < 2; i++)
      rooms.push(
        (
          await request('conversations', {
            data: {
              kind: 'group',
              name: `Inbox ${i}`,
              members: [reader.actor.id],
            },
          })
        ).data.id,
      )
    for (const id of rooms)
      await request(`conversations/${id}/messages`, {
        data: {
          text: 'Keep this original text exactly.',
          mentions: [reader.actor.id],
          idempotencyKey: randomUUID(),
        },
      })
    const env = {
      ...process.env,
      AGENT_CHAT_TOKEN: reader.token,
      AGENT_CHAT_SERVER: origin,
      AGENT_CHAT_CONFIG_DIR: join(filesDir, 'inbox-profile'),
    }
    const run = (...args: string[]) =>
      execute(process.execPath, ['public/agent-chat.mjs', ...args], { env })
    const summary = JSON.parse((await run('check')).stdout)
    expect(summary.unread).toBe(2)
    const first = JSON.parse((await run('inbox', '--limit', '1')).stdout)
    expect(first.hasMore).toBe(true)
    expect(first.messages[0].text).toBe('Keep this original text exactly.')
    expect((await request('check', { bearer: reader.token })).data.unread).toBe(
      1,
    )
    const second = JSON.parse((await run('inbox')).stdout)
    expect(second.messages[0].id).not.toBe(first.messages[0].id)
    expect((await request('check', { bearer: reader.token })).data.unread).toBe(
      0,
    )
    expect(JSON.parse((await run('inbox')).stdout).messages).toHaveLength(0)
    for (const command of ['inbox', 'read', 'check', 'send', 'pair']) {
      const result = await run('help', command)
      expect(result.stdout).not.toContain(reader.token)
      expect(result.stdout).toContain(command)
    }
  })

  test('password changes and owner recovery enforce eight characters and keep old passwords usable until changed', async () => {
    const change = (currentPassword: string, newPassword: string) =>
      fetch(origin + '/api/auth/change-password', {
        method: 'POST',
        headers: {
          Origin: origin,
          Cookie: cookie,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          currentPassword,
          newPassword,
          revokeOtherSessions: true,
        }),
      })
    const login = async (value: string) => {
      // Isolate password-policy checks from earlier rapid test sign-ins. This
      // clears only the disposable test database, never production rate limits.
      await adminDb.query('DELETE FROM ac_rate_limit')
      return fetch(origin + '/api/auth/sign-in/username', {
        method: 'POST',
        headers: { Origin: origin, 'Content-Type': 'application/json' },
        body: JSON.stringify({ username: 'test_admin', password: value }),
      })
    }
    expect((await change(password, 'Short7!')).status).toBe(400)
    expect((await login(password)).status).toBe(200)
    const longPassword = 'Existing-long-password-123!'
    expect((await change(password, longPassword)).status).toBe(200)
    const longLogin = await login(longPassword)
    expect(longLogin.status).toBe(200)
    cookie = longLogin.headers
      .getSetCookie()
      .map((c) => c.split(';')[0])
      .join('; ')
    expect((await change(longPassword, 'Next8-ok')).status).toBe(200)
    const shortLogin = await login('Next8-ok')
    expect(shortLogin.status).toBe(200)
    cookie = shortLogin.headers
      .getSetCookie()
      .map((c) => c.split(';')[0])
      .join('; ')
    expect((await login(longPassword)).status).toBe(401)
    const passwordFile = join(filesDir, 'recovery-password')
    const recover = () =>
      execute(
        process.execPath,
        [
          '--import',
          'tsx',
          'scripts/reset-owner.ts',
          '--username',
          'test_admin',
          '--password-file',
          passwordFile,
          '--confirm-recovery',
        ],
        { env: process.env },
      )
    await writeFile(passwordFile, 'Short7!\n', { mode: 0o600 })
    await expect(recover()).rejects.toThrow()
    expect((await request('me')).status).toBe(200)
    await writeFile(passwordFile, 'Fix8-ok!\n', { mode: 0o600 })
    const recovery = await recover()
    expect(recovery.stdout).not.toContain('Fix8-ok!')
    expect((await request('me')).status).toBe(401)
    expect((await login('Next8-ok')).status).toBe(401)
    expect((await login('Fix8-ok!')).status).toBe(200)
  })
})
