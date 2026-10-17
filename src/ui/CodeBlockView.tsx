import { guessLang, LANGS, tokenize } from '../model/code'
import type { Item } from '../model/types'
import { useEditor } from './useEditor'

export const CODE_HEAD_H = 32
export const CODE_FONT = "'JetBrains Mono', 'Cascadia Code', Consolas, 'SF Mono', Menlo, monospace"

/** Where a code block's code goes (the text editor uses the same box). */
export const codeBodyRect = (i: Item) => ({ x: i.x + 12, y: i.y + CODE_HEAD_H + 6, w: Math.max(1, i.w - 24), h: Math.max(1, i.h - CODE_HEAD_H - 12) })

/** Code with coloured keywords, strings and comments, under a header with its language. */
export function CodeBlockView({ item, live, editing }: { item: Item; live: boolean; editing: boolean }) {
  const editor = useEditor()
  const lang = item.lang && LANGS[item.lang] ? item.lang : guessLang(item.text)
  const body = codeBodyRect(item)
  return (
    <g>
      <rect x={item.x} y={item.y + 3} width={item.w} height={item.h} rx={10} fill="rgba(0,0,0,0.12)" />
      <rect x={item.x} y={item.y} width={item.w} height={item.h} rx={10} className="code-block" />
      <foreignObject x={item.x} y={item.y} width={item.w} height={CODE_HEAD_H}>
        <div className="code-head">
          <span className="code-dots" aria-hidden="true">
            <i />
            <i />
            <i />
          </span>
          {live && !editor.readOnly ? (
            <select className="no-canvas" aria-label="Language" value={lang} onChange={(e) => editor.setCodeLang(item.id, e.target.value)}>
              {Object.entries(LANGS).map(([id, l]) => (
                <option key={id} value={id}>
                  {l.label}
                </option>
              ))}
            </select>
          ) : (
            <span className="code-lang">{LANGS[lang].label}</span>
          )}
          <button
            className="code-copy no-canvas"
            title="Copy the code"
            onClick={() =>
              navigator.clipboard?.writeText(item.text).then(
                () => editor.setStatus('Copied the code'),
                () => editor.setStatus('Clipboard unavailable'),
              )
            }
          >
            Copy
          </button>
        </div>
      </foreignObject>
      {!editing && (
        <foreignObject x={body.x} y={body.y} width={body.w} height={body.h}>
          <pre className="code-body" style={{ fontSize: item.fontSize, fontFamily: CODE_FONT }}>
            {item.text ? (
              tokenize(item.text, lang).map((t, k) =>
                t.t === 'plain' ? (
                  t.s
                ) : (
                  <span key={k} className={`tok-${t.t}`}>
                    {t.s}
                  </span>
                ),
              )
            ) : (
              <span className="tok-com">{'// Double-click to write some code'}</span>
            )}
          </pre>
        </foreignObject>
      )}
    </g>
  )
}
