import { expect, test } from 'vitest'
import { getEnv } from '../src/server/env'
import { getPool } from '../src/server/db'
import { getAuth } from '../src/server/auth'
import { requestRuntime } from '../src/server/runtime'
import { fileStorage } from '../src/server/storage'
import type { RequestRuntime } from '../src/server/runtime'

function runtime(name: string): RequestRuntime {
  const objects = new Map<string, Uint8Array>()
  return {
    variables: {
      APP_URL: `https://${name}.example.com`,
      BETTER_AUTH_SECRET: `${name}-test-secret-with-at-least-32-characters`,
    },
    databaseUrl: 'postgresql://test:test@127.0.0.1:1/unused_test',
    memo: new Map(),
    files: {
      put: async (id, bytes) => {
        objects.set(id, bytes)
      },
      get: async (id) => objects.get(id) ?? null,
      delete: async (id) => {
        objects.delete(id)
      },
    },
  }
}

test('concurrent Worker scopes isolate origin, sockets, authentication, and storage', async () => {
  const first = runtime('first'),
    second = runtime('second')
  const exercise = (scope: RequestRuntime, value: number) =>
    requestRuntime.run(scope, async () => {
      const auth = getAuth(),
        pool = getPool()
      await fileStorage().put('same-key', new Uint8Array([value]))
      await new Promise((resolve) => setTimeout(resolve, 5))
      expect(getEnv().appUrl).toBe(scope.variables.APP_URL)
      expect(getAuth()).toBe(auth)
      expect(getPool()).toBe(pool)
      expect(await fileStorage().get('same-key')).toEqual(
        new Uint8Array([value]),
      )
      return { auth, pool }
    })
  const [a, b] = await Promise.all([exercise(first, 1), exercise(second, 2)])
  expect(a.auth).not.toBe(b.auth)
  expect(a.pool).not.toBe(b.pool)
  expect(requestRuntime.getStore()).toBeUndefined()
  await Promise.all([a.pool.end(), b.pool.end()])
})
