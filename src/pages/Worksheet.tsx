import { useEffect, useMemo, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { PfilatesBrandHeader } from '../components/PfilatesLogo'
import {
  blankDraft,
  clearWorksheetDraft,
  completeAnswers,
  currentWorksheet,
  readMovementPlan,
  saveHealthScreen,
  saveWorksheetResult,
  syncPregnancyExclusions,
  writeWorksheetDraft,
  type DraftAnswer,
  type HealthScreen,
  type MovementPlanState,
  type WorksheetRecord,
} from '../lib/movementPlan'
import {
  CIRCLE_ANSWERS,
  CONTRACTION_QUESTION,
  CONTRACTION_SCALE,
  COURSE_LINE,
  ESSENTIAL_LABEL,
  ESSENTIAL_TIE_NOTE,
  HEALTH_HIP_REPLACEMENT,
  HEALTH_OSTEOPOROSIS,
  HEALTH_PREGNANT,
  HEALTH_SCREEN_TITLE,
  HEALTH_WEEKS,
  NO_EVERYDAY_PLAN_MESSAGE,
  NOT_RECOMMENDED,
  PAIN_QUESTION,
  PAIN_STOP_LINE,
  REGULAR_QUESTION,
  STANDARD_MOVEMENT_CATALOG,
  TOP_MOVEMENTS_TITLE,
  WORKSHEET_INTRO,
  WORKSHEET_TITLE,
  adjustTopMovements,
  exclusionReasons,
  movementIsEssential,
  movementName,
  parseWeeksPregnant,
  selectTopMovements,
  selectionHasRatingTie,
  type MovementAnswers,
  type YesNo,
} from '../lib/movements'
import { formatDay } from '../lib/storage'

export function Worksheet() {
  const [params, setParams] = useSearchParams()
  const [plan, setPlan] = useState<MovementPlanState>(() => syncPregnancyExclusions())
  const [now, setNow] = useState(() => new Date())
  const [review, setReview] = useState(false)
  const [chosen, setChosen] = useState<string[]>([])
  const [limitNote, setLimitNote] = useState(false)
  const editingHealth = params.get('edit') === 'health'
  const showHealth = !plan.health || editingHealth

  useEffect(() => {
    const sync = () => {
      const nextNow = new Date()
      setNow(nextNow)
      setPlan(syncPregnancyExclusions(nextNow))
    }
    window.addEventListener('focus', sync)
    document.addEventListener('visibilitychange', sync)
    return () => {
      window.removeEventListener('focus', sync)
      document.removeEventListener('visibilitychange', sync)
    }
  }, [])

  const excludedIds = useMemo(() => {
    if (!plan.health) return []
    return STANDARD_MOVEMENT_CATALOG.movements
      .filter((movement) => exclusionReasons(movement.id, plan.health, now).length > 0)
      .map((movement) => movement.id)
  }, [plan.health, now])
  const current = currentWorksheet(plan)
  const editing = review || plan.draft !== null || !current
  const draft = plan.draft ?? blankDraft()
  const answers = useMemo(() => completeAnswers(draft, excludedIds), [draft, excludedIds])
  const selection = useMemo(
    () => (answers ? selectTopMovements(STANDARD_MOVEMENT_CATALOG, answers, excludedIds) : null),
    [answers, excludedIds],
  )
  const answeredCount = draft.filter(
    (row) =>
      !excludedIds.includes(row.movementId) &&
      row.pain !== null &&
      row.regular !== null &&
      row.contraction !== null,
  ).length

  const update = (movementId: string, patch: Partial<DraftAnswer>) => {
    const base = readMovementPlan().draft ?? blankDraft()
    const next = base.map((row) => (row.movementId === movementId ? { ...row, ...patch } : row))
    setPlan(writeWorksheetDraft(next))
    setReview(false)
  }

  const beginReview = () => {
    if (!answers) return
    const next = selectTopMovements(STANDARD_MOVEMENT_CATALOG, answers, excludedIds)
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
      <h1 className="font-serif text-3xl font-bold leading-tight text-black">
        {showHealth ? HEALTH_SCREEN_TITLE : WORKSHEET_TITLE}
      </h1>

      {showHealth ? (
        <HealthScreenForm
          initial={plan.health}
          onSave={(input) => {
            setPlan(saveHealthScreen(input, new Date()))
            setNow(new Date())
            if (editingHealth) setParams({}, { replace: true })
          }}
        />
      ) : editing ? (
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
            health={plan.health}
            now={now}
            answeredCount={answeredCount}
            answerTotal={STANDARD_MOVEMENT_CATALOG.movements.length - excludedIds.length}
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
  health,
  now,
  answeredCount,
  answerTotal,
  ready,
  onChange,
  onReview,
  onCancel,
}: {
  draft: DraftAnswer[]
  health: HealthScreen | null
  now: Date
  answeredCount: number
  answerTotal: number
  ready: boolean
  onChange: (movementId: string, patch: Partial<DraftAnswer>) => void
  onReview: () => void
  onCancel: (() => void) | null
}) {
  return (
    <>
      <p className="mt-3 text-sm font-bold leading-relaxed text-black">{WORKSHEET_INTRO}</p>
      <p className="mt-2 text-sm font-bold leading-relaxed text-black">{PAIN_STOP_LINE}</p>
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
          const reasons = exclusionReasons(movement.id, health, now)
          return (
            <li key={movement.id} className="glass-card px-4 py-4" aria-disabled={reasons.length > 0}>
              <h2 className="font-serif text-xl font-bold text-black">
                <span>
                  {index + 1}. {movement.name}
                </span>
                {movement.essential ? <EssentialTag /> : null}
              </h2>
              <p className="mt-1 text-xs font-bold text-black">{COURSE_LINE}</p>
              {reasons.length > 0 ? (
                <>
                  <p className="mt-3 text-sm font-bold text-black">{NOT_RECOMMENDED}</p>
                  <p className="mt-1 text-sm font-bold text-black">{reasons.join(', ')}</p>
                </>
              ) : null}
              {reasons.length > 0 ? null : (
              <>
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
              </>
              )}
            </li>
          )
        })}
      </ol>

      <div className="sticky bottom-0 z-10 -mx-5 mt-4 bg-gradient-to-t from-cream from-60% to-transparent px-5 pb-[max(0.75rem,env(safe-area-inset-bottom))] pt-6">
        <p className="mb-2 text-center text-xs font-bold text-black">
          {answeredCount} of {answerTotal} movements answered
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
        <p className="text-sm font-bold leading-relaxed text-black">{PAIN_STOP_LINE}</p>
        <h2 className="mt-3 font-serif text-2xl font-bold text-black">{TOP_MOVEMENTS_TITLE}</h2>
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
        <p className="text-sm font-bold leading-relaxed text-black">{PAIN_STOP_LINE}</p>
        <h2 className="mt-3 font-serif text-2xl font-bold text-black">{TOP_MOVEMENTS_TITLE}</h2>
        <p className="mt-2 text-sm font-bold leading-relaxed text-black">
          Highest contraction ratings, up to 3. Change this to 1–3 movements.
        </p>
        {selectionHasRatingTie(STANDARD_MOVEMENT_CATALOG, answers) ? (
          <p className="mt-2 text-sm font-bold leading-relaxed text-black">{ESSENTIAL_TIE_NOTE}</p>
        ) : null}
        <ol className="mt-4 space-y-2">
          {ordered.map((id, index) => (
            <li key={id} className="font-serif text-xl font-bold text-black">
              <span>
                {index + 1}. {movementName(id)}
              </span>
              {movementIsEssential(id) ? <EssentialTag /> : null}
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
                  <span className="flex flex-1 flex-wrap items-center gap-2">
                    {movementName(id)}
                    {movementIsEssential(id) ? <EssentialTag /> : null}
                  </span>
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
        <p className="text-sm font-bold leading-relaxed text-black">{PAIN_STOP_LINE}</p>
        <h2 className="mt-3 font-serif text-2xl font-bold text-black">{TOP_MOVEMENTS_TITLE}</h2>
        {record.selectedIds.length === 0 ? (
          <p className="mt-3 text-sm font-bold leading-relaxed text-black">{NO_EVERYDAY_PLAN_MESSAGE}</p>
        ) : (
          <>
            <ol className="mt-4 space-y-2">
              {record.selectedIds.map((id, index) => (
                <li key={id} className="font-serif text-xl font-bold text-black">
                  <span>
                    {index + 1}. {movementName(id)}
                  </span>
                  {movementIsEssential(id) ? <EssentialTag /> : null}
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

function HealthScreenForm({
  initial,
  onSave,
}: {
  initial: HealthScreen | null
  onSave: (input: {
    osteoporosis: YesNo
    hipReplacement: YesNo
    pregnant: YesNo
    weeksPregnant: number | null
  }) => void
}) {
  const [osteoporosis, setOsteoporosis] = useState<YesNo | null>(initial?.osteoporosis ?? null)
  const [hipReplacement, setHipReplacement] = useState<YesNo | null>(initial?.hipReplacement ?? null)
  const [pregnant, setPregnant] = useState<YesNo | null>(initial?.pregnant ?? null)
  const [weeks, setWeeks] = useState(
    initial?.weeksPregnant === null || initial?.weeksPregnant === undefined ? '' : String(initial.weeksPregnant),
  )
  const weeksNumber = parseWeeksPregnant(weeks)
  const ready =
    osteoporosis !== null &&
    hipReplacement !== null &&
    pregnant !== null &&
    (pregnant === 'no' || weeksNumber !== null)

  return (
    <form
      className="mt-4"
      onSubmit={(event) => {
        event.preventDefault()
        if (!ready || !osteoporosis || !hipReplacement || !pregnant) return
        onSave({
          osteoporosis,
          hipReplacement,
          pregnant,
          weeksPregnant: pregnant === 'yes' ? weeksNumber : null,
        })
      }}
    >
      <YesNoField label={HEALTH_OSTEOPOROSIS} value={osteoporosis} onChange={setOsteoporosis} />
      <YesNoField label={HEALTH_HIP_REPLACEMENT} value={hipReplacement} onChange={setHipReplacement} />
      <YesNoField label={HEALTH_PREGNANT} value={pregnant} onChange={setPregnant} />
      {pregnant === 'yes' ? (
        <label className="glass-card mt-3 block px-4 py-4 text-sm font-bold text-black">
          {HEALTH_WEEKS}
          <input
            type="text"
            inputMode="numeric"
            autoComplete="off"
            value={weeks}
            onChange={(event) => setWeeks(event.target.value)}
            className="mt-2 min-h-11 w-full rounded-2xl border border-black/15 bg-white/75 px-3 text-base font-bold text-black"
          />
        </label>
      ) : null}
      <button
        type="submit"
        disabled={!ready}
        className="mt-4 w-full rounded-full bg-sage py-3 font-bold text-white disabled:opacity-40"
      >
        Save
      </button>
    </form>
  )
}

function YesNoField({
  label,
  value,
  onChange,
}: {
  label: string
  value: YesNo | null
  onChange: (value: YesNo) => void
}) {
  return (
    <div className="glass-card mt-3 px-4 py-4" role="group" aria-label={label}>
      <p className="text-sm font-bold text-black">{label}</p>
      <div className="mt-2 flex gap-2">
        <Choice pressed={value === 'yes'} onClick={() => onChange('yes')}>
          Yes
        </Choice>
        <Choice pressed={value === 'no'} onClick={() => onChange('no')}>
          No
        </Choice>
      </div>
    </div>
  )
}

function EssentialTag() {
  return (
    <span className="ml-2 inline-block rounded-full border border-black/30 bg-white/80 px-2 py-0.5 align-middle text-xs font-bold text-black">
      {ESSENTIAL_LABEL}
    </span>
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
