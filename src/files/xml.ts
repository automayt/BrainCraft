/**
 * A small XML reader for the documents inside Word, PowerPoint and Excel files: elements with
 * their attributes and children, text with entities decoded. No namespaces resolved (names keep
 * their prefix, as in `w:p`), no DTDs. Works the same in the browser and in tests.
 */

export interface XmlNode {
  name: string
  attrs: Record<string, string>
  children: (XmlNode | string)[]
}

const ENTITY: Record<string, string> = { lt: '<', gt: '>', amp: '&', quot: '"', apos: "'" }

export function decodeEntities(s: string): string {
  if (!s.includes('&')) return s
  return s.replace(/&(#x[0-9a-f]+|#\d+|\w+);/gi, (m, e: string) => {
    if (e[0] === '#') {
      const code = e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10)
      return Number.isFinite(code) && code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : m
    }
    return ENTITY[e] ?? m
  })
}

/** The document's root element (a synthetic one holding everything if there are several). */
export function parseXml(src: string): XmlNode {
  const root: XmlNode = { name: '#root', attrs: {}, children: [] }
  const stack: XmlNode[] = [root]
  let i = 0
  const n = src.length
  while (i < n) {
    const lt = src.indexOf('<', i)
    if (lt < 0) {
      const t = src.slice(i)
      if (t) stack[stack.length - 1].children.push(decodeEntities(t))
      break
    }
    if (lt > i) stack[stack.length - 1].children.push(decodeEntities(src.slice(i, lt)))
    if (src.startsWith('<!--', lt)) {
      const e = src.indexOf('-->', lt + 4)
      i = e < 0 ? n : e + 3
      continue
    }
    if (src.startsWith('<![CDATA[', lt)) {
      const e = src.indexOf(']]>', lt + 9)
      stack[stack.length - 1].children.push(src.slice(lt + 9, e < 0 ? n : e))
      i = e < 0 ? n : e + 3
      continue
    }
    if (src[lt + 1] === '?' || src[lt + 1] === '!') {
      const e = src.indexOf('>', lt + 2)
      i = e < 0 ? n : e + 1
      continue
    }
    const gt = src.indexOf('>', lt + 1)
    if (gt < 0) break
    const tag = src.slice(lt + 1, gt)
    i = gt + 1
    if (tag[0] === '/') {
      const name = tag.slice(1).trim()
      // Close up to the matching element (a stray close tag is ignored).
      for (let k = stack.length - 1; k > 0; k--) {
        if (stack[k].name === name) {
          stack.length = k
          break
        }
      }
      continue
    }
    const selfClosing = tag.endsWith('/')
    const body = selfClosing ? tag.slice(0, -1) : tag
    const m = /^([^\s/>]+)/.exec(body)
    if (!m) continue
    const node: XmlNode = { name: m[1], attrs: {}, children: [] }
    for (const a of body.slice(m[1].length).matchAll(/([^\s=]+)\s*=\s*("([^"]*)"|'([^']*)')/g)) node.attrs[a[1]] = decodeEntities(a[3] ?? a[4] ?? '')
    stack[stack.length - 1].children.push(node)
    if (!selfClosing) stack.push(node)
  }
  const elements = root.children.filter((c): c is XmlNode => typeof c !== 'string')
  return elements.length === 1 ? elements[0] : root
}

/** Child elements called `name` (any prefix when `name` has none, e.g. "p" matches "w:p"). */
export function kids(node: XmlNode, name?: string): XmlNode[] {
  const out: XmlNode[] = []
  for (const c of node.children) if (typeof c !== 'string' && (!name || nameIs(c, name))) out.push(c)
  return out
}

export const nameIs = (node: XmlNode, name: string) => node.name === name || node.name.endsWith(`:${name}`)

/** The first descendant called `name`, depth first. */
export function find(node: XmlNode, name: string): XmlNode | null {
  for (const c of node.children) {
    if (typeof c === 'string') continue
    if (nameIs(c, name)) return c
    const deeper = find(c, name)
    if (deeper) return deeper
  }
  return null
}

/** Every descendant called `name`, in document order. */
export function findAll(node: XmlNode, name: string, out: XmlNode[] = []): XmlNode[] {
  for (const c of node.children) {
    if (typeof c === 'string') continue
    if (nameIs(c, name)) out.push(c)
    else findAll(c, name, out)
  }
  return out
}

/** An attribute by local name (`w:val` or `val`). */
export function attr(node: XmlNode | null | undefined, name: string): string | undefined {
  if (!node) return undefined
  if (name in node.attrs) return node.attrs[name]
  for (const [k, v] of Object.entries(node.attrs)) if (k.endsWith(`:${name}`)) return v
  return undefined
}

/** All the text inside an element. */
export function textOf(node: XmlNode): string {
  let s = ''
  for (const c of node.children) s += typeof c === 'string' ? c : textOf(c)
  return s
}
