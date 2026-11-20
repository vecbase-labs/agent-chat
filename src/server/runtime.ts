import { AsyncLocalStorage } from 'node:async_hooks'
import type { Pool } from 'pg'

export interface FileStorage {
  put: (id: string, content: Uint8Array) => Promise<void>
  get: (id: string) => Promise<Uint8Array | null>
  delete: (id: string) => Promise<void>
}

export interface RequestRuntime {
  variables: Record<string, string | undefined>
  databaseUrl: string
  files: FileStorage
  pool?: Pool
  memo: Map<string, unknown>
}

// Worker sockets and auth adapters belong to one request, never to an isolate.
export const requestRuntime = new AsyncLocalStorage<RequestRuntime>()
