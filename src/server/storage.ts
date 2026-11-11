import { mkdir, readFile, unlink, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { getEnv } from './env'
import { requestRuntime } from './runtime'
import type { FileStorage } from './runtime'

export function fileStorage(): FileStorage {
  const runtime = requestRuntime.getStore()
  if (runtime) return runtime.files
  const directory = getEnv().filesDir
  return {
    async put(id, content) {
      await mkdir(directory, { recursive: true, mode: 0o700 })
      await writeFile(join(directory, id), content, { flag: 'wx', mode: 0o600 })
    },
    async get(id) {
      try {
        return await readFile(join(directory, id))
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null
        throw error
      }
    },
    async delete(id) {
      await unlink(join(directory, id))
    },
  }
}
