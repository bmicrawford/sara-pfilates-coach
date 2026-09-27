import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { PfilatesBrandHeader } from '../components/PfilatesLogo'
import {
  blankDraft,
  clearWorksheetDraft,
  completeAnswers,
  currentWorksheet,
  readMovementPlan,
  saveWorksheetResult,
  writeWorksheetDraft,
  type DraftAnswer,
  type MovementPlanState,
  type WorksheetRecord,
} from '../lib/movementPlan'
import {
  CIRCLE_ANSWERS,
  CONTRACTION_QUESTION,
  CONTRACTION_SCALE,
  COURSE_LINE,
  NO_EVERYDAY_PLAN_MESSAGE,
  PAIN_QUESTION,
  REGULAR_QUESTION,
  STANDARD_MOVEMENT_CATALOG,
  TOP_MOVEMENTS_TITLE,
  WORKSHEET_INTRO,
  WORKSHEET_TITLE,
  adjustTopMovements,
  movementName,
  selectTopMovements,
  type MovementAnswers,
} from '../lib/movements'
import { formatDay } from '../lib/storage'

export function Worksheet() {
  const [plan, setPlan] = useState<MovementPlanState>(() => readMovementPlan())
  const [review, setReview] = useState(false)
  const [chosen, setChosen] = useState<string[]>([])
  const [limitNote, setLimitNote] = useState(false)
  const current = currentWorksheet(plan)
  const editing = review || plan.draft !== null || !current
  const draft = plan.draft ?? blankDraft()
  const answers = useMemo(() => completeAnswers(draft), [draft])
  const selection = useMemo(
    () => (answers ? selectTopMovements(STANDARD_MOVEMENT_CATALOG, answers) : null),
    [answers],
  )
  const answeredCount = draft.filter(
    (row) => row.pain !== null && row.regular !== null && row.contraction !== null,
  ).length

  const update = (movementId: string, patch: Partial<DraftAnswer>) => {
    const base = readMovementPlan().draft ?? blankDraft()
    const next = base.map((row) => (row.movementId === movementId ? { ...row, ...patch } : row))
    setPlan(writeWorksheetDraft(next))
    setReview(false)
  }

  const beginReview = () => {
    if (!answers) return
    const next = selectTopMovements(STANDARD_MOVEMENT_CATALOG, answers)
    setChosen(next.suggestedIds)
    setLimitNote(false)
    setReview(true)
  }

  const toggleChosen = (id: string) => {
    if (chosen.includes(id)) {
      setLimitNote(false)
      setChosen(chosen.filter((item) => item !== id))
      return
    }
    if (chosen.length >= 3) {
      setLimitNote(true)
      return
    }
    setLimitNote(false)
    setChosen([...chosen, id])
  }

  const save = () => {
    if (!answers) return
    const saved = saveWorksheetResult(answers, chosen)
    if (!saved.ok) return
    setPlan(saved.state)
    setReview(false)
  }

  return (
    <main className="mx-auto min-h-dvh max-w-[430px] px-5 pb-16 text-black safe-top">
      <header className="flex items-center justify-between gap-3">
        <Link to="/" className="text-sm font-bold text-black">
          ← Home
        </Link>
      </header>
      <div className="mt-4">
        <PfilatesBrandHeader compact />
      </div>
      <h1 className="font-serif text-3xl font-bold leading-tight text-black">{WORKSHEET_TITLE}</h1>

      {editing ? (
        review && selection ? (
          <Review
            answers={answers ?? []}
            chosen={chosen}
            limitNote={limitNote}
            onToggle={toggleChosen}
            onBack={() => setReview(false)}
            onSave={save}
          />
        ) : (
          <Form
            draft={draft}
            answeredCount={answeredCount}
            ready={answers !== null}
            onChange={update}
            onReview={beginReview}
            onCancel={
              current
                ? () => {
                    setReview(false)
                    setPlan(clearWorksheetDraft())
                  }
                : null
            }
          />
        )
      ) : current ? (
        <Saved record={current} history={plan.history} onRedo={() => setPlan(writeWorksheetDraft(blankDraft()))} />
      ) : null}
    </main>
  )
}

