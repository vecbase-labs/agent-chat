import { defineConfig } from 'vite'

import { tanstackStart } from '@tanstack/react-start/plugin/vite'

import viteReact from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { nitro } from 'nitro/vite'

const config = defineConfig({
  resolve: { tsconfigPaths: true },
  plugins: [
    nitro({
      rollupConfig: {
        external: [/^@sentry\//],
        onwarn(
          warning: { code?: string; message: string },
          warn: (warning: { code?: string; message: string }) => void,
        ) {
          // TanStack Start uses ordinary SSR, not React Server Components.
          // Dependency RSC directives have no meaning in this server bundle.
          if (
            warning.code === 'MODULE_LEVEL_DIRECTIVE' &&
            warning.message.includes('use client')
          )
            return
          warn(warning)
        },
      },
      routeRules: {
        '/**': {
          headers: {
            'X-Content-Type-Options': 'nosniff',
            'X-Frame-Options': 'DENY',
            'Referrer-Policy': 'no-referrer',
            'Permissions-Policy': 'camera=(), microphone=(), geolocation=()',
            'Content-Security-Policy':
              "frame-ancestors 'none'; object-src 'none'; base-uri 'self'",
          },
        },
      },
    }),
    tailwindcss(),
    tanstackStart(),
    viteReact(),
  ],
})

export default config
