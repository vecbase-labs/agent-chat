import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { readFile } from 'node:fs/promises'
import { APP_VERSION } from '../src/lib/version'

try {
  const packageJson = JSON.parse(await readFile('package.json', 'utf8'))
  const cli = await readFile('public/agent-chat.mjs', 'utf8')
  const compose = await readFile('compose.yaml', 'utf8')
  const changelog = await readFile('CHANGELOG.md', 'utf8')
  const readme = await readFile('README.md', 'utf8')
  if (
    packageJson.version !== APP_VERSION ||
    !cli.includes(`const VERSION = '${APP_VERSION}'`) ||
    !compose.includes(`agent-chat:${APP_VERSION}`) ||
    !changelog.includes(`## ${APP_VERSION}`) ||
    !readme.includes(`Version: ${APP_VERSION}`)
  )
    throw new Error('Release versions/changelog disagree.')
  const { stdout } = await promisify(execFile)('git', [
    'ls-files',
    '--cached',
    '--others',
    '--exclude-standard',
    '-z',
  ])
  const paths = [...new Set(stdout.split('\0').filter(Boolean))]
  const forbidden =
    /(^|\/)(\.env($|\.(?!example$))|data\/|backups\/|\.?design\/|node_modules\/|\.output\/)|\.(dump|pem|key|log)$/
  const privateMaterial =
    /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----|\bac_[A-Za-z0-9_-]{40,}\b|\b(?:AKIA|ASIA)[A-Z0-9]{16}\b|\bgh[pousr]_[A-Za-z0-9]{30,}\b/g
  for (const path of paths) {
    if (forbidden.test(path))
      throw new Error(`Private/generated path is publishable: ${path}`)
    if (privateMaterial.test(await readFile(path, 'utf8')))
      throw new Error(
        `Possible credential in ${path}. Inspect privately before committing.`,
      )
    privateMaterial.lastIndex = 0
  }
  console.log(
    `Release ${APP_VERSION}: versions match; checked ${paths.length} publishable files for prohibited paths and common credential formats. This does not replace a secret scanner or review.`,
  )
} catch (error) {
  console.error(error instanceof Error ? error.message : 'Release check failed')
  process.exitCode = 1
}
