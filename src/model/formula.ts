/**
 * Formulas for database fields: a small, safe expression language (parsed here, never run as
 * code). Fields are written in braces, `{Price} * {Qty}`; text in quotes; dates are YYYY-MM-DD.
 *
 *   arithmetic   + - * / %      (+ joins text: {First} + " " + {Last})
 *   comparing    = != < > <= >=
 *   logic        and  or  not
 *   functions    if(test, then, else)  empty(x)  round(x, places)  floor(x)  ceil(x)  abs(x)
 *                min(a, b, …)  max(a, b, …)  len(text)  upper(text)  lower(text)  contains(text, part)
 *                today()  daysUntil(date)  days(from, to)  addDays(date, n)  year(date)  month(date)
 */

export type FormulaValue = number | string | boolean | null

export class FormulaError extends Error {}

type Node =
  | { t: 'num'; v: number }
  | { t: 'str'; v: string }
  | { t: 'bool'; v: boolean }
  | { t: 'field'; name: string }
  | { t: 'call'; fn: string; args: Node[] }
  | { t: 'un'; op: '-' | 'not'; a: Node }
  | { t: 'bin'; op: string; a: Node; z: Node }

type Tok = { k: 'num' | 'str' | 'field' | 'id' | 'op'; v: string }

function lex(src: string): Tok[] {
  const out: Tok[] = []
  let i = 0
  while (i < src.length) {
    const c = src[i]
    if (/\s/.test(c)) {
      i++
      continue
    }
    if (/[0-9.]/.test(c)) {
      const m = /^\d*\.?\d+(?:e[+-]?\d+)?/i.exec(src.slice(i))
      if (!m) throw new FormulaError(`Unexpected "${c}"`)
      out.push({ k: 'num', v: m[0] })
      i += m[0].length
      continue
    }
    if (c === '"' || c === "'" || c === '“' || c === '‘') {
      const close = c === '“' ? '”' : c === '‘' ? '’' : c
      let j = i + 1
      let s = ''
      while (j < src.length && src[j] !== close) {
        if (src[j] === '\\' && j + 1 < src.length) j++
        s += src[j++]
      }
      if (j >= src.length) throw new FormulaError('A quote is never closed')
      out.push({ k: 'str', v: s })
      i = j + 1
      continue
    }
    if (c === '{') {
      const j = src.indexOf('}', i)
      if (j < 0) throw new FormulaError('A { is never closed')
      out.push({ k: 'field', v: src.slice(i + 1, j).trim() })
      i = j + 1
      continue
    }
    if (/[A-Za-z_]/.test(c)) {
      const m = /^[A-Za-z_][A-Za-z0-9_]*/.exec(src.slice(i))!
      out.push({ k: 'id', v: m[0] })
      i += m[0].length
      continue
    }
    const two = src.slice(i, i + 2)
    if (['<=', '>=', '!=', '<>', '==', '&&', '||'].includes(two)) {
      out.push({ k: 'op', v: two })
      i += 2
      continue
    }
    if ('+-*/%()<>=!,'.includes(c)) {
      out.push({ k: 'op', v: c })
      i++
      continue
    }
    throw new FormulaError(`Unexpected "${c}"`)
  }
  return out
}

