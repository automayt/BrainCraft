import { describe, expect, it } from 'vitest'
import { hasMark, marksText, textRuns, toggleMark, toggleWhole, unmarked, wholeHas } from './textMarks'

/** The runs as `[bold]`, `/italic/` and `[/both/]`, to read at a glance. */
const drawn = (text: string) =>
  textRuns(text)
    .map((r) => (r.b && r.i ? `[/${r.text}/]` : r.b ? `[${r.text}]` : r.i ? `/${r.text}/` : r.text))
    .join('')

describe('bold and italic in an object’s words', () => {
  it('reads **bold**, *italic* and ***both***', () => {
    expect(drawn('**Decision:** ship on *Friday*')).toBe('[Decision:] ship on /Friday/')
    expect(drawn('***Now***')).toBe('[/Now/]')
    expect(drawn('plain words')).toBe('plain words')
    expect(textRuns('')).toEqual([])
  })

  it('reads one inside the other', () => {
    expect(drawn('**ship *this* week**')).toBe('[ship ][/this/][ week]')
    expect(drawn('*a **b** c*')).toBe('/a /[/b/]/ c/')
  })

  it('reads them beside punctuation', () => {
    expect(drawn('(**note**), then "*this*".')).toBe('([note]), then "/this/".')
  })

  it('leaves sums, wildcards and lone stars as they are', () => {
    for (const text of ['2*3*4', 'a * b * c', '*.txt and *.md', '*args and **kwargs', 'rated ***** by all', '5 * (3 + 2) * 4', 'a*b*c', '** not bold **', 'price* (*before tax)', 'ends with a star *', '**bold**er', '2*3* = 6', 'mid*word* stars', 'un**bold** it', '****loud****']) {
      expect(drawn(text)).toBe(text)
      expect(unmarked(text)).toBe(text)
    }
  })

  it('never carries a mark onto the next line', () => {
    expect(drawn('**one\ntwo**')).toBe('**one\ntwo**')
    expect(drawn('**one**\n*two*')).toBe('[one]\n/two/')
  })

  it('leaves an unfinished mark as typed, and still reads the finished ones', () => {
    expect(drawn('**bold and *more**')).toBe('[bold and *more]')
    expect(drawn('*a **b*')).toBe('/a **b/')
    expect(drawn('**a** and **b')).toBe('[a] and **b')
  })

  it('gives the words without their marks', () => {
    expect(unmarked('**Budget** review, *soon*')).toBe('Budget review, soon')
    expect(unmarked('2*3')).toBe('2*3')
  })

  it('is for words on notes, shapes, text, comments and ideas, not titles or code', () => {
    expect(['sticky', 'text', 'rect', 'ellipse', 'flow', 'comment', 'mind'].every((k) => marksText(k as never))).toBe(true)
    expect(['frame', 'code', 'table', 'kanban', 'timeline', 'data', 'sequence', 'image', 'link', 'pen'].some((k) => marksText(k as never))).toBe(false)
  })
})

