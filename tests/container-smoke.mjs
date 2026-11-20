import assert from 'node:assert/strict'
import { randomBytes, randomUUID } from 'node:crypto'
import { setTimeout } from 'node:timers/promises'

// This test initializes a disposable installation. Never run it against real data.
const origin = 'http://localhost:3100'
let cookie = ''
async function request(
  path,
  { data, token, anonymous = false, status = 200 } = {},
) {
  const headers = new Headers({ Origin: origin })
  if (token) headers.set('Authorization', `Bearer ${token}`)
  else if (cookie && !anonymous) headers.set('Cookie', cookie)
  if (data !== undefined) headers.set('Content-Type', 'application/json')
  const response = await fetch(origin + path, {
    method: data === undefined ? 'GET' : 'POST',
    headers,
    body: data === undefined ? undefined : JSON.stringify(data),
  })
  // Never print response bodies: enrollment and login responses contain secrets.
  assert.equal(response.status, status, `${path}: unexpected HTTP status`)
  return response
}
const api = async (path, options) =>
  (await request('/api/v1/' + path, options)).json()

try {
  let ready = false
  for (let attempt = 0; attempt < 30; attempt++) {
    try {
      if ((await fetch(origin + '/api/v1/health')).ok) {
        ready = true
        break
      }
    } catch {}
    await setTimeout(2000)
  }
  assert.ok(ready, 'Container did not become healthy')
  assert.equal(
    (await api('bootstrap')).initialized,
    false,
    'Requires a fresh installation',
  )
  const username = 'container_test'
  const password = randomBytes(24).toString('base64url')
  const account = { name: 'Container test owner', username, password }
  await api('setup', { data: account, status: 201 })
  await api('setup', { data: account, status: 409 })
  const login = await request('/api/auth/sign-in/username', {
    data: { username, password },
  })
  cookie = login.headers
    .getSetCookie()
    .map((value) => value.split(';')[0])
    .join('; ')
  assert.ok(cookie)
  const owner = (await api('me')).actor
  assert.equal(owner.kind, 'human')

  const enrollment = await api('agents', {
    data: { name: 'Container test agent' },
    status: 201,
  })
  const paired = await api('pair', {
    data: { code: enrollment.code },
    anonymous: true,
  })
  const token = paired.token
  assert.equal((await api('me', { token })).actor.owner_id, owner.id)
  await api('pair', {
    data: { code: enrollment.code },
    anonymous: true,
    status: 400,
  })
  const conversation = await api('conversations', {
    data: { kind: 'direct', members: [paired.actor.id] },
    status: 201,
  })
  const path = `conversations/${conversation.id}/messages`
  const data = {
    text: 'Synthetic container smoke message',
    idempotencyKey: randomUUID(),
  }
  const sent = await api(path, { data, status: 201 })
  const retry = await api(path, { data, status: 201 })
  assert.equal(sent.id, retry.id)
  assert.equal(retry.duplicate, true)
  assert.equal((await api('check', { token })).needsAttention, true)
  assert.ok(
    (await api(path, { token })).messages.some(
      (message) => message.id === sent.id,
    ),
  )
  await api(`conversations/${conversation.id}/read`, {
    token,
    data: { messageIds: [sent.id] },
  })
  assert.equal((await api('check', { token })).needsAttention, false)
  await api(path, {
    token,
    data: { text: 'Synthetic agent reply', idempotencyKey: randomUUID() },
    status: 201,
  })

  const content = 'Synthetic container attachment\n'
  const upload = await fetch(
    `${origin}/api/v1/conversations/${conversation.id}/files`,
    {
      method: 'POST',
      headers: {
        Origin: origin,
        Cookie: cookie,
        'Content-Type': 'text/plain',
        'X-File-Name': 'smoke.txt',
      },
      body: content,
    },
  )
  assert.equal(upload.status, 201, 'Attachment upload failed')
  const file = await upload.json()
  await api(path, {
    data: {
      text: 'Container file check',
      fileIds: [file.id],
      idempotencyKey: randomUUID(),
    },
    status: 201,
  })
  const download = await request(`/api/v1/files/${file.id}`, { token })
  assert.equal(await download.text(), content)
  await request(`/api/v1/files/${file.id}`, { anonymous: true, status: 401 })
  await request('/.env', { anonymous: true, status: 404 })
  await request('/data/files/' + file.id, { anonymous: true, status: 404 })
  console.log(
    'Container smoke passed: setup, login, pairing, chat, receipts, retries, private file storage.',
  )
} catch (error) {
  console.error(
    error instanceof Error ? error.message : 'Container smoke failed',
  )
  process.exitCode = 1
}
