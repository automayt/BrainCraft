import { useEffect, useState } from 'react'
import type { FormDefinition } from '../model/forms'
import { ApiError, call } from '../store/account'
import { appName, fetchAppName, setAppName } from '../store/brand'
import { returnAfterSignIn } from '../store/formLink'
import { FormFill } from './FormFill'

type State = { at: 'loading' } | { at: 'form'; form: FormDefinition } | { at: 'signin' } | { at: 'gone'; why: string }

/** Just a form, for someone with its link who never opens the board (`?form=<board>/<view>`). */
export function FormPage({ board, item }: { board: string; item: number }) {
  const [state, setState] = useState<State>({ at: 'loading' })
  const path = `api/forms/${encodeURIComponent(board)}/${item}`
  useEffect(() => {
    void fetchAppName(location.origin).then((n) => n !== null && setAppName(n))
    call<FormDefinition>(location.origin, path).then(
      (form) => {
        document.title = `${form.title} · ${appName()}`
        setState({ at: 'form', form })
      },
      (err: unknown) => setState(err instanceof ApiError && err.status === 401 ? { at: 'signin' } : { at: 'gone', why: (err as Error).message }),
    )
  }, [path])

  return (
    <main className="form-page">
      <div className="form-page-card">
        {state.at === 'loading' && <p className="muted">Opening the form…</p>}
        {state.at === 'gone' && (
          <>
            <h1 className="form-title">No form here</h1>
            <p>{state.why}</p>
          </>
        )}
        {state.at === 'signin' && (
          <>
            <h1 className="form-title">Sign in to answer</h1>
            <p>This form is for people with an account on {appName()}. You’ll come back here once you’re signed in.</p>
            <button
              className="primary"
              onClick={() => {
                returnAfterSignIn(location.href)
                location.href = '/'
              }}
            >
              Sign in
            </button>
          </>
        )}
        {state.at === 'form' && <FormFill form={state.form} answer={async (answers) => (await call<{ thanks: string }>(location.origin, path, 'POST', { answers })).thanks} />}
      </div>
      <p className="form-page-foot muted">Made with {appName()}. Your answer goes to the people who made this form.</p>
    </main>
  )
}