function parse(src: string): Node {
  const toks = lex(src)
  let p = 0
  const peek = () => toks[p]
  const isOp = (...ops: string[]) => peek()?.k === 'op' && ops.includes(peek()!.v)
  const isWord = (...w: string[]) => peek()?.k === 'id' && w.includes(peek()!.v.toLowerCase())
  const expect = (v: string) => {
    if (!isOp(v)) throw new FormulaError(`Expected "${v}"${peek() ? ` before "${peek()!.v}"` : ' at the end'}`)
    p++
  }
  const or = (): Node => {
    let a = and()
    while (isWord('or') || isOp('||')) {
      p++
      a = { t: 'bin', op: 'or', a, z: and() }
    }
    return a
  }
  const and = (): Node => {
    let a = not()
    while (isWord('and') || isOp('&&')) {
      p++
      a = { t: 'bin', op: 'and', a, z: not() }
    }
    return a
  }
  const not = (): Node => {
    if (isWord('not') || isOp('!')) {
      p++
      return { t: 'un', op: 'not', a: not() }
    }
    return cmp()
  }
  const cmp = (): Node => {
    const a = add()
    if (isOp('=', '==', '!=', '<>', '<', '>', '<=', '>=')) {
      const op = toks[p++].v
      return { t: 'bin', op: op === '==' ? '=' : op === '<>' ? '!=' : op, a, z: add() }
    }
    return a
  }
  const add = (): Node => {
    let a = mul()
    while (isOp('+', '-')) {
      const op = toks[p++].v
      a = { t: 'bin', op, a, z: mul() }
    }
    return a
  }
  const mul = (): Node => {
    let a = unary()
    while (isOp('*', '/', '%')) {
      const op = toks[p++].v
      a = { t: 'bin', op, a, z: unary() }
    }
    return a
  }
  const unary = (): Node => {
    if (isOp('-')) {
      p++
      return { t: 'un', op: '-', a: unary() }
    }
    return primary()
  }
  const primary = (): Node => {
    const tok = peek()
    if (!tok) throw new FormulaError('The formula ends too soon')
    p++
    if (tok.k === 'num') return { t: 'num', v: Number(tok.v) }
    if (tok.k === 'str') return { t: 'str', v: tok.v }
    if (tok.k === 'field') return { t: 'field', name: tok.v }
    if (tok.k === 'id') {
      const w = tok.v.toLowerCase()
      if (w === 'true' || w === 'false') return { t: 'bool', v: w === 'true' }
      if (!isOp('(')) throw new FormulaError(`"${tok.v}" isn't known: write fields in braces, like {${tok.v}}`)
      p++
      const args: Node[] = []
      if (!isOp(')')) {
        args.push(or())
        while (isOp(',')) {
          p++
          args.push(or())
        }
      }
      expect(')')
      if (!(w in FUNCTIONS)) throw new FormulaError(`There's no function "${tok.v}"`)
      return { t: 'call', fn: w, args }
    }
    if (tok.v === '(') {
      const e = or()
      expect(')')
      return e
    }
    throw new FormulaError(`Unexpected "${tok.v}"`)
  }
  if (!toks.length) throw new FormulaError('The formula is empty')
  const tree = or()
  if (p < toks.length) throw new FormulaError(`Unexpected "${toks[p].v}"`)
  return tree
}

const ISO = /^\d{4}-\d{2}-\d{2}$/
const dayOf = (v: FormulaValue): number | null => {
  if (typeof v !== 'string' || !ISO.test(v)) return null
  const t = Date.parse(`${v}T00:00:00Z`)
  return Number.isNaN(t) ? null : Math.round(t / 86_400_000)
}
const isoOf = (day: number) => new Date(day * 86_400_000).toISOString().slice(0, 10)
const todayOf = (now: Date) => Math.round(Date.UTC(now.getFullYear(), now.getMonth(), now.getDate()) / 86_400_000)

const num = (v: FormulaValue): number => {
  if (typeof v === 'number') return v
  if (typeof v === 'boolean') return v ? 1 : 0
  if (v === null || v === '') return 0
  const n = Number(String(v).replace(/[,\s]/g, ''))
  if (Number.isNaN(n)) throw new FormulaError(`"${v}" isn't a number`)
  return n
}
const text = (v: FormulaValue): string => (v === null ? '' : typeof v === 'number' ? String(Math.round(v * 1e6) / 1e6) : String(v))
const truthy = (v: FormulaValue) => v !== null && v !== '' && v !== 0 && v !== false

type Fn = (args: FormulaValue[], now: Date) => FormulaValue
const FUNCTIONS: Record<string, Fn> = {
  if: (a) => (truthy(a[0]) ? (a[1] ?? null) : (a[2] ?? null)),
  empty: (a) => a[0] === null || a[0] === '',
  round: (a) => {
    const f = 10 ** Math.max(0, Math.min(10, Math.round(num(a[1] ?? 0))))
    return Math.round(num(a[0]) * f) / f
  },
  floor: (a) => Math.floor(num(a[0])),
  ceil: (a) => Math.ceil(num(a[0])),
  abs: (a) => Math.abs(num(a[0])),
  min: (a) => (a.length ? Math.min(...a.map(num)) : null),
  max: (a) => (a.length ? Math.max(...a.map(num)) : null),
  len: (a) => text(a[0] ?? null).length,
  upper: (a) => text(a[0] ?? null).toUpperCase(),
  lower: (a) => text(a[0] ?? null).toLowerCase(),
  contains: (a) => text(a[0] ?? null).toLowerCase().includes(text(a[1] ?? null).toLowerCase()),
  today: (_a, now) => isoOf(todayOf(now)),
  daysuntil: (a, now) => {
    const d = dayOf(a[0] ?? null)
    return d === null ? null : d - todayOf(now)
  },
  days: (a) => {
    const [x, z] = [dayOf(a[0] ?? null), dayOf(a[1] ?? null)]
    return x === null || z === null ? null : z - x
  },
  adddays: (a) => {
    const d = dayOf(a[0] ?? null)
    return d === null ? null : isoOf(d + Math.round(num(a[1] ?? 0)))
  },
  year: (a) => {
    const d = dayOf(a[0] ?? null)
    return d === null ? null : Number(isoOf(d).slice(0, 4))
  },
  month: (a) => {
    const d = dayOf(a[0] ?? null)
    return d === null ? null : Number(isoOf(d).slice(5, 7))
  },
}

