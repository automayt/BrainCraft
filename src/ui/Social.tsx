/** Reactions under objects, and dot-vote badges and controls, drawn over the board. */

import type { Editor } from '../editor/Editor'
import { bounds as getBoardBounds, getItem } from '../model/board'
import * as RX from '../model/reactions'
import * as BS from '../model/brainstorm'
import { SPIN_MS, spinStart, wheelOptions } from '../model/wheel'
import { useEffect, useState } from 'react'
import type { Item } from '../model/types'
import { commentBodyRect } from './BoardView'

/** Keeps these readable when zoomed out (up to 3x their size), without growing when zoomed in. */
const scaleFor = (zoom: number) => Math.min(3, Math.max(1, 1 / zoom))

function Reactions({ item, me, k }: { item: Item; me: string; k: number }) {
  let x = item.x
  const y = item.y + item.h + 6 * k
  return (
    <g className="reactions">
      {RX.reactionList(item).map(({ emoji, who }) => {
        const w = (34 + String(who.length).length * 7) * k
        const left = x
        x += w + 4 * k
        const mine = who.includes(me)
        return (
          <g key={emoji} data-handle="react" data-id={item.id} data-emoji={emoji} className={`reaction${mine ? ' mine' : ''}`}>
            <title>{`${who.join(', ')} — click to ${mine ? 'take yours off' : 'add yours'}`}</title>
            <rect x={left} y={y} width={w} height={24 * k} rx={12 * k} strokeWidth={1.5 * k} />
            <text x={left + 8 * k} y={y + 16.5 * k} fontSize={13 * k}>
              {emoji}
            </text>
            <text x={left + 26 * k} y={y + 16.5 * k} fontSize={12 * k} className="reaction-count">
              {who.length}
            </text>
          </g>
        )
      })}
    </g>
  )
}

function VoteBadges({ poll, editor, k }: { poll: Item & { poll: NonNullable<Item['poll']> }; editor: Editor; k: number }) {
  const me = editor.me
  const open = !poll.poll.ended
  const shown = poll.poll.revealed || !open
  const ranked = shown ? RX.results(editor.board, poll.id) : []
  const top = ranked[0]?.votes ?? 0
  return (
    <g className="vote-badges">
      {poll.poll.options.map((id) => {
        const i = getItem(editor.board, id)
        if (!i || editor.hidden.has(id)) return null
        const mine = RX.votesBy(i, poll.id, me)
        const total = RX.totalVotes(i, poll.id)
        const cx = i.x + i.w - 2 * k
        const cy = i.y + 2 * k
        const r = 15 * k
        const winner = shown && top > 0 && total === top
        return (
          <g key={id}>
            <g data-handle={open ? 'vote' : undefined} data-id={id} data-poll={poll.id} data-delta="1" className={`vote-dot${mine ? ' mine' : ''}${winner ? ' winner' : ''}${open ? '' : ' closed'}`}>
              <title>{open ? `Vote for this (you've put ${mine} here)${shown ? ` — ${total} in all` : ''}. Alt-click takes one back.` : `${total} vote${total === 1 ? '' : 's'}`}</title>
              <circle cx={cx} cy={cy} r={r} strokeWidth={2 * k} />
              <text x={cx} y={cy} dy="0.35em" textAnchor="middle" fontSize={13 * k}>
                {shown ? total : mine ? `${mine}` : '+'}
              </text>
            </g>
            {open && mine > 0 && (
              <g data-handle="vote" data-id={id} data-poll={poll.id} data-delta="-1" className="vote-minus">
                <title>Take one of your votes back</title>
                <circle cx={cx - r * 1.9} cy={cy} r={r * 0.7} strokeWidth={1.5 * k} />
                <text x={cx - r * 1.9} y={cy} dy="0.35em" textAnchor="middle" fontSize={13 * k}>
                  −
                </text>
              </g>
            )}
          </g>
        )
      })}
    </g>
  )
}

