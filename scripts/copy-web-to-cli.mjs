import { cpSync, existsSync, rmSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const source = resolve(root, 'dist')
const destination = resolve(root, 'cli', 'web')

if (!existsSync(resolve(source, 'index.html'))) {
  throw new Error(`Production web build is missing ${resolve(source, 'index.html')}. Run pnpm build first.`)
}

rmSync(destination, { recursive: true, force: true })
cpSync(source, destination, { recursive: true })
