import { randomBytes } from 'node:crypto'
import { mkdir, writeFile } from 'node:fs/promises'

const random = () => randomBytes(32).toString('hex')
const owner = random(),
  app = random()
const content = `# Generated locally. Never commit this file.\nAPP_URL=http://localhost:3100\nPORT=3100\nPOSTGRES_PORT=55432\nPOSTGRES_PASSWORD=${owner}\nAPP_DB_PASSWORD=${app}\nDATABASE_URL=postgresql://agent_chat_app:${app}@127.0.0.1:55432/agent_chat\nMIGRATION_DATABASE_URL=postgresql://agent_chat:${owner}@127.0.0.1:55432/agent_chat\nBETTER_AUTH_SECRET=${random()}\nSETUP_TOKEN=${random()}\nALLOW_LOCAL_SETUP=true\nFILES_DIR=./data/files\nLOCAL_UID=${process.getuid?.() || 1000}\nLOCAL_GID=${process.getgid?.() || 1000}\n`
try {
  await writeFile('.env', content, { flag: 'wx', mode: 0o600 })
  await mkdir('data/files', { recursive: true, mode: 0o700 })
  console.log(
    'Created private .env (0600). Existing files are never overwritten. See README.md for PostgreSQL and first-run setup.',
  )
} catch (error) {
  console.error(
    error.code === 'EEXIST'
      ? '.env already exists; left unchanged.'
      : 'Could not create .env.',
  )
  process.exitCode = 1
}
