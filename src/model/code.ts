/**
 * Code blocks: syntax colouring without a library. A small tokenizer knows the
 * shapes most languages share (comments, strings, numbers, keywords) and a few
 * languages' keywords; that's plenty for snippets on a whiteboard.
 */

export type Token = { t: 'kw' | 'str' | 'com' | 'num' | 'fn' | 'plain'; s: string }

interface Lang {
  label: string
  line?: string[]
  block?: [string, string][]
  keywords: string
}

const C_LIKE_BLOCK: [string, string][] = [['/*', '*/']]

export const LANGS: Record<string, Lang> = {
  javascript: {
    label: 'JavaScript',
    line: ['//'],
    block: C_LIKE_BLOCK,
    keywords:
      'async await break case catch class const continue default delete do else export extends false finally for from function if import in instanceof let new null of return static super switch this throw true try typeof undefined var void while yield',
  },
  typescript: {
    label: 'TypeScript',
    line: ['//'],
    block: C_LIKE_BLOCK,
    keywords:
      'abstract as async await boolean break case catch class const continue default delete do else enum export extends false finally for from function if implements import in instanceof interface keyof let new null number of private protected public readonly return static string super switch this throw true try type typeof undefined unknown var void while yield',
  },
  python: {
    label: 'Python',
    line: ['#'],
    keywords: 'and as assert async await break class continue def del elif else except False finally for from global if import in is lambda None nonlocal not or pass raise return self True try while with yield',
  },
  rust: {
    label: 'Rust',
    line: ['//'],
    block: C_LIKE_BLOCK,
    keywords: 'as async await break const continue crate else enum extern false fn for if impl in let loop match mod move mut pub ref return self Self static struct super trait true type unsafe use where while',
  },
  go: {
    label: 'Go',
    line: ['//'],
    block: C_LIKE_BLOCK,
    keywords: 'break case chan const continue default defer else fallthrough false for func go goto if import interface map nil package range return select struct switch true type var',
  },
  c: {
    label: 'C / C++ / Java / C#',
    line: ['//'],
    block: C_LIKE_BLOCK,
    keywords:
      'auto bool break case catch char class const continue default delete do double else enum extern false final float for if import int long namespace new null nullptr package private protected public return short signed static struct switch template this throw true try typedef union unsigned using var virtual void volatile while',
  },
  sql: {
    label: 'SQL',
    line: ['--'],
    block: C_LIKE_BLOCK,
    keywords:
      'add all alter and as asc between by case create delete desc distinct drop else end exists false from group having in index inner insert into is join key left like limit not null on or order outer primary references right select set table then true union update values when where with',
  },
  shell: {
    label: 'Shell',
    line: ['#'],
    keywords: 'case do done echo elif else esac exit export fi for function if in local return set then until while',
  },
  css: { label: 'CSS', block: C_LIKE_BLOCK, keywords: 'important inherit initial none auto' },
  json: { label: 'JSON', keywords: 'true false null' },
  text: { label: 'Plain text', keywords: '' },
}

const ALIASES: Record<string, string> = {
  js: 'javascript',
  jsx: 'javascript',
  ts: 'typescript',
  tsx: 'typescript',
  py: 'python',
  rs: 'rust',
  golang: 'go',
  cpp: 'c',
  'c++': 'c',
  java: 'c',
  csharp: 'c',
  cs: 'c',
  sh: 'shell',
  bash: 'shell',
  zsh: 'shell',
  powershell: 'shell',
  ps1: 'shell',
  plain: 'text',
  txt: 'text',
}

/** The language id for a name or file extension, if known. */
/** Whether `id` is one of our languages (own keys only: never "constructor" and friends). */
export const isLang = (id: unknown): id is string => typeof id === 'string' && Object.hasOwn(LANGS, id)

export function langId(name: unknown): string | undefined {
  if (typeof name !== 'string' || !name) return undefined
  const k = name.trim().toLowerCase()
  if (isLang(k)) return k
  return Object.hasOwn(ALIASES, k) ? ALIASES[k] : undefined
}

