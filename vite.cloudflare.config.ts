import { defineConfig } from 'vite'
import { cloudflare } from '@cloudflare/vite-plugin'
import { tanstackStart } from '@tanstack/react-start/plugin/vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

export default defineConfig({
  resolve: { tsconfigPaths: true },
  plugins: [
    cloudflare({
      configPath:
        process.env.AGENT_CHAT_CLOUDFLARE_CONFIG || 'wrangler.example.jsonc',
      viteEnvironment: { name: 'ssr' },
    }),
    tailwindcss(),
    tanstackStart(),
    react(),
  ],
})
