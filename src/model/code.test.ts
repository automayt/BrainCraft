import { describe, expect, it } from 'vitest'
import { applyOps } from '../api/ops'
import { emptyBoard, getItem } from './board'
import { fencedCode, guessLang, langId, tokenize } from './code'
import { fakeMeasure } from './test-helpers'

const kinds = (code: string, lang: string) => tokenize(code, lang).filter((t) => t.t !== 'plain').map((t) => `${t.t}:${t.s}`)

describe('code blocks', () => {
  it('colours keywords, strings, comments, numbers and calls', () => {
    expect(kinds('const n = 42 // answer\nlog("hi")', 'javascript')).toEqual(['kw:const', 'num:42', 'com:// answer', 'fn:log', 'str:"hi"'])
    expect(kinds("def f(x):\n    return 'a' # done", 'python')).toEqual(['kw:def', 'fn:f', 'kw:return', "str:'a'", 'com:# done'])
    expect(kinds('SELECT name FROM cars WHERE year = 1970', 'sql')).toEqual(['kw:SELECT', 'kw:FROM', 'kw:WHERE', 'num:1970'])
    expect(kinds('/* a\n b */ x', 'c')).toEqual(['com:/* a\n b */'])
  })

  it('never loses text, even with unfinished strings and comments', () => {
    for (const code of ['"open', '/* never closed', 'a\\"b', '`multi\nline`', 'x = 0x1F + 3.5e2']) {
      expect(tokenize(code, 'javascript').map((t) => t.s).join('')).toBe(code)
    }
  })

  it('guesses the language and reads names and fences', () => {
    expect(guessLang('{"a": 1}')).toBe('json')
    expect(guessLang('fn main() {\n  let mut x = 1;\n}')).toBe('rust')
    expect(guessLang('def go():\n  pass')).toBe('python')
    expect(guessLang('select * from cars')).toBe('sql')
    expect(guessLang('const a = () => 1')).toBe('javascript')
    expect(guessLang('hello there')).toBe('text')
    expect(langId('TS')).toBe('typescript')
    expect(langId('nope')).toBeUndefined()
    expect(fencedCode('```py\nprint(1)\n```')).toEqual({ lang: 'python', code: 'print(1)' })
    expect(fencedCode('not fenced')).toBeNull()
  })

  it('can be created by an operation', () => {
    const out = applyOps(emptyBoard(), [{ op: 'createCode', code: 'SELECT 1', lang: 'SQL' }, { op: 'createCode', code: 'x' }], { measure: fakeMeasure })
    expect(getItem(out.board, out.results[0].id!)).toMatchObject({ kind: 'code', lang: 'sql', text: 'SELECT 1' })
    // Without a language, the block guesses one when drawn.
    expect(getItem(out.board, out.results[1].id!)!.lang).toBeUndefined()
  })
})
