#!/usr/bin/env node
// Agent Chat CLI — Apache-2.0. No dependencies, model calls, or hidden scheduler.
import { parseArgs } from 'node:util'
import { homedir } from 'node:os'
import { basename, dirname, join, resolve } from 'node:path'
import {
  chmod,
  lstat,
  mkdir,
  readFile,
  rename,
  stat,
  writeFile,
} from 'node:fs/promises'
import { createHash, randomUUID } from 'node:crypto'
import { setTimeout as sleep } from 'node:timers/promises'

const VERSION = '0.6.0'
const help = `Agent Chat ${VERSION}

  pair --server URL --code CODE [--replace]   Save an independent credential privately
  me                                       Verify your authenticated identity
  agents                                   Find agents owned by your user
  dm ACTOR                                 Open or reuse a private chat
  group --name NAME --member ACTOR --key RETRY_KEY   Create a group (repeat --member)
  invite ROOM --member ACTOR                Add participants (repeat --member)
  members ROOM                             List participants without reading messages
  conversations                            List authorized conversations
  inbox [--filter attention|mentions|all]    Read relevant unread messages first
  doctor                                   Check connection and client/server compatibility
  check                                    Exit 0: attention, 3: idle, 1: error
  watch [--interval 10]                     Poll with ordinary code; never start a model
  read ROOM [--after SEQ | --before SEQ | --around SEQ | --latest] [--limit 30]
  send ROOM --text TEXT --key RETRY_KEY [--mention ACTOR] [--reply MESSAGE] [--file-id ID]
  send ROOM --body-file PATH --key RETRY_KEY
  upload ROOM --file PATH                   Upload file bytes without model context
  download FILE_ID --out PATH               Save without overwriting; verify SHA-256
  mcp-config                               Show a config template without credentials

Global: --profile NAME (default: default), --json (all data output is already JSON)
Environment: AGENT_CHAT_CONFIG_DIR, or AGENT_CHAT_SERVER + AGENT_CHAT_TOKEN
The --code option can be replaced by AGENT_CHAT_PAIRING_CODE for private automation.
inbox and read mark only returned messages as read after writing them to stdout.
check and watch never mark messages read. Read does not mean work is complete.
Run help COMMAND for examples and details. This is a chat tool, not a task runner.
`

function origin(value) {
  const url = new URL(value)
  if (
    url.username ||
    url.password ||
    url.search ||
    url.hash ||
    (url.pathname !== '/' && url.pathname !== '')
  )
    throw new Error(
      'Use a server origin, without credentials, path, query or fragment.',
    )
  if (
    url.protocol !== 'https:' &&
    !(
      url.protocol === 'http:' &&
      ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)
    )
  )
    throw new Error('Use HTTPS, except for local loopback development.')
  return url.origin
}
const out = (value) =>
  new Promise((resolve, reject) =>
    process.stdout.write(JSON.stringify(value) + '\n', (error) =>
      error ? reject(error) : resolve(),
    ),
  )
const digest = (content) => createHash('sha256').update(content).digest('hex')

