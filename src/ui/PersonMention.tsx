import { useContext } from 'react'
import { isMe } from '../model/notes'
import { EditorContext } from './useEditor'

/** A mention of a person in a comment or a page: "@Name", marked when it's you. */
export function PersonMention({ id, label }: { id: string; label: string }) {
  const editor = useContext(EditorContext)
  const mine = !!editor && isMe({ person: id, label }, editor.mentionMe)
  return (
    <span className={`mention person${mine ? ' me' : ''}`} title={mine ? 'This mentions you' : id ? undefined : 'Mentioned by name'}>
      @{label}
    </span>
  )
}
