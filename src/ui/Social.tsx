/** Reactions under objects, and dot-vote badges and controls, drawn over the board. */

import type { Editor } from '../editor/Editor'
import { getItem } from '../model/board'
import * as RX from '../model/reactions'
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

export function Social({ editor }: { editor: Editor }) {
  const k = scaleFor(editor.camera.zoom)
  const me = editor.me
  const reacted = editor.board.items.filter((i) => i.reactions && !editor.hidden.has(i.id))
  const polls = editor.board.items.filter((i): i is Item & { poll: NonNullable<Item['poll']> } => !!i.poll && !editor.hidden.has(i.id))
  if (!reacted.length && !polls.length) return null
  return (
    <g className="social">
      {reacted.map((i) => (
        <Reactions key={i.id} item={i} me={me} k={k} />
      ))}
      {polls.map((p) => (
        <g key={p.id}>
          <VoteBadges poll={p} editor={editor} k={k} />
          {editor.editing?.id !== p.id && <VoteControls poll={p} editor={editor} />}
        </g>
      ))}
    </g>
  )
}
