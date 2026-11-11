import { createHash } from 'node:crypto'
import { readdir, readFile, writeFile } from 'node:fs/promises'
const directory = new URL('../migrations/', import.meta.url)
const manifest = []
for (const name of (await readdir(directory))
  .filter((name) => /^\d{4}_.+\.sql$/.test(name))
  .sort()) {
  manifest.push({
    version: Number(name.slice(0, 4)),
    name,
    checksum: createHash('sha256')
      .update(await readFile(new URL(name, directory)))
      .digest('hex'),
  })
}
const output = JSON.stringify(manifest, null, 2) + '\n'
const path = new URL('manifest.json', directory)
if (process.argv.includes('--check')) {
  if ((await readFile(path, 'utf8')) !== output)
    throw new Error(
      'Migration manifest is stale. Run pnpm db:manifest and review the migration changes.',
    )
} else await writeFile(path, output)
