import { type FormEvent, useId, useState } from 'react'
import type { FormDefinition, FormQuestion } from '../model/forms'

type Answers = Record<string, string | boolean>

/**
 * A form to fill in: its title, words and questions, then a thank-you once answered. The same on
 * the board (a form view) and on the page a shared link opens. `answer` adds the record and says
 * thanks, or throws with what's wrong.
 */
export function FormFill({ form, answer, disabled, heading = true }: { form: FormDefinition; answer: (answers: Answers) => Promise<string>; disabled?: boolean; heading?: boolean }) {
  const [answers, setAnswers] = useState<Answers>({})
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [thanks, setThanks] = useState<string | null>(null)
  const uid = useId()
  const set = (id: string, v: string | boolean) => setAnswers((a) => ({ ...a, [id]: v }))

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    if (busy || disabled) return
    const missing = form.questions.find((q) => q.required && (answers[q.id] === undefined || answers[q.id] === '' || answers[q.id] === false))
    if (missing) return setError(`“${missing.name}” needs an answer`)
    setBusy(true)
    setError(null)
    try {
      setThanks(await answer(answers))
      setAnswers({})
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setBusy(false)
    }
  }

  if (thanks !== null)
    return (
      <div className="form-fill form-thanks" role="status">
        <p>{thanks}</p>
        <button onClick={() => setThanks(null)}>Answer again</button>
      </div>
    )
  return (
    <form className="form-fill" onSubmit={submit} aria-label={form.title} noValidate>
      {heading && <h2 className="form-title">{form.title}</h2>}
      {form.intro && <p className="form-intro">{form.intro}</p>}
      {!form.questions.length && <p className="muted">No questions yet: show a field in this view to ask it.</p>}
      {form.questions.map((q) => (
        <Question key={q.id} q={q} id={`${uid}-${q.id}`} value={answers[q.id]} onChange={(v) => set(q.id, v)} disabled={disabled} />
      ))}
      {error && (
        <p className="form-error" role="alert">
          {error}
        </p>
      )}
      <div className="form-actions">
        <button type="submit" className="primary" disabled={busy || disabled || !form.questions.length}>
          {busy ? 'Sending…' : 'Submit'}
        </button>
        {form.questions.some((q) => q.required) && <small className="muted">* needs an answer</small>}
      </div>
    </form>
  )
}

function Question({ q, id, value, onChange, disabled }: { q: FormQuestion; id: string; value: string | boolean | undefined; onChange: (v: string | boolean) => void; disabled?: boolean }) {
  const label = (
    <>
      {q.name}
      {q.required && <span className="form-req"> *</span>}
    </>
  )
  if (q.type === 'checkbox')
    return (
      <label className="form-q form-check">
        <input type="checkbox" checked={value === true} disabled={disabled} onChange={(e) => onChange(e.target.checked)} />
        <span>{label}</span>
      </label>
    )
  if (q.type === 'select' && (q.options?.length ?? 0) <= 6)
    return (
      <fieldset className="form-q" disabled={disabled}>
        <legend>{label}</legend>
        <div className="form-choices">
          {q.options?.map((o) => (
            <label key={o.id} className="form-choice">
              <input type="radio" name={id} checked={value === o.id} onChange={() => onChange(o.id)} />
              <span>{o.name}</span>
            </label>
          ))}
          {!q.required && value && (
            <button type="button" className="link" onClick={() => onChange('')}>
              clear
            </button>
          )}
        </div>
      </fieldset>
    )
  const common = { id, disabled, value: typeof value === 'string' ? value : '', 'aria-required': q.required || undefined }
  return (
    <div className="form-q">
      <label htmlFor={id}>{label}</label>
      {q.type === 'select' ? (
        <select {...common} onChange={(e) => onChange(e.target.value)}>
          <option value="">Choose…</option>
          {q.options?.map((o) => (
            <option key={o.id} value={o.id}>
              {o.name}
            </option>
          ))}
        </select>
      ) : q.type === 'text' ? (
        <textarea {...common} rows={2} maxLength={5000} onChange={(e) => onChange(e.target.value)} />
      ) : (
        <input {...common} type={q.type === 'number' ? 'number' : q.type === 'date' ? 'date' : 'text'} maxLength={q.type === 'person' ? 200 : undefined} onChange={(e) => onChange(e.target.value)} />
      )}
    </div>
  )
}
