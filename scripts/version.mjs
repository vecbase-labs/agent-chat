import { readFile, readdir, writeFile } from 'node:fs/promises'

const version = process.argv[2]
if (!/^\d+\.\d+\.\d+$/.test(version || ''))
  throw new Error('Usage: pnpm release:version X.Y.Z')
const readmePattern = /^(\*\*[^*\n]*?)(\d+\.\d+\.\d+)([^*\n]*Apache-2\.0\*\*)$/m
const readmePaths = (await readdir('.')).filter((path) =>
  /^README(?:\.[\w-]+)?\.md$/.test(path),
)
if (!readmePaths.includes('README.md')) throw new Error('README.md is missing.')
const readmeUpdates = await Promise.all(
  readmePaths.map(async (path) => {
    const content = await readFile(path, 'utf8')
    if (!readmePattern.test(content))
      throw new Error(`Release version line is missing in ${path}.`)
    return [
      path,
      content.replace(
        readmePattern,
        (_, prefix, _previousVersion, suffix) => `${prefix}${version}${suffix}`,
      ),
    ]
  }),
)
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
])
  await writeFile(
    path,
    (await readFile(path, 'utf8')).replace(pattern, replacement),
  )
for (const [path, content] of readmeUpdates) await writeFile(path, content)
console.log(
  `Version set to ${version}. Add the changelog and upgrade notes, then run pnpm release:check. Schema and API versions are changed separately, only when needed.`,
)
