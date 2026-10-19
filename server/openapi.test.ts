import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { OPS } from '../src/api/ops'
import { OP_SCHEMAS } from '../src/api/opSchemas'
import { READ_ROUTES } from './boardReads'
import { docsPage, openApiSpec } from './openapi'

const keys = openApiSpec({ version: '1', accounts: false, ai: { anthropic: false, openai: true, command: false } })
const accounts = openApiSpec({ version: '1', accounts: true, ai: { anthropic: true, openai: false, command: true } })

/** Every "$ref" in a document. */
function refs(v: unknown, out: string[] = []): string[] {
  if (Array.isArray(v)) v.forEach((x) => refs(x, out))
  else if (v && typeof v === 'object') for (const [k, x] of Object.entries(v)) k === '$ref' ? out.push(String(x)) : refs(x, out)
  return out
}

/** Whether an operation only uses fields its schema knows, and has the ones it needs. */
function fits(op: Record<string, unknown>): string | null {
  const s = OP_SCHEMAS[op.op as keyof typeof OP_SCHEMAS]
  if (!s) return `unknown op ${String(op.op)}`
  for (const k of Object.keys(op)) if (k !== 'op' && !(k in s.properties)) return `${String(op.op)}: unknown field ${k}`
  for (const k of s.required ?? []) if (!(k in op)) return `${String(op.op)}: missing ${k}`
  return null
}

describe('the API description', () => {
  it('describes every operation, and nothing else', () => {
    expect(Object.keys(OP_SCHEMAS).sort()).toEqual([...OPS].sort())
    const schemas = keys.components.schemas as Record<string, unknown>
    for (const name of OPS) expect(schemas[`op.${name}`]).toMatchObject({ properties: { op: { const: name } } })
  })

  it('has every reference resolve', () => {
    for (const spec of [keys, accounts]) {
      const schemas = spec.components.schemas as Record<string, unknown>
      for (const r of refs(spec)) expect(schemas[r.replace('#/components/schemas/', '')], r).toBeDefined()
    }
  })

  it('describes the server as it runs: keys or accounts, and only the AI routes switched on', () => {
    expect(Object.keys(keys.paths)).not.toContain('/api/auth/login')
    expect(Object.keys(keys.paths)).toContain('/api/ai/openai/chat/completions')
    expect(Object.keys(keys.paths)).not.toContain('/api/ai/v1/messages')
    expect(keys.components.securitySchemes).toHaveProperty('boardKey')
    expect(Object.keys(accounts.paths)).toEqual(expect.arrayContaining(['/api/auth/login', '/api/admin/audit', '/api/boards/{id}/access', '/api/ai/v1/messages', '/api/ai/command']))
    expect(accounts.components.securitySchemes).toHaveProperty('apiToken')
    // Every board read route is described.
    for (const r of READ_ROUTES) expect(Object.keys(keys.paths).some((p) => p.startsWith(`/api/boards/{id}/${r}`))).toBe(true)
    // Operation ids are unique.
    const ids = Object.values(accounts.paths).flatMap((m) => Object.values(m).map((op) => op.operationId))
    expect(new Set(ids).size).toBe(ids.length)
  })

  it('agrees with the examples in docs/API.md', () => {
    const doc = readFileSync(new URL('../docs/API.md', import.meta.url), 'utf8')
    const blocks = [...doc.matchAll(/```json\n([\s\S]*?)```/g)].map((m) => JSON.parse(m[1]) as { ops: Record<string, unknown>[] })
    expect(blocks.length).toBeGreaterThan(1)
    for (const b of blocks) for (const op of b.ops) expect(fits(op)).toBeNull()
  })

  it('reads as a page, with every route and operation, safely escaped', () => {
    const html = docsPage(accounts)
    for (const name of OPS) expect(html).toContain(`id="op-${name}"`)
    expect(html).toContain('/api/boards/{id}/pages/{page}/history')
    expect(html).not.toMatch(/<script/i)
    // The "<key>" in the key-sharing description arrives escaped.
    expect(docsPage(keys)).toContain('Bearer &#60;key&#62;')
  })
})