describe('Ctrl B and Ctrl I', () => {
  /** The text with the selection shown as `[` `]` (or `|` for a caret). */
  const press = (shown: string, mark: 'b' | 'i' = 'b') => {
    const caret = shown.indexOf('|')
    const from = caret >= 0 ? caret : shown.indexOf('[')
    const to = caret >= 0 ? caret : shown.indexOf(']') - 1
    const text = shown.replace(/[[\]|]/g, '')
    const r = toggleMark(text, from, to, mark)
    return r.from === r.to ? `${r.text.slice(0, r.from)}|${r.text.slice(r.from)}` : `${r.text.slice(0, r.from)}[${r.text.slice(r.from, r.to)}]${r.text.slice(r.to)}`
  }

  it('makes the selected words bold, and plain again', () => {
    expect(press('[Budget] review')).toBe('**[Budget]** review')
    expect(press('**[Budget]** review')).toBe('[Budget] review')
    expect(press('Budget [review]', 'i')).toBe('Budget *[review]*')
    expect(press('Budget *[review]*', 'i')).toBe('Budget [review]')
  })

  it('takes the marks off when they were selected too', () => {
    expect(press('[**Budget**] review')).toBe('[Budget] review')
    expect(press('a [*b*] c', 'i')).toBe('a [b] c')
  })

  it('goes round whole words, and not the spaces beside them', () => {
    expect(press('Bu[dg]et review')).toBe('**[Budget]** review')
    expect(press('Budget[ review ]now')).toBe('Budget **[review]** now')
    expect(press('one [two thr]ee four')).toBe('one **[two three]** four')
  })

  it('adds bold to italic words and takes it off again, leaving the italics', () => {
    expect(press('*[soon]*')).toBe('***[soon]***')
    expect(press('***[soon]***')).toBe('*[soon]*')
    expect(press('***[soon]***', 'i')).toBe('**[soon]**')
    expect(press('**[soon]**', 'i')).toBe('***[soon]***')
  })

  it('with the caret in a word, marks that word and leaves the caret to go on typing', () => {
    expect(press('Bud|get review')).toBe('**Bud|get** review')
    expect(press('**Bud|get** review')).toBe('Bud|get review')
    expect(press('Budget| review')).toBe('**Budget|** review')
    expect(press('Budget |review')).toBe('Budget **|review**')
    // Beside a marked word, outside its marks: still that word.
    expect(press('**Budget**| review')).toBe('Budget| review')
    expect(press('|**Budget** review')).toBe('|Budget review')
  })

  it('beside no word, opens an empty pair to type between, and takes it away again', () => {
    expect(press('Budget | review')).toBe('Budget **|** review')
    expect(press('Budget **|** review')).toBe('Budget | review')
    expect(press('|')).toBe('**|**')
    expect(press('|', 'i')).toBe('*|*')
    expect(press('*|*', 'i')).toBe('|')
    expect(press('**|**', 'i')).toBe('***|***')
  })

  it('marks each selected line by itself', () => {
    expect(press('[one\ntwo words\n\nthree]')).toBe('**[one**\n**two words**\n\n**three]**')
    expect(press('**[one**\n**two words**\n\n**three]**')).toBe('[one\ntwo words\n\nthree]')
    // Some lines already bold: the rest join them.
    expect(press('[**one**\ntwo]')).toBe('**[one**\n**two]**')
  })

  it('does nothing to a selection with no words in it', () => {
    expect(press('a[   ]b')).toBe('a[   ]b')
    expect(press('a[\n\n]b')).toBe('a[\n\n]b')
  })

  it('makes what the page then draws', () => {
    const r = toggleMark('ship it on Friday', 11, 17, 'b')
    expect(textRuns(r.text)).toEqual([{ text: 'ship it on ' }, { text: 'Friday', b: true }])
    expect(unmarked(r.text)).toBe('ship it on Friday')
  })

  it('says whether the selection is bold', () => {
    expect(hasMark('**Budget** review', 2, 8, 'b')).toBe(true)
    expect(hasMark('**Budget** review', 2, 8, 'i')).toBe(false)
    expect(hasMark('**Budget** review', 0, 17, 'b')).toBe(false)
    expect(hasMark('***x***', 3, 4, 'b')).toBe(true)
    expect(hasMark('***x***', 3, 4, 'i')).toBe(true)
  })

  it('makes a whole object bold, line by line, and plain again', () => {
    expect(toggleWhole('Risks\n- late parts\n- no budget', 'b')).toBe('**Risks**\n**- late parts**\n**- no budget**')
    expect(wholeHas('**Risks**\n**- late parts**\n**- no budget**', 'b')).toBe(true)
    expect(toggleWhole('**Risks**\n**- late parts**\n**- no budget**', 'b')).toBe('Risks\n- late parts\n- no budget')
    expect(wholeHas('**Risks**\nplain', 'b')).toBe(false)
    expect(toggleWhole('a **b** c', 'b')).toBe('**a **b** c**')
    expect(unmarked(toggleWhole('a **b** c', 'b'))).toBe('a b c')
    expect(toggleWhole(toggleWhole('a **b** c', 'b'), 'b')).toBe('a **b** c')
  })

  it('leaves an empty object empty', () => {
    expect(toggleWhole('', 'b')).toBe('')
    expect(toggleWhole('  \n ', 'i')).toBe('  \n ')
    expect(wholeHas('', 'b')).toBe(false)
  })
})
