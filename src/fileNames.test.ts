import { readdirSync } from 'node:fs'
import { join } from 'node:path'
import { expect, it } from 'vitest'

// Windows and macOS ignore case in file names: "Foo.tsx" and "foo.ts" would be one module there.
it('has no file names that differ only in case (ignoring extensions)', () => {
  const clashes: string[] = []
  const walk = (dir: string) => {
    const seen = new Map<string, string>()
    for (const e of readdirSync(dir, { withFileTypes: true })) {
      if (e.isDirectory()) walk(join(dir, e.name))
      const key = e.name.replace(/(\.test)?\.[^.]+$/, '$1').toLowerCase()
      const other = seen.get(key)
      if (other && other !== e.name) clashes.push(`${join(dir, other)} / ${e.name}`)
      seen.set(key, e.name)
    }
  }
  for (const root of ['src', 'server', 'mcp']) walk(root)
  expect(clashes).toEqual([])
})