/** The buttons along the bottom of a vote card. */
function VoteControls({ poll, editor }: { poll: Item & { poll: NonNullable<Item['poll']> }; editor: Editor }) {
  const body = commentBodyRect(poll)
  const used = RX.usedVotes(editor.board, poll.id, editor.me)
  const people = RX.voters(editor.board, poll.id).length
  const open = !poll.poll.ended
  return (
    <foreignObject x={poll.x + 10} y={body.y + body.h + 4} width={Math.max(1, poll.w - 20)} height={44}>
      <div className="vote-controls no-canvas" onPointerDown={(e) => e.stopPropagation()}>
        <span className="vote-status">
          {open ? `${poll.poll.each - used} of ${poll.poll.each} vote${poll.poll.each === 1 ? '' : 's'} left` : 'Closed'} · {people} voted
        </span>
        <span className="vote-buttons">
          {open && (
            <button onClick={() => editor.revealVote(poll.id, !poll.poll.revealed)} title={poll.poll.revealed ? 'Hide the counts again' : 'Show everyone’s votes'}>
              {poll.poll.revealed ? 'Hide' : 'Reveal'}
            </button>
          )}
          <button onClick={() => editor.sortByVotes(poll.id)} title="Arrange the options by votes, most first">
            Sort
          </button>
          {open && (
            <button onClick={() => editor.endVote(poll.id)} title="Close the vote and show the results">
              End
            </button>
          )}
        </span>
      </div>
    </foreignObject>
  )
}

/** The bottom of a brainstorm card: how many notes are hidden, and the reveal button. */
function BrainstormControls({ card, editor }: { card: Item & { brainstorm: NonNullable<Item['brainstorm']> }; editor: Editor }) {
  const body = commentBodyRect(card)
  const { notes, people } = BS.roundStats(editor.board)
  const open = !card.brainstorm.revealed
  return (
    <foreignObject x={card.x + 10} y={body.y + body.h + 4} width={Math.max(1, card.w - 20)} height={44}>
      <div className="vote-controls no-canvas" onPointerDown={(e) => e.stopPropagation()}>
        <span className="vote-status">
          {open ? (notes ? `${notes} hidden note${notes === 1 ? '' : 's'} from ${people} ${people === 1 ? 'person' : 'people'}` : 'Add sticky notes: only you see yours') : 'Everyone’s notes are showing'}
        </span>
        {open && !editor.readOnly && (
          <span className="vote-buttons">
            <button onClick={() => editor.revealBrainstorm(card.id)} title="Show everyone’s notes and close this round">
              Reveal all
            </button>
          </span>
        )}
      </div>
    </foreignObject>
  )
}

/** Under a spinner: the Spin button and, once it stops, the answer. */
function WheelControls({ card, editor }: { card: Item & { wheel: NonNullable<Item['wheel']> }; editor: Editor }) {
  const body = commentBodyRect(card)
  const spin = card.wheel.spin
  const options = wheelOptions(card)
  const [, rerender] = useState(0)
  const left = spin ? spinStart(spin) + SPIN_MS - Date.now() : 0
  // Show the answer once the wheel has stopped.
  useEffect(() => {
    if (left <= 0) return
    const t = setTimeout(() => rerender((n) => n + 1), left + 30)
    return () => clearTimeout(t)
  }, [left])
  const spinning = left > 0
  const answer = spin && !spinning ? (spin.label ?? options[spin.result]) : undefined
  return (
    <foreignObject x={card.x + 10} y={body.y + body.h + 4} width={Math.max(1, card.w - 20)} height={44}>
      <div className="vote-controls no-canvas" onPointerDown={(e) => e.stopPropagation()}>
        <span className="vote-status wheel-answer">
          {spinning ? 'Spinning…' : answer ? <>→ <strong>{answer}</strong></> : options.length < 2 ? 'Put an option on each line' : `${options.length} options`}
        </span>
        {!editor.readOnly && (
          <span className="vote-buttons">
            <button onClick={() => editor.spinWheel(card.id)} disabled={spinning || options.length < 2} title="Spin: everyone sees it land on the same answer">
              Spin
            </button>
          </span>
        )}
      </div>
    </foreignObject>
  )
}

/** The turn-over button on each flip card. */
function FlipButtons({ editor, k }: { editor: Editor; k: number }) {
  // From the masked view: nobody can turn over someone else's hidden note.
  const cards = editor.viewBoard.items.filter((i) => i.kind === 'sticky' && typeof i.back === 'string' && !i.masked && !editor.hidden.has(i.id))
  return (
    <g>
      {cards.map((i) => (
        <g key={i.id} data-handle={editor.readOnly ? undefined : 'flip'} data-id={i.id} className="flip-button" transform={`translate(${i.x + i.w - 30 * k} ${i.y + i.h - 30 * k}) scale(${k})`}>
          <title>{i.flipped ? 'Turn back to the front' : 'Turn over'}</title>
          <circle cx="12" cy="12" r="12" />
          <path d="M6.5 10a6 6 0 0 1 10.6-2.2M17.5 14a6 6 0 0 1-10.6 2.2M17.4 4.6v3.4H14M6.6 19.4V16H10" />
        </g>
      ))}
    </g>
  )
}