function evaluate(n: Node, get: (name: string) => FormulaValue, now: Date): FormulaValue {
  switch (n.t) {
    case 'num':
    case 'str':
    case 'bool':
      return n.v
    case 'field':
      return get(n.name)
    case 'un': {
      const a = evaluate(n.a, get, now)
      return n.op === '-' ? -num(a) : !truthy(a)
    }
    case 'call':
      // if() only works out the branch it takes.
      if (n.fn === 'if') return truthy(evaluate(n.args[0] ?? { t: 'bool', v: false }, get, now)) ? (n.args[1] ? evaluate(n.args[1], get, now) : null) : n.args[2] ? evaluate(n.args[2], get, now) : null
      return FUNCTIONS[n.fn](
        n.args.map((x) => evaluate(x, get, now)),
        now,
      )
    case 'bin': {
      if (n.op === 'and') return truthy(evaluate(n.a, get, now)) && truthy(evaluate(n.z, get, now))
      if (n.op === 'or') return truthy(evaluate(n.a, get, now)) || truthy(evaluate(n.z, get, now))
      const a = evaluate(n.a, get, now)
      const z = evaluate(n.z, get, now)
      switch (n.op) {
        case '+':
          return typeof a === 'string' || typeof z === 'string' ? text(a) + text(z) : num(a) + num(z)
        case '-': {
          // A date minus a date is days; a date minus a number is a date.
          const [da, dz] = [dayOf(a), dayOf(z)]
          if (da !== null && dz !== null) return da - dz
          if (da !== null) return isoOf(da - num(z))
          return num(a) - num(z)
        }
        case '*':
          return num(a) * num(z)
        case '/': {
          const d = num(z)
          return d === 0 ? null : num(a) / d
        }
        case '%': {
          const d = num(z)
          return d === 0 ? null : num(a) % d
        }
        default: {
          const both = typeof a === 'number' && typeof z === 'number'
          const c = both ? (a as number) - (z as number) : text(a).localeCompare(text(z), undefined, { numeric: true, sensitivity: 'base' })
          if (n.op === '=') return both ? c === 0 : text(a).toLowerCase() === text(z).toLowerCase()
          if (n.op === '!=') return both ? c !== 0 : text(a).toLowerCase() !== text(z).toLowerCase()
          if (n.op === '<') return c < 0
          if (n.op === '>') return c > 0
          if (n.op === '<=') return c <= 0
          return c >= 0
        }
      }
    }
  }
}

export interface Formula {
  /** The fields it reads, by name. */
  fields: string[]
  run(get: (name: string) => FormulaValue, now?: Date): FormulaValue
}

const cache = new Map<string, Formula | FormulaError>()

/** A formula ready to run, or why it can't be read. */
export function compile(src: string): Formula | FormulaError {
  const hit = cache.get(src)
  if (hit) return hit
  let out: Formula | FormulaError
  try {
    const tree = parse(src)
    const fields: string[] = []
    const walk = (n: Node) => {
      if (n.t === 'field') fields.push(n.name)
      if (n.t === 'call') n.args.forEach(walk)
      if (n.t === 'un') walk(n.a)
      if (n.t === 'bin') {
        walk(n.a)
        walk(n.z)
      }
    }
    walk(tree)
    out = { fields: [...new Set(fields)], run: (get, now = new Date()) => evaluate(tree, get, now) }
  } catch (err) {
    out = err instanceof FormulaError ? err : new FormulaError(String(err))
  }
  if (cache.size > 500) cache.clear()
  cache.set(src, out)
  return out
}