function Form({
  draft,
  answeredCount,
  ready,
  onChange,
  onReview,
  onCancel,
}: {
  draft: DraftAnswer[]
  answeredCount: number
  ready: boolean
  onChange: (movementId: string, patch: Partial<DraftAnswer>) => void
  onReview: () => void
  onCancel: (() => void) | null
}) {
  return (
    <>
      <p className="mt-3 text-sm font-bold leading-relaxed text-black">{WORKSHEET_INTRO}</p>
      <p className="mt-2 text-sm font-bold text-black">{CIRCLE_ANSWERS}</p>
      <div className="glass-card mt-4 px-4 py-3 text-sm font-bold leading-relaxed text-black">
        <p>{CONTRACTION_QUESTION}</p>
        <ul className="mt-2 space-y-1">
          {CONTRACTION_SCALE.map((item) => (
            <li key={item.value}>
              {item.value} = {item.label}
            </li>
          ))}
        </ul>
      </div>

      <ol className="mt-4 space-y-3">
        {STANDARD_MOVEMENT_CATALOG.movements.map((movement, index) => {
          const row = draft.find((answer) => answer.movementId === movement.id)
          return (
            <li key={movement.id} className="glass-card px-4 py-4">
              <h2 className="font-serif text-xl font-bold text-black">
                {index + 1}. {movement.name}
              </h2>
              <p className="mt-1 text-xs font-bold text-black">{COURSE_LINE}</p>
              <div className="mt-3" role="group" aria-label={`${movement.name}. ${PAIN_QUESTION}`}>
                <p className="text-sm font-bold text-black">{PAIN_QUESTION}</p>
                <div className="mt-2 flex gap-2">
                  <Choice
                    pressed={row?.pain === 'yes'}
                    onClick={() => onChange(movement.id, { pain: 'yes' })}
                  >
                    Yes
                  </Choice>
                  <Choice pressed={row?.pain === 'no'} onClick={() => onChange(movement.id, { pain: 'no' })}>
                    No
                  </Choice>
                </div>
              </div>
              <div className="mt-3" role="group" aria-label={`${movement.name}. ${REGULAR_QUESTION}`}>
                <p className="text-sm font-bold text-black">{REGULAR_QUESTION}</p>
                <div className="mt-2 flex gap-2">
                  <Choice
                    pressed={row?.regular === 'yes'}
                    onClick={() => onChange(movement.id, { regular: 'yes' })}
                  >
                    Yes
                  </Choice>
                  <Choice
                    pressed={row?.regular === 'no'}
                    onClick={() => onChange(movement.id, { regular: 'no' })}
                  >
                    No
                  </Choice>
                </div>
              </div>
              <div className="mt-3" role="radiogroup" aria-label={`${movement.name}. ${CONTRACTION_QUESTION}`}>
                <p className="text-sm font-bold text-black">{CONTRACTION_QUESTION}</p>
                <div className="mt-2 flex gap-2">
                  {CONTRACTION_SCALE.map((item) => (
                    <Choice
                      key={item.value}
                      pressed={row?.contraction === item.value}
                      label={`${item.value}, ${item.label}`}
                      onClick={() => onChange(movement.id, { contraction: item.value })}
                    >
                      {item.value}
                    </Choice>
                  ))}
                </div>
              </div>
            </li>
          )
        })}
      </ol>

      <div className="sticky bottom-0 z-10 -mx-5 mt-4 bg-gradient-to-t from-cream from-60% to-transparent px-5 pb-[max(0.75rem,env(safe-area-inset-bottom))] pt-6">
        <p className="mb-2 text-center text-xs font-bold text-black">
          {answeredCount} of {STANDARD_MOVEMENT_CATALOG.movements.length} movements answered
        </p>
        <button
          type="button"
          disabled={!ready}
          onClick={onReview}
          className="w-full rounded-full bg-sage py-3 font-bold text-white disabled:opacity-40"
        >
          See my top movements
        </button>
        {onCancel ? (
          <button type="button" onClick={onCancel} className="mt-2 w-full py-2 text-sm font-bold text-black">
            Cancel
          </button>
        ) : null}
      </div>
    </>
  )
}

