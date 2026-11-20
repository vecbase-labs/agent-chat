import { spawnSync } from 'node:child_process'
import {
  mkdtempSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { afterEach, expect, test } from 'vitest'
import { APP_VERSION } from '../src/lib/version'

const fixtures: Array<string> = []
const readmes = {
  'README.md': 'Version: ',
  'README.zh-CN.md': '版本：',
  'README.ja.md': 'バージョン：',
  'README.ar.md': 'الإصدار: ',
}

function fixture() {
  const cwd = mkdtempSync(join(tmpdir(), 'agent-chat-release-'))
  fixtures.push(cwd)
  mkdirSync(join(cwd, 'src/lib'), { recursive: true })
  mkdirSync(join(cwd, 'public'))
  const files = {
    'package.json': JSON.stringify({ version: APP_VERSION }),
    'src/lib/version.ts': `export const APP_VERSION = '${APP_VERSION}'\n`,
    'public/agent-chat.mjs': `const VERSION = '${APP_VERSION}'\n`,
    'compose.yaml': `image: agent-chat:${APP_VERSION}\n`,
    'CHANGELOG.md': `## ${APP_VERSION}\n`,
    ...Object.fromEntries(
      Object.entries(readmes).map(([path, label]) => [
        path,
        `**${label}${APP_VERSION} · Apache-2.0**\n\nNode.js 22.14+\n`,
      ]),
    ),
  }
  for (const [path, content] of Object.entries(files))
    writeFileSync(join(cwd, path), content)
  return cwd
}

afterEach(() => {
  for (const path of fixtures.splice(0))
    rmSync(path, { recursive: true, force: true })
})

test('version updates preserve translated labels and runtime requirements', () => {
  const cwd = fixture()
  const result = spawnSync(
    process.execPath,
    [resolve('scripts/version.mjs'), '9.8.7'],
    { cwd, encoding: 'utf8' },
  )
  expect(result.status, result.stderr).toBe(0)
  for (const [path, label] of Object.entries(readmes)) {
    const content = readFileSync(join(cwd, path), 'utf8')
    expect(content).toContain(`**${label}9.8.7 · Apache-2.0**`)
    expect(content).toContain('Node.js 22.14+')
  }
  expect(
    JSON.parse(readFileSync(join(cwd, 'package.json'), 'utf8')).version,
  ).toBe('9.8.7')
})

test('a missing translated version stops the update before any files change', () => {
  const cwd = fixture()
  writeFileSync(join(cwd, 'README.ja.md'), '# Agent Chat\n')
  const result = spawnSync(
    process.execPath,
    [resolve('scripts/version.mjs'), '9.8.7'],
    { cwd, encoding: 'utf8' },
  )
  expect(result.status).not.toBe(0)
  expect(result.stderr).toContain(
    'Release version line is missing in README.ja.md',
  )
  expect(
    JSON.parse(readFileSync(join(cwd, 'package.json'), 'utf8')).version,
  ).toBe(APP_VERSION)
  expect(readFileSync(join(cwd, 'README.md'), 'utf8')).toContain(APP_VERSION)
})

test('release checks reject a stale translated README', () => {
  const cwd = fixture()
  writeFileSync(
    join(cwd, 'README.ja.md'),
    '**バージョン：0.0.0 · Apache-2.0**\n',
  )
  const result = spawnSync(
    process.execPath,
    [
      resolve('node_modules/tsx/dist/cli.mjs'),
      resolve('scripts/release-check.ts'),
    ],
    { cwd, encoding: 'utf8' },
  )
  expect(result.status).not.toBe(0)
  expect(result.stderr).toContain(
    `Release version in README.ja.md must be ${APP_VERSION}.`,
  )
})