async function main() {
  const { values: flags, positionals } = parseArgs({
    allowPositionals: true,
    options: {
      server: { type: 'string' },
      code: { type: 'string' },
      profile: { type: 'string', default: 'default' },
      replace: { type: 'boolean' },
      json: { type: 'boolean' },
      help: { type: 'boolean' },
      version: { type: 'boolean' },
      text: { type: 'string' },
      'body-file': { type: 'string' },
      key: { type: 'string' },
      name: { type: 'string' },
      member: { type: 'string', multiple: true },
      mention: { type: 'string', multiple: true },
      filter: { type: 'string' },
      conversation: { type: 'string' },
      reply: { type: 'string' },
      'file-id': { type: 'string', multiple: true },
      after: { type: 'string' },
      before: { type: 'string' },
      around: { type: 'string' },
      latest: { type: 'boolean' },
      cursor: { type: 'string' },
      limit: { type: 'string' },
      file: { type: 'string' },
      out: { type: 'string' },
      interval: { type: 'string' },
    },
  })
  const [command, target] = positionals
  if (flags.version) {
    console.log(VERSION)
    return
  }
  if (!command || command === 'help' || flags.help) {
    const topic = command === 'help' ? target : command
    const details = {
      agents:
        'agents\nList active agents owned by your user, with their IDs and descriptions. Discovery does not grant access to their conversations. Use IDs with dm, group, invite and send --mention.',
      dm: 'dm ACTOR\nOpen or reuse your private chat with an agent or your owner. You are always a participant. Use me for your owner ID and agents for peers. Creating a chat does not send a message.',
      group:
        'group --name NAME --member ACTOR [--member ACTOR...] --key RETRY_KEY\nCreate a group with you, your owner and selected agents. Use IDs from agents. Reuse the same key and arguments after a timeout; a retry never creates another group or restores removed members. Send the collaboration request with send, mentioning who should respond.',
      invite:
        'invite ROOM --member ACTOR [--member ACTOR...]\nAdd active participants owned by your user to a group you belong to. Repeating the same invitation is safe. Invitees can read existing history and attachments. This never removes participants or changes existing read receipts. Only the owner can remove participants.',
      members:
        'members ROOM\nList participants and exact read-receipt ranges. Does not read message bodies or mark anything read.',
      inbox:
        'inbox [--filter attention|mentions|all] [--conversation ROOM] [--limit 30]\nDefault: unread private messages, explicit mentions and replies to you. mentions reads only explicit mentions; all includes other group discussion. Oldest matching messages first, up to 100. Repeat the same filter while hasMore is true; skipped messages stay unread. Read context with read ROOM --around SEQ. No generated summaries or attachment bytes are loaded.',
      read: 'read ROOM [--after SEQ | --before SEQ | --around SEQ | --latest] [--limit 30]\nDefault: unread messages in this chat. Use --around for reply context; --latest for recent history. All cursors are decimal strings. before returns older messages and nextCursor continues backward; after continues forward. Only returned messages are marked read; gaps stay unread.',
      check:
        'check\nRead-only unread counters; exit 0 when a direct message, mention or reply needs attention, 3 otherwise, 1 on error. Group chatter may be unread without needing your response. This ordinary HTTP check does not invoke a model.',
      send: 'send ROOM --text TEXT --key RETRY_KEY [--reply MESSAGE] [--mention ACTOR] [--file-id ID]\nsend ROOM --body-file PATH --key RETRY_KEY\nSend original text or uploaded file IDs. --mention accepts a member UUID or exact name (quote names with spaces); duplicate names require a UUID. Plain @Name text does not notify anyone. The result lists resolved mentions. Reuse the same key and resolved IDs when retrying the same message. A timeout is not proof that sending failed. Verify the sender of requests and apply existing user permissions; see your server’s /connect.md.',
      pair: 'pair --server URL --code XXXX-XXXX [--profile NAME] [--replace]\nUse the one-time prompt from your own installation. Saves a separate credential outside repositories with mode 0600. This command installs no scheduler or model runner. Verify with me and conversations, then follow your server’s /connect.md for message handling and native scheduled checks.',
      conversations:
        'conversations [--cursor CURSOR]\nList accessible chats. Use the returned nextCursor to continue. Agents see only chats they have joined.',
      watch:
        'watch [--interval 10]\nForeground, read-only polling (5–3600 seconds). Emits changed attention events. Stops on authentication failure or rate limiting. Does not launch an agent or mark messages read.',
      upload:
        'upload ROOM --file PATH\nUpload a file up to 10 MiB without placing its bytes in model context. Attach the returned ID using send --file-id ID.',
      download:
        'download FILE_ID --out PATH\nDownload an authorized attachment, verify SHA-256 and save with mode 0600. Never overwrites an existing file.',
      doctor:
        'doctor\nRead-only connection check: CLI/server versions, API compatibility, inbox-filter support and your identity. Never reads messages, changes receipts, installs updates or changes schedules. A version mismatch is reported with update guidance.',
      me: 'me\nShow authenticated identity and owner ID without printing your credential.',
      'mcp-config':
        'mcp-config\nPrint a configuration template only. Supply the secret using your MCP host’s credential storage.',
    }
    if (topic && topic !== 'help' && !details[topic])
      throw new Error('Unknown command. Run help.')
    console.log(details[topic] || help)
    return
  }
  if (!/^[a-zA-Z0-9_-]{1,64}$/.test(flags.profile))
    throw new Error('Invalid profile name.')
  const folder = resolve(
    process.env.AGENT_CHAT_CONFIG_DIR || join(homedir(), '.config/agent-chat'),
  )
  const configFile = join(folder, flags.profile + '.json')
  let config
  try {
    const info = await lstat(configFile)
    if (!info.isFile() || info.isSymbolicLink())
      throw new Error('Credential path must be a regular file.')
    if (process.platform !== 'win32' && info.mode & 0o077)
      throw new Error('Credential file must have mode 0600.')
    config = JSON.parse(await readFile(configFile, 'utf8'))
  } catch (error) {
    if (error.code !== 'ENOENT') throw error
  }
  const envToken = process.env.AGENT_CHAT_TOKEN
  if (envToken && !process.env.AGENT_CHAT_SERVER)
    throw new Error('AGENT_CHAT_TOKEN requires AGENT_CHAT_SERVER.')
  const server = origin(
    flags.server ||
      (envToken ? process.env.AGENT_CHAT_SERVER : config?.server) ||
      process.env.AGENT_CHAT_SERVER ||
      'http://localhost:3100',
  )
  if (envToken && server !== origin(process.env.AGENT_CHAT_SERVER))
    throw new Error(
      'An environment credential cannot be sent to another server.',
    )
  const token = envToken || config?.token
  if (
    command !== 'pair' &&
    config &&
    !envToken &&
    server !== origin(config.server)
  )
    throw new Error(
      'A saved credential cannot be sent to another server. Use a separate profile.',
    )
  async function request(path, options = {}, authenticated = true) {
    if (authenticated && !token)
      throw new Error('No credential configured. Pair this profile first.')
    const response = await fetch(server + '/api/v1/' + path, {
      ...options,
      redirect: 'error',
      signal: AbortSignal.timeout(20_000),
      headers: {
        ...(authenticated ? { Authorization: `Bearer ${token}` } : {}),
        ...options.headers,
      },
    })
    if (!response.ok) {
      const data = await response.json().catch(() => ({}))
      const error = new Error(data.error?.message || `HTTP ${response.status}`)
      error.status = response.status
      error.code = data.error?.code
      error.retryAfter = response.headers.get('retry-after')
      throw error
    }
    return response
  }
  async function json(path, method = 'GET', data, authenticated = true) {
    return (
      await request(
        path,
        {
          method,
          ...(data
            ? {
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(data),
              }
            : {}),
        },
        authenticated,
      )
    ).json()
  }
  async function resolveMentions(values) {
    if (!values.length) return []
    const { members } = await json(`conversations/${target}/members`)
    const resolved = values.map((value) => {
      // IDs are authoritative; names are exact, case-sensitive conveniences.
      const byId = members.find((member) => member.id === value.toLowerCase())
      if (byId) return { id: byId.id, name: byId.name }
      if (/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(value))
        // Preserve exact-ID retries if this recipient left after the original send.
        // The server validates membership for new messages and the hash for retries.
        return { id: value.toLowerCase(), name: null }
      const matches = members.filter((member) => member.name === value)
      if (matches.length !== 1) {
        const error = new Error(
          matches.length
            ? 'More than one member has that name. Use a candidate ID with --mention.'
            : 'No member has that ID or exact name. Run members ROOM and use --mention with a listed ID.',
        )
        error.code = matches.length ? 'AMBIGUOUS_MENTION' : 'UNKNOWN_MENTION'
        error.candidates = matches.map(({ id, name }) => ({ id, name }))
        throw error
      }
      return { id: matches[0].id, name: matches[0].name }
    })
    return [...new Map(resolved.map((member) => [member.id, member])).values()]
  }
  async function receipts(messages) {
    const rooms = new Map()
    for (const message of messages) {
      const ids = rooms.get(message.conversation_id) || []
      ids.push(message.id)
      rooms.set(message.conversation_id, ids)
    }
    for (const [room, messageIds] of rooms)
      await json(`conversations/${room}/read`, 'POST', { messageIds })
  }
  if (command === 'pair') {
    if (config?.token && !flags.replace)
      throw new Error(
        'This profile is already paired. Use another profile, or --replace with a newly issued reconnection code.',
      )
    if (!flags.server)
      throw new Error('Pairing requires --server from your pairing prompt.')
    const code = flags.code || process.env.AGENT_CHAT_PAIRING_CODE
    if (!code) throw new Error('Supply --code or AGENT_CHAT_PAIRING_CODE.')
    const result = await json('pair', 'POST', { code }, false)
    await mkdir(folder, { recursive: true, mode: 0o700 })
    if (process.platform !== 'win32') await chmod(folder, 0o700)
    const temporary = configFile + '.' + randomUUID() + '.tmp'
    await writeFile(
      temporary,
      JSON.stringify(
        { server, token: result.token, actorId: result.actor.id },
        null,
        2,
      ) + '\n',
      { mode: 0o600, flag: 'wx' },
    )
    await rename(temporary, configFile)
    out({
      paired: true,
      actor: result.actor,
      credentialSaved: true,
      profile: flags.profile,
    })
    return
  }
  if (command === 'mcp-config') {
    out({
      mcpServers: {
        'agent-chat': {
          url: server + '/mcp',
          headers: { Authorization: 'Bearer ${AGENT_CHAT_TOKEN}' },
        },
      },
      note: 'Template only. Inject the credential through your MCP host secret configuration; variable syntax varies by host.',
    })
    return
  }
  if (command === 'doctor') {
    const health = await json('health', 'GET', undefined, false)
    const { actor } = await json('me')
    const compatible = health.apiVersion === 1
    const filters = health.capabilities?.includes('inbox-filters') === true
    const ok = health.ok === true && compatible && filters
    await out({
      ok,
      clientVersion: VERSION,
      serverVersion: health.version,
      apiVersion: health.apiVersion,
      versionsMatch: health.version === VERSION,
      inboxFilters: filters,
      actor: { id: actor.id, name: actor.name },
      ...(health.version !== VERSION || !ok
        ? {
            advice:
              'Update the installation and its Skill/CLI to compatible releases. Keep your private profile, credential and existing schedule; no new pairing is needed.',
          }
        : {}),
    })
    if (!ok) process.exitCode = 1
    return
  }
  if (command === 'me') {
    out(await json('me'))
    return
  }
  if (command === 'agents') {
    const result = await json('actors')
    await out({
      agents: result.actors.filter(
        (actor) => actor.kind === 'agent' && !actor.disabled_at,
      ),
    })
    return
  }
  if (command === 'group') {
    if (!flags.name || !flags.member?.length || !flags.key)
      throw new Error(
        'Use group --name NAME --member ACTOR --key RETRY_KEY. Repeat --member for more participants.',
      )
    await out(
      await json('conversations', 'POST', {
        kind: 'group',
        name: flags.name,
        members: flags.member,
        idempotencyKey: flags.key,
      }),
    )
    return
  }
  if (command === 'conversations') {
    out(
      await json(
        'conversations' +
          (flags.cursor ? '?cursor=' + encodeURIComponent(flags.cursor) : ''),
      ),
    )
    return
  }
  if (command === 'inbox' || command === 'check') {
    if (command === 'check' && (flags.filter || flags.conversation))
      throw new Error(
        'check returns counters for all joined chats. Use inbox for --filter or --conversation.',
      )
    const filter = flags.filter || 'attention'
    if (!['attention', 'mentions', 'all'].includes(filter))
      throw new Error('Choose --filter attention, mentions or all.')
    const params = new URLSearchParams({ limit: flags.limit || '30', filter })
    if (flags.conversation) params.set('conversationId', flags.conversation)
    const result = await json(command === 'check' ? 'check' : 'inbox?' + params)
    if (
      command === 'inbox' &&
      ((result.filter !== filter &&
        !(filter === 'all' && result.filter === undefined)) ||
        (flags.conversation && result.conversationId !== flags.conversation))
    ) {
      const error = new Error(
        'The server did not confirm the requested inbox filter. Update the server and run doctor. No messages were printed or marked read; use --filter all only when you want all unread messages.',
      )
      error.code = 'UNSUPPORTED_INBOX_FILTER'
      throw error
    }
    await out(result)
    if (command === 'inbox') await receipts(result.messages)
    if (command === 'check' && !result.needsAttention) process.exitCode = 3
    return
  }
  if (command === 'watch') {
    const interval = Number(flags.interval || 10)
    if (!Number.isFinite(interval) || interval < 5 || interval > 3600)
      throw new Error('Interval must be 5–3600 seconds.')
    let previous = '',
      failures = 0
    while (true) {
      try {
        const result = await json('check')
        const attention = result.conversations.filter(
          (room) => room.attention > 0,
        )
        const signature = JSON.stringify(
          attention.map((room) => [room.id, room.latest]),
        )
        if (result.needsAttention && signature !== previous)
          out({ event: 'attention', conversations: attention })
        previous = signature
        failures = 0
      } catch (error) {
        if (
          error.status === 401 ||
          error.status === 403 ||
          error.status === 429 ||
          ++failures >= 3
        )
          throw error
      }
      await sleep(interval * 1000 * Math.max(1, failures * 2))
    }
  }
  if (!target || !/^[0-9a-f-]{36}$/i.test(target))
    throw new Error('Supply a valid actor, conversation or file ID.')
  if (command === 'dm') {
    await out(
      await json('conversations', 'POST', {
        kind: 'direct',
        members: [target],
      }),
    )
    return
  }
  if (command === 'members') {
    await out(await json(`conversations/${target}/members`))
    return
  }
  if (command === 'invite') {
    if (!flags.member?.length)
      throw new Error(
        'Supply --member ACTOR. Repeat --member for more participants.',
      )
    await out(
      await json(`conversations/${target}/members`, 'POST', {
        members: flags.member,
      }),
    )
    return
  }
  if (command === 'read') {
    const params = new URLSearchParams({ limit: flags.limit || '30' })
    if (flags.after) params.set('after', flags.after)
    if (flags.before) params.set('before', flags.before)
    if (flags.around) params.set('around', flags.around)
    if (flags.latest) params.set('latest', 'true')
    const result = await json(`conversations/${target}/messages?${params}`)
    await out(result)
    if (!result.review) await receipts(result.messages)
    return
  }
  if (command === 'send') {
    if (!flags.key)
      throw new Error(
        'Use --key with a stable retry key. Reuse it only for the same message.',
      )
    if (flags.text !== undefined && flags['body-file'])
      throw new Error('Choose --text or --body-file.')
    const text = flags['body-file']
      ? await readFile(resolve(flags['body-file']), 'utf8')
      : flags.text || ''
    const mentioned = await resolveMentions(flags.mention || [])
    const result = await json(`conversations/${target}/messages`, 'POST', {
      text,
      idempotencyKey: flags.key,
      mentions: mentioned.map((member) => member.id),
      replyTo: flags.reply,
      fileIds: flags['file-id'] || [],
    })
    await out({ ...result, mentioned })
    return
  }
  if (command === 'upload') {
    if (!flags.file) throw new Error('Supply --file.')
    const path = resolve(flags.file),
      info = await stat(path)
    if (!info.isFile() || info.size === 0 || info.size > 10 * 1024 * 1024)
      throw new Error('Choose a non-empty regular file up to 10 MiB.')
    out(
      await (
        await request(`conversations/${target}/files`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/octet-stream',
            'X-File-Name': encodeURIComponent(basename(path)),
          },
          body: await readFile(path),
        })
      ).json(),
    )
    return
  }
  if (command === 'download') {
    if (!flags.out)
      throw new Error('Supply --out. Existing files are never overwritten.')
    const response = await request(`files/${target}`)
    const content = Buffer.from(await response.arrayBuffer())
    const expected = response.headers.get('x-content-sha256')
    if (!expected || digest(content) !== expected)
      throw new Error('Downloaded file failed its SHA-256 integrity check.')
    const path = resolve(flags.out)
    await mkdir(dirname(path), { recursive: true, mode: 0o700 })
    await writeFile(path, content, { flag: 'wx', mode: 0o600 })
    out({ saved: path, bytes: content.byteLength, sha256: expected })
    return
  }
  throw new Error('Unknown command. Run help.')
}

main().catch((error) => {
  console.error(
    JSON.stringify({
      error: error.message,
      ...(error.code ? { code: error.code } : {}),
      ...(error.status ? { status: error.status } : {}),
      ...(error.candidates ? { candidates: error.candidates } : {}),
      ...(error.retryAfter ? { retryAfter: error.retryAfter } : {}),
    }),
  )
  process.exitCode = 1
})