/** A best guess at the language of `code`, from tell-tale words. */
export function guessLang(code: string): string {
  const t = code.trim()
  if (/^[[{]/.test(t)) {
    try {
      JSON.parse(t)
      return 'json'
    } catch {
      // Not JSON after all.
    }
  }
  if (/^\s*(select|insert|update|delete|create)\b[\s\S]*\b(from|into|set|table)\b/i.test(t)) return 'sql'
  if (/\bfn\s+\w+\s*\(|\blet\s+mut\b|\bimpl\b|::/.test(t)) return 'rust'
  if (/^\s*(def|class)\s+\w+.*:\s*$/m.test(t) || /^\s*(import|from)\s+\w+/m.test(t) && !/[;{}]/.test(t)) return 'python'
  if (/\bfunc\s+\w*\s*\(|\bpackage\s+\w+/.test(t)) return 'go'
  if (/\b(interface|type)\s+\w+\s*[={]|:\s*(string|number|boolean)\b/.test(t)) return 'typescript'
  if (/\b(const|let|function|=>|console\.)/.test(t)) return 'javascript'
  if (/#include|\b(public|private)\s+(static\s+)?\w+|\bint\s+main\b/.test(t)) return 'c'
  if (/^#!\/bin\/(ba)?sh|^\s*(echo|cd|ls|export|sudo|npm|git)\s/m.test(t)) return 'shell'
  if (/^[\w.#:-]+\s*\{[^}]*:[^}]*\}/m.test(t)) return 'css'
  return 'text'
}

/** Splits code into coloured tokens. Never throws; unknown text is plain. */
export function tokenize(code: string, lang: string): Token[] {
  if (typeof code !== 'string') return []
  const L = isLang(lang) ? LANGS[lang] : LANGS.text
  if (lang === 'text') return [{ t: 'plain', s: code }]
  const words = new Set(L.keywords.split(' ').filter(Boolean))
  const caseless = lang === 'sql'
  const out: Token[] = []
  const push = (t: Token['t'], s: string) => {
    const last = out[out.length - 1]
    if (last && last.t === t && t === 'plain') last.s += s
    else out.push({ t, s })
  }
  let k = 0
  while (k < code.length) {
    const rest = code.slice(k)
    const line = L.line?.find((m) => rest.startsWith(m))
    if (line) {
      const end = code.indexOf('\n', k)
      const stop = end < 0 ? code.length : end
      push('com', code.slice(k, stop))
      k = stop
      continue
    }
    const block = L.block?.find(([open]) => rest.startsWith(open))
    if (block) {
      const end = code.indexOf(block[1], k + block[0].length)
      const stop = end < 0 ? code.length : end + block[1].length
      push('com', code.slice(k, stop))
      k = stop
      continue
    }
    const q = code[k]
    if (q === '"' || q === "'" || q === '`') {
      let j = k + 1
      while (j < code.length && code[j] !== q && !(q !== '`' && code[j] === '\n')) j += code[j] === '\\' ? 2 : 1
      push('str', code.slice(k, Math.min(code.length, j + 1)))
      k = Math.min(code.length, j + 1)
      continue
    }
    const num = /^(?:0x[\da-f]+|\d[\d_]*(?:\.\d+)?(?:e[+-]?\d+)?)/i.exec(rest)
    if (num && !/[\w$]/.test(code[k - 1] ?? '')) {
      push('num', num[0])
      k += num[0].length
      continue
    }
    const word = /^[A-Za-z_$][\w$]*/.exec(rest)
    if (word) {
      const w = word[0]
      if (words.has(caseless ? w.toLowerCase() : w)) push('kw', w)
      else if (/^\s*\(/.test(code.slice(k + w.length))) push('fn', w)
      else push('plain', w)
      k += w.length
      continue
    }
    push('plain', q)
    k++
  }
  return out
}

/** A fenced block (```lang … ```) pasted from a chat or Markdown: its language and code. */
export function fencedCode(text: string): { lang: string; code: string } | null {
  const m = /^\s*```([\w+#-]*)[^\n]*\n([\s\S]*?)\n?```\s*$/.exec(text)
  if (!m) return null
  return { lang: langId(m[1]) ?? guessLang(m[2]), code: m[2] }
}

/** A good size for a block showing `code` (a loop, not a spread: pasted code can be huge). */
export function codeSize(code: string): { w: number; h: number } {
  let longest = 0
  let lines = 1
  let run = 0
  for (let k = 0; k < code.length; k++) {
    if (code[k] === '\n') {
      lines++
      run = 0
    } else if (++run > longest) longest = run
  }
  return { w: Math.min(900, Math.max(360, 60 + longest * 8.6)), h: Math.min(700, Math.max(160, 60 + lines * 21)) }
}
