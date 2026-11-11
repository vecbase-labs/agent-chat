import handler from '@tanstack/react-start/server-entry'
import type {
  ExecutionContext,
  Hyperdrive,
  R2Bucket,
} from '@cloudflare/workers-types'
import { requestRuntime } from './server/runtime'
import type { RequestRuntime } from './server/runtime'

interface WorkerEnv {
  APP_URL: string
  BETTER_AUTH_SECRET: string
  SETUP_TOKEN?: string
  MAX_FILE_BYTES?: string
  MAINTENANCE?: string
  DATABASE: Hyperdrive
  FILES: R2Bucket
}

export default {
  async fetch(request: Request, env: WorkerEnv, ctx: ExecutionContext) {
    if (env.MAINTENANCE === 'true')
      return new Response(
        'Agent Chat is temporarily unavailable for maintenance.',
        {
          status: 503,
          headers: { 'Retry-After': '60', 'Cache-Control': 'no-store' },
        },
      )
    const runtime: RequestRuntime = {
      variables: {
        APP_URL: env.APP_URL,
        BETTER_AUTH_SECRET: env.BETTER_AUTH_SECRET,
        SETUP_TOKEN: env.SETUP_TOKEN,
        MAX_FILE_BYTES: env.MAX_FILE_BYTES,
      },
      databaseUrl: env.DATABASE.connectionString,
      memo: new Map(),
      files: {
        async put(id, content) {
          const saved = await env.FILES.put(id, new Uint8Array(content), {
            onlyIf: { etagDoesNotMatch: '*' },
            httpMetadata: { contentType: 'application/octet-stream' },
          })
          if (!saved) throw new Error('Attachment already exists.')
        },
        async get(id) {
          const object = await env.FILES.get(id)
          return object ? new Uint8Array(await object.arrayBuffer()) : null
        },
        async delete(id) {
          await env.FILES.delete(id)
        },
      },
    }
    return requestRuntime.run(runtime, async () => {
      try {
        const response = await handler.fetch(request)
        const headers = new Headers(response.headers)
        headers.set('X-Content-Type-Options', 'nosniff')
        headers.set('X-Frame-Options', 'DENY')
        headers.set('Referrer-Policy', 'no-referrer')
        headers.set(
          'Permissions-Policy',
          'camera=(), microphone=(), geolocation=()',
        )
        headers.set(
          'Content-Security-Policy',
          "frame-ancestors 'none'; object-src 'none'; base-uri 'self'",
        )
        headers.set('Strict-Transport-Security', 'max-age=31536000')
        return new Response(response.body, { status: response.status, headers })
      } finally {
        if (runtime.pool) ctx.waitUntil(runtime.pool.end())
      }
    })
  },
}
