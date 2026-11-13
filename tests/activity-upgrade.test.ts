import 'dotenv/config'
import { createHash, randomUUID } from 'node:crypto'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { readFile } from 'node:fs/promises'
import pg from 'pg'
import { expect, test } from 'vitest'
import { SCHEMA_VERSION } from '../src/lib/version'

test.each([1, 2, 3, 4])(
  'schema %i upgrades without changing existing identity or credential data',
  async (fromVersion) => {
    const target = new URL(process.env.TEST_DATABASE_URL || '')
    if (
      !/^\/[a-zA-Z0-9_]+_test$/.test(target.pathname) ||
      !['localhost', '127.0.0.1', 'postgres'].includes(target.hostname)
    )
      throw Error('A disposable local test database is required')
    const schema = 'upgrade_' + randomUUID().replaceAll('-', '')
    const db = new pg.Client({ connectionString: target.toString() })
    await db.connect()
    try {
      await db.query(`CREATE SCHEMA ${schema}`)
      await db.query(`SET search_path TO ${schema}, public`)
      const baseline = await readFile('migrations/0001_initial.sql', 'utf8')
      await db.query(baseline)
      await db.query(
        'CREATE TABLE schema_migrations(version integer PRIMARY KEY,name text NOT NULL,checksum text NOT NULL,applied_at timestamptz NOT NULL DEFAULT now())',
      )
      await db.query(
        'INSERT INTO schema_migrations(version,name,checksum) VALUES(1,$1,$2)',
        [
          '0001_initial.sql',
          createHash('sha256').update(baseline).digest('hex'),
        ],
      )
      if (fromVersion >= 2) {
        const activity = await readFile(
          'migrations/0002_agent_activity.sql',
          'utf8',
        )
        await db.query(activity)
        await db.query(
          'INSERT INTO schema_migrations(version,name,checksum) VALUES(2,$1,$2)',
          [
            '0002_agent_activity.sql',
            createHash('sha256').update(activity).digest('hex'),
          ],
        )
      }
      if (fromVersion >= 3) {
        const avatars = await readFile(
          'migrations/0003_agent_avatars.sql',
          'utf8',
        )
        await db.query(avatars)
        await db.query(
          'INSERT INTO schema_migrations(version,name,checksum) VALUES(3,$1,$2)',
          [
            '0003_agent_avatars.sql',
            createHash('sha256').update(avatars).digest('hex'),
          ],
        )
      }
      if (fromVersion >= 4) {
        const notifications = await readFile(
          'migrations/0004_notification_cursor.sql',
          'utf8',
        )
        await db.query(notifications)
        await db.query(
          'INSERT INTO schema_migrations(version,name,checksum) VALUES(4,$1,$2)',
          [
            '0004_notification_cursor.sql',
            createHash('sha256').update(notifications).digest('hex'),
          ],
        )
      }
      const owner = randomUUID(),
        agent = randomUUID()
      await db.query(
        "INSERT INTO ac_user(id,name,email) VALUES('upgrade-owner','Upgrade owner','upgrade@users.invalid')",
      )
      await db.query(
        "INSERT INTO actors(id,user_id,kind,name) VALUES($1,'upgrade-owner','human','Upgrade owner')",
        [owner],
      )
      await db.query('INSERT INTO instance(id,owner_id) VALUES(1,$1)', [owner])
      await db.query(
        "INSERT INTO actors(id,kind,name,owner_id,token_hash) VALUES($1,'agent','Existing agent',$2,'test-credential-hash')",
        [agent, owner],
      )
      const chat = randomUUID()
      await db.query(
        "INSERT INTO conversations(id,name,kind,created_by,owner_id,last_seq) VALUES($1,'Upgrade chat','group',$2,$2,3)",
        [chat, owner],
      )
      await db.query(
        "INSERT INTO conversation_members(conversation_id,actor_id,last_read_seq,read_ranges) VALUES($1,$2,1,'{[1,2),[3,4)}'),($1,$3,0,'{}')",
        [chat, owner, agent],
      )
      for (let seq = 1; seq <= 3; seq++)
        await db.query(
          "INSERT INTO messages(id,conversation_id,seq,sender_id,text,idempotency_key,request_hash) VALUES($1,$2,$3,$4,'Upgrade message',$5,'test-hash')",
          [randomUUID(), chat, seq, agent, randomUUID()],
        )
      const membersBefore = (
        await db.query('SELECT * FROM conversation_members ORDER BY actor_id')
      ).rows
      const messagesBefore = (
        await db.query('SELECT * FROM messages ORDER BY seq')
      ).rows
      const before = (await db.query('SELECT * FROM actors ORDER BY id')).rows
      const conversationsBefore = (
        await db.query('SELECT * FROM conversations ORDER BY id')
      ).rows
      target.searchParams.set('options', `-c search_path=${schema},public`)
      await promisify(execFile)(
        process.execPath,
        ['--import', 'tsx', 'scripts/migrate.ts'],
        {
          env: {
            ...process.env,
            DATABASE_URL: target.toString(),
            MIGRATION_DATABASE_URL: target.toString(),
          },
        },
      )
      const after = (await db.query('SELECT * FROM actors ORDER BY id')).rows
      expect(
        after.map(({ avatar_id, avatar_sha256, avatar_bytes, ...row }) => {
          expect([avatar_id, avatar_sha256, avatar_bytes]).toEqual([
            null,
            null,
            null,
          ])
          if (fromVersion === 1) {
            expect(row.last_active_at).toBeNull()
            delete row.last_active_at
          }
          return fromVersion >= 3
            ? { ...row, avatar_id, avatar_sha256, avatar_bytes }
            : row
        }),
      ).toEqual(before)
      expect(
        (
          await db.query('SELECT * FROM conversation_members ORDER BY actor_id')
        ).rows.map(({ dismissed_through_seq, ...row }) => {
          expect(dismissed_through_seq).toBe('0')
          return fromVersion >= 4 ? { ...row, dismissed_through_seq } : row
        }),
      ).toEqual(membersBefore)
      expect(
        (await db.query('SELECT * FROM messages ORDER BY seq')).rows,
      ).toEqual(messagesBefore)
      expect(
        (await db.query('SELECT * FROM conversations ORDER BY id')).rows.map(
          ({ creation_key, creation_hash, ...row }) => {
            expect([creation_key, creation_hash]).toEqual([null, null])
            return row
          },
        ),
      ).toEqual(conversationsBefore)
      expect(
        (await db.query('SELECT max(version) FROM schema_migrations')).rows[0]
          .max,
      ).toBe(SCHEMA_VERSION)
    } finally {
      await db.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`)
      await db.end()
    }
  },
)
