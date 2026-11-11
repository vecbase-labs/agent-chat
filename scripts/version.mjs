import { readFile, writeFile } from 'node:fs/promises'

const version = process.argv[2]
if (!/^\d+\.\d+\.\d+$/.test(version || ''))
  throw new Error('Usage: pnpm release:version X.Y.Z')
const pkg = JSON.parse(await readFile('package.json', 'utf8'))
pkg.version = version
await writeFile('package.json', JSON.stringify(pkg, null, 2) + '\n')
for (const [path, pattern, replacement] of [
  ['src/lib/version.ts', /APP_VERSION = '[^']+'/, `APP_VERSION = '${version}'`],
  [
    'public/agent-chat.mjs',
    /const VERSION = '[^']+'/,
    `const VERSION = '${version}'`,
  ],
  ['compose.yaml', /agent-chat:\d+\.\d+\.\d+/g, `agent-chat:${version}`],
  ['README.md', /Version: \d+\.\d+\.\d+/, `Version: ${version}`],
])
  await writeFile(
    path,
    (await readFile(path, 'utf8')).replace(pattern, replacement),
  )
console.log(
  `Version set to ${version}. Add the changelog and upgrade notes, then run pnpm release:check. Schema and API versions are changed separately, only when needed.`,
)