function Review({
  answers,
  chosen,
  limitNote,
  onToggle,
  onBack,
  onSave,
}: {
  answers: MovementAnswers[]
  chosen: string[]
  limitNote: boolean
  onToggle: (id: string) => void
  onBack: () => void
  onSave: () => void
}) {
  const selection = selectTopMovements(STANDARD_MOVEMENT_CATALOG, answers)
  const ordered = adjustTopMovements(selection.rankedIds, chosen) ?? []

  if (selection.status === 'empty') {
    return (
      <section className="glass-card mt-4 px-4 py-4">
        <h2 className="font-serif text-2xl font-bold text-black">{TOP_MOVEMENTS_TITLE}</h2>
        <p className="mt-3 text-sm font-bold leading-relaxed text-black">{NO_EVERYDAY_PLAN_MESSAGE}</p>
        <button
          type="button"
          onClick={onSave}
          className="mt-4 w-full rounded-full bg-sage py-3 font-bold text-white"
        >
          Save this worksheet
        </button>
        <button type="button" onClick={onBack} className="mt-2 w-full py-2 text-sm font-bold text-black">
          Edit answers
        </button>
      </section>
    )
  }

  return (
    <section className="mt-4">
      <div className="glass-card px-4 py-4">
        <h2 className="font-serif text-2xl font-bold text-black">{TOP_MOVEMENTS_TITLE}</h2>
        <p className="mt-2 text-sm font-bold leading-relaxed text-black">
          Highest contraction ratings, up to 3. A tie stays in worksheet order. Change this to 1–3 movements.
        </p>
        <ol className="mt-4 space-y-2">
          {ordered.map((id, index) => (
            <li key={id} className="font-serif text-xl font-bold text-black">
              {index + 1}. {movementName(id)}
            </li>
          ))}
        </ol>
        {ordered.length === 0 ? (
          <p className="mt-3 text-sm font-bold text-black">Choose 1 to 3 movements.</p>
        ) : null}
        <p className="mt-3 text-sm font-bold text-black">{COURSE_LINE}</p>
      </div>

      <div className="glass-card mt-3 px-4 py-4">
        <p className="text-sm font-bold text-black">Movements you can keep</p>
        <ul className="mt-3 space-y-2">
          {selection.rankedIds.map((id) => {
            const on = chosen.includes(id)
            const rating = answers.find((answer) => answer.movementId === id)?.contraction
            return (
              <li key={id}>
                <button
                  type="button"
                  role="checkbox"
                  aria-checked={on}
                  onClick={() => onToggle(id)}
                  className="flex min-h-12 w-full items-center gap-3 rounded-2xl bg-white/50 px-3 text-left text-base font-bold text-black"
                >
                  <span
                    className={`grid h-7 w-7 shrink-0 place-items-center rounded-full border-2 border-black text-sm ${
                      on ? 'bg-black text-white' : 'bg-white/80 text-transparent'
                    }`}
                    aria-hidden
                  >
                    ✓
                  </span>
                  <span className="flex-1">{movementName(id)}</span>
                  <span className="text-sm font-bold text-black">{rating}</span>
                </button>
              </li>
            )
          })}
        </ul>
        {limitNote ? <p className="mt-3 text-sm font-bold text-black">Choose up to 3.</p> : null}
      </div>

      <button
        type="button"
        disabled={ordered.length < 1}
        onClick={onSave}
        className="mt-4 w-full rounded-full bg-sage py-3 font-bold text-white disabled:opacity-40"
      >
        Use these every day
      </button>
      <button type="button" onClick={onBack} className="mt-2 w-full py-2 text-sm font-bold text-black">
        Edit answers
      </button>
    </section>
  )
}

function Saved({
  record,
  history,
  onRedo,
}: {
  record: WorksheetRecord
  history: WorksheetRecord[]
  onRedo: () => void
}) {
  const earlier = history.filter((item) => item.id !== record.id)
  return (
    <section className="mt-4">
      <div className="glass-card px-4 py-4">
        <h2 className="font-serif text-2xl font-bold text-black">{TOP_MOVEMENTS_TITLE}</h2>
        {record.selectedIds.length === 0 ? (
          <p className="mt-3 text-sm font-bold leading-relaxed text-black">{NO_EVERYDAY_PLAN_MESSAGE}</p>
        ) : (
          <>
            <ol className="mt-4 space-y-2">
              {record.selectedIds.map((id, index) => (
                <li key={id} className="font-serif text-xl font-bold text-black">
                  {index + 1}. {movementName(id)}
                </li>
              ))}
            </ol>
            <p className="mt-3 text-sm font-bold text-black">{COURSE_LINE}</p>
          </>
        )}
        <p className="mt-3 text-xs font-bold text-black">Saved {formatDay(record.completedAt)}</p>
      </div>
      <button
        type="button"
        onClick={onRedo}
        className="mt-4 w-full rounded-full bg-sage py-3 font-bold text-white"
      >
        Redo worksheet
      </button>
      <Link to="/" className="mt-3 block text-center text-sm font-bold text-black">
        Back to today
      </Link>
      {earlier.length > 0 ? (
        <div className="mt-6">
          <h3 className="font-serif text-lg font-bold text-black">Earlier worksheets</h3>
          <ul className="mt-2 space-y-2">
            {earlier.map((item) => (
              <li key={item.id} className="glass-card px-4 py-3 text-sm font-bold text-black">
                <span className="block">{formatDay(item.completedAt)}</span>
                <span className="mt-1 block">
                  {item.selectedIds.length === 0
                    ? 'No everyday plan'
                    : item.selectedIds.map((id) => movementName(id)).join(', ')}
                </span>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </section>
  )
}

function Choice({
  pressed,
  onClick,
  children,
  label,
}: {
  pressed: boolean
  onClick: () => void
  children: string | number
  label?: string
}) {
  return (
    <button
      type="button"
      aria-pressed={pressed}
      aria-label={label}
      onClick={onClick}
      className="answer-choice text-sm"
    >
      {children}
    </button>
  )
}
