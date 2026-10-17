/** With Alt (Option on a Mac, where it turns C into ç), the letter key that was pressed. */
export function altLetter(e: Pick<KeyboardEvent, 'altKey' | 'ctrlKey' | 'metaKey' | 'code'>) {
  return e.altKey && !e.ctrlKey && !e.metaKey && /^Key[A-Z]$/.test(e.code) ? e.code.slice(3).toLowerCase() : null
}