/** "Only you can see this" on your own notes while a round is open. */
function MyHiddenNotes({ editor, k }: { editor: Editor; k: number }) {
  const me = editor.me
  const open = BS.openRound(editor.board)
  const mine = editor.board.items.filter((i) => BS.isMyHidden(i, me, open) && !editor.hidden.has(i.id))
  return (
    <g>
      {mine.map((i) => (
        <g key={i.id} className="private-tag" transform={`translate(${i.x + 6 * k} ${i.y + i.h - 22 * k}) scale(${k})`}>
          <title>Only you can see this until the brainstorm is revealed</title>
          <rect width="104" height="16" rx="8" />
          <text x="52" y="11.5" textAnchor="middle" fontSize="10">
            only you see this
          </text>
        </g>
      ))}
    </g>
  )
}

/** A small padlock on locked objects, and a dashed outline around a selected group. */
const getBounds = (editor: Editor, ids: Set<number>) => getBoardBounds(editor.board, ids)

function LocksAndGroups({ editor, k }: { editor: Editor; k: number }) {
  const locked = editor.board.items.filter((i) => i.locked && !editor.hidden.has(i.id))
  const groups = new Set(editor.selectedItems.map((i) => i.group).filter(Boolean))
  return (
    <g>
      {locked.map((i) => (
        <g key={i.id} className="lock-badge" transform={`translate(${i.x + i.w - 22 * k} ${i.y + 4 * k}) scale(${k})`}>
          <title>Locked — right-click or Alt-click to unlock</title>
          <rect width="18" height="18" rx="5" />
          <path d="M5.5 8V6.5a3.5 3.5 0 0 1 7 0V8M5 8h8v6H5z" fill="none" strokeWidth="1.5" strokeLinejoin="round" />
        </g>
      ))}
      {[...groups].map((g) => {
        const ids = new Set(editor.board.items.filter((i) => i.group === g).map((i) => i.id))
        const r = getBounds(editor, ids)
        if (!r) return null
        const pad = 10 * k
        return <rect key={g} className="group-outline" x={r.x - pad} y={r.y - pad} width={r.w + 2 * pad} height={r.h + 2 * pad} rx={8 * k} strokeWidth={1.5 * k} strokeDasharray={`${6 * k} ${4 * k}`} />
      })}
    </g>
  )
}

export function Social({ editor }: { editor: Editor }) {
  const k = scaleFor(editor.camera.zoom)
  const me = editor.me
  const reacted = editor.board.items.filter((i) => i.reactions && !editor.hidden.has(i.id))
  const polls = editor.board.items.filter((i): i is Item & { poll: NonNullable<Item['poll']> } => !!i.poll && !editor.hidden.has(i.id))
  const extras = editor.board.items.some((i) => i.locked) || editor.selectedItems.some((i) => i.group)
  const rounds = editor.board.items.filter((i): i is Item & { brainstorm: NonNullable<Item['brainstorm']> } => !!i.brainstorm && !editor.hidden.has(i.id))
  const roundOpen = rounds.some((r) => !r.brainstorm.revealed)
  const flips = editor.board.items.some((i) => typeof i.back === 'string')
  const wheels = editor.board.items.filter((i): i is Item & { wheel: NonNullable<Item['wheel']> } => !!i.wheel && !editor.hidden.has(i.id))
  if (!reacted.length && !polls.length && !extras && !rounds.length && !wheels.length && !flips) return null
  return (
    <g className="social">
      {extras && <LocksAndGroups editor={editor} k={k} />}
      {reacted.map((i) => (
        <Reactions key={i.id} item={i} me={me} k={k} />
      ))}
      {roundOpen && <MyHiddenNotes editor={editor} k={k} />}
      {flips && <FlipButtons editor={editor} k={k} />}
      {wheels.map((w) => editor.editing?.id !== w.id && <WheelControls key={w.id} card={w} editor={editor} />)}
      {rounds.map((r) => editor.editing?.id !== r.id && <BrainstormControls key={r.id} card={r} editor={editor} />)}
      {polls.map((p) => (
        <g key={p.id}>
          <VoteBadges poll={p} editor={editor} k={k} />
          {editor.editing?.id !== p.id && <VoteControls poll={p} editor={editor} />}
        </g>
      ))}
    </g>
  )
}
