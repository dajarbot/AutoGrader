import { useEffect, useImperativeHandle, useState, type Ref } from 'react'
import type { CreateRubricDraftInput, RubricCriterion, RubricDefinition, ScoringRule, TemplateVersion } from '../../shared/contracts'
import { TELPAS_RUBRIC_KEY } from '../../shared/telpasRubric'
import { ORIGINAL_RUBRIC_KEY } from '../../shared/originalRubric'
import { validateRubric } from '../../shared/rubricValidation'
import { api } from './api'

export interface RubricLibraryHandle { saveBeforeLeave: () => Promise<void> }

export function RubricLibrary({ templates, onRefresh, ref }: { templates: TemplateVersion[]; onRefresh: () => Promise<void>; ref?: Ref<RubricLibraryHandle> }): React.JSX.Element {
  const [selectedId, setSelectedId] = useState(templates[0]?.id ?? '')
  const selected = templates.find((item) => item.id === selectedId) ?? templates[0]
  const [rubric, setRubric] = useState<RubricDefinition | null>(selected ? structuredClone(selected.rubric) : null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [showErrors, setShowErrors] = useState(false)
  useEffect(() => { setRubric(selected ? structuredClone(selected.rubric) : null); setShowErrors(false) }, [selected?.id])
  const protectedOriginal = selected && [ORIGINAL_RUBRIC_KEY, TELPAS_RUBRIC_KEY].includes(selected.templateKey)
  const editable = selected?.status === 'draft'
  const dirty = editable && JSON.stringify(rubric) !== JSON.stringify(selected?.rubric)
  const validation = rubric ? validateRubric(rubric) : null

  async function savePending(): Promise<void> {
    if (dirty && selected && rubric) await api.saveRubric(selected.id, rubric)
  }
  useImperativeHandle(ref, () => ({ saveBeforeLeave: async () => {
    if (busy) throw new Error('Wait for the rubric to finish saving.')
    await savePending()
    await onRefresh()
  } }))
  async function run(action: () => Promise<void>): Promise<void> {
    try { setBusy(true); setError(''); setNotice(''); await action() }
    catch (cause) { setError(cause instanceof Error ? cause.message : 'Rubric could not be saved.') }
    finally { setBusy(false) }
  }
  async function choose(id: string): Promise<void> {
    await run(async () => { await savePending(); await onRefresh(); setSelectedId(id) })
  }
  async function create(input: CreateRubricDraftInput): Promise<void> {
    await run(async () => {
      await savePending()
      const created = await api.createRubric(input)
      await onRefresh(); setSelectedId(created.id); setRubric(created.rubric)
      setNotice('Draft created. Edit it, then publish when it is ready for assignments.')
    })
  }
  async function save(publish: boolean): Promise<void> {
    if (!selected || !rubric) return
    setShowErrors(publish)
    if (publish && !validation?.valid) return
    await run(async () => {
      await api.saveRubric(selected.id, rubric)
      if (publish) await api.publishRubric(selected.id)
      await onRefresh()
      setNotice(publish ? 'Published. Choose this rubric version when creating a new assignment.' : 'Draft saved.')
    })
  }
  function updateCriterion(index: number, patch: Partial<RubricCriterion>): void {
    if (!rubric) return
    const criteria = rubric.criteria.map((item, i) => i === index ? { ...item, ...patch } : item)
    const rules = rubric.rules.map((rule) => ({ ...rule, explanation: `If ${criteria.find((item) => item.key === rule.when.criterionKey)?.name || 'Unnamed criterion'} is ${rule.when.equals}, ${criteria.find((item) => item.key === rule.then.criterionKey)?.name || 'Unnamed criterion'} must be ${rule.then.score}.` }))
    setRubric({ ...rubric, criteria, rules })
  }
  function updateRange(index: number, minimum: number, maximum: number): void {
    const criterion = rubric!.criteria[index]!
    const maxScore = Math.min(20, Math.max(0, Math.trunc(maximum || 0)))
    const minScore = Math.min(maxScore, Math.max(0, Math.trunc(minimum || 0)))
    updateCriterion(index, { minScore, maxScore, levels: Array.from({ length: maxScore - minScore + 1 }, (_, i) => {
      const score = maxScore - i
      return { score, descriptor: criterion.levels.find((level) => level.score === score)?.descriptor ?? '' }
    }) })
  }
  function removeCriterion(index: number): void {
    const key = rubric!.criteria[index]!.key
    setRubric({ ...rubric!, criteria: rubric!.criteria.filter((_, i) => i !== index), rules: rubric!.rules.filter((rule) => rule.when.criterionKey !== key && rule.then.criterionKey !== key) })
  }
  function updateRule(index: number, patch: Partial<ScoringRule>): void {
    setRubric((current) => {
      if (!current) return current
      const rules = current.rules.map((rule, i) => {
        if (i !== index) return rule
        const next = { ...rule, ...patch }
        const name = (key: string) => current.criteria.find((criterion) => criterion.key === key)?.name || 'Unnamed criterion'
        next.explanation = `If ${name(next.when.criterionKey)} is ${next.when.equals}, ${name(next.then.criterionKey)} must be ${next.then.score}.`
        return next
      })
      return { ...current, rules }
    })
  }
  return <div className="page rubric-library">
    <header className="page-header"><div><p className="eyebrow">Reusable rubrics</p><h1>Rubric library</h1><p>Keep the original, experiment with copies, and publish versions for different tests.</p></div>
      <button className="primary-button" disabled={busy} onClick={() => void create({})}>＋ New rubric</button></header>
    {error && <div className="error-banner" role="alert">{error}</div>}
    {notice && <div className="success-banner compact" role="status">{notice}</div>}
    <div className="template-layout">
      <aside className="panel template-list-panel"><div className="panel-heading compact"><h2>Your rubrics</h2></div><div className="template-list">
        {templates.map((template) => <button key={template.id} disabled={busy} className={template.id === selected?.id ? 'selected' : ''} onClick={() => void choose(template.id)}>
          <strong>{template.name || 'Untitled draft'}</strong><span>Version {template.version} · {template.status}{[ORIGINAL_RUBRIC_KEY, TELPAS_RUBRIC_KEY].includes(template.templateKey) ? ' · Protected original' : template.templateKey === 'staar-ecr-current' ? ' · Legacy wording' : ''}</span>
        </button>)}
      </div><p className="rubric-library-note">Draft changes save when you switch rubrics. Draft changes also save when you return to the workflow.</p></aside>
      {selected && rubric && <section className="panel template-detail">
        <div className="template-detail-header"><div><span className={`status-pill ${selected.status}`}>{selected.status} · v{selected.version}</span><h2>{rubric.name || 'Untitled rubric'}</h2><p>Maximum total: {validation?.maximumTotal} points</p></div>
          <div className="rubric-actions"><button className="secondary-button" disabled={busy} onClick={() => void create({ sourceId: selected.id })}>Make a copy</button>
            {!editable && !protectedOriginal && <button className="secondary-button" disabled={busy} onClick={() => void create({ sourceId: selected.id, newVersion: true })}>Edit new version</button>}
          </div>
        </div>
        {!editable && <p className="rubric-explanation">{protectedOriginal ? 'This original rubric is protected. Make a copy to experiment with descriptors or scoring notes.' : 'Published versions stay fixed. Existing assignments keep the version they were created with.'}</p>}
        {editable && <label className="rubric-name">Rubric name<input value={rubric.name} maxLength={160} disabled={busy} onChange={(event) => setRubric({ ...rubric, name: event.target.value })} /></label>}
        <section className="rubric-notes"><h3>Scoring notes</h3><p>Additional guidance sent to the model with this rubric. These notes are separate from the score descriptors.</p>
          {editable ? <textarea aria-label="Scoring notes" rows={8} maxLength={12000} disabled={busy} value={rubric.scoringNotes ?? ''} onChange={(event) => setRubric({ ...rubric, scoringNotes: event.target.value })} /> : <p style={{ whiteSpace: 'pre-wrap' }}>{rubric.scoringNotes || 'No additional scoring notes.'}</p>}
        </section>
        {showErrors && validation && !validation.valid && <div className="form-error" role="alert"><strong>Before publishing:</strong><ul>{validation.errors.map((message, i) => <li key={i}>{message}</li>)}</ul></div>}
        <div className="rubric-criteria">
          {rubric.criteria.map((criterion, index) => <article className="criterion-card" key={criterion.key}>
            {editable ? <div className="rubric-criterion-heading">
              <label>Criterion name<input value={criterion.name} maxLength={160} disabled={busy} onChange={(event) => updateCriterion(index, { name: event.target.value })} /></label>
              <label>Minimum points<input type="number" min={0} max={criterion.maxScore} value={criterion.minScore ?? 0} disabled={busy} onChange={(event) => updateRange(index, Number(event.target.value), criterion.maxScore)} /></label>
              <label>Maximum points<input type="number" min={0} max={20} value={criterion.maxScore} disabled={busy} onChange={(event) => updateRange(index, criterion.minScore ?? 0, Number(event.target.value))} /></label>
              <label className="rubric-check"><input type="checkbox" checked={criterion.includedInTotal} disabled={busy} onChange={(event) => updateCriterion(index, { includedInTotal: event.target.checked })} />Count in total</label>
              <button className="quiet-button" disabled={busy} onClick={() => removeCriterion(index)}>Remove criterion</button>
            </div> : <div><h3>{criterion.name}</h3><span>{criterion.minScore ?? 0}–{criterion.maxScore} points{criterion.includedInTotal ? '' : ' · Not included in total'}</span></div>}
            {[...criterion.levels].sort((a, b) => b.score - a.score).map((level) => <div className="rubric-level" key={level.score}>
              {editable ? <label>Score {level.score}<textarea aria-label={`${criterion.name || `Criterion ${index + 1}`} score ${level.score}`} rows={3} value={level.descriptor} maxLength={4000} disabled={busy} onChange={(event) => updateCriterion(index, { levels: criterion.levels.map((item) => item.score === level.score ? { ...item, descriptor: event.target.value } : item) })} placeholder="Describe the evidence required for this score." /></label>
                : <><strong>Score {level.score}</strong><p>{level.descriptor}</p></>}
            </div>)}
          </article>)}
        </div>
        {editable && <button className="secondary-button" disabled={busy || rubric.criteria.length >= 20} onClick={() => setRubric({ ...rubric, criteria: [...rubric.criteria, {
          key: `criterion_${crypto.randomUUID().slice(0, 8)}`, name: '', maxScore: 2, includedInTotal: true,
          levels: [2, 1, 0].map((score) => ({ score, descriptor: '' }))
        }] })}>＋ Add criterion</button>}
        <section className="rubric-rules"><h3>Conditional scoring rules</h3><p>Optional: when one criterion receives a particular score, set another criterion’s score. Changes apply during grading and review.</p>
          {!rubric.rules.length && <p>No conditional scoring rules.</p>}
          {rubric.rules.map((rule, index) => editable ? <div className="rubric-rule" key={index}>
            <label>If criterion<select aria-label={`Rule ${index + 1} source criterion`} disabled={busy} value={rule.when.criterionKey} onChange={(event) => updateRule(index, { when: { criterionKey: event.target.value, equals: rubric.criteria.find((item) => item.key === event.target.value)?.minScore ?? 0 } })}>{rubric.criteria.map((item) => <option key={item.key} value={item.key}>{item.name || 'Unnamed criterion'}</option>)}</select></label>
            <label>Equals<input disabled={busy} type="number" min={rubric.criteria.find((item) => item.key === rule.when.criterionKey)?.minScore ?? 0} max={rubric.criteria.find((item) => item.key === rule.when.criterionKey)?.maxScore ?? 20} value={rule.when.equals} onChange={(event) => updateRule(index, { when: { ...rule.when, equals: Math.min(20, Math.max(0, Math.trunc(Number(event.target.value)))) } })} /></label>
            <label>Set criterion<select aria-label={`Rule ${index + 1} target criterion`} disabled={busy} value={rule.then.criterionKey} onChange={(event) => updateRule(index, { then: { criterionKey: event.target.value, score: rubric.criteria.find((item) => item.key === event.target.value)?.minScore ?? 0 } })}>{rubric.criteria.map((item) => <option key={item.key} value={item.key}>{item.name || 'Unnamed criterion'}</option>)}</select></label>
            <label>To score<input disabled={busy} type="number" min={rubric.criteria.find((item) => item.key === rule.then.criterionKey)?.minScore ?? 0} max={rubric.criteria.find((item) => item.key === rule.then.criterionKey)?.maxScore ?? 20} value={rule.then.score} onChange={(event) => updateRule(index, { then: { ...rule.then, score: Math.min(20, Math.max(0, Math.trunc(Number(event.target.value)))) } })} /></label>
            <button className="quiet-button" disabled={busy} onClick={() => setRubric({ ...rubric, rules: rubric.rules.filter((_, i) => i !== index) })}>Remove rule</button>
          </div> : <p key={index}>{rule.explanation}</p>)}
          {editable && <button className="secondary-button" disabled={busy || rubric.criteria.length < 2 || rubric.rules.length >= 20} onClick={() => {
            const source = rubric.criteria[0]!, target = rubric.criteria[1]!
            setRubric({ ...rubric, rules: [...rubric.rules, { type: 'force_score', when: { criterionKey: source.key, equals: source.minScore ?? 0 }, then: { criterionKey: target.key, score: target.minScore ?? 0 }, explanation: `If ${source.name} is ${source.minScore ?? 0}, ${target.name} must be ${target.minScore ?? 0}.` }] })
          }}>＋ Add scoring rule</button>}
        </section>
        {editable && <div className="rubric-save-bar"><span>{dirty ? 'Unsaved changes' : 'Draft saved'} · Publish to use in a new assignment.</span><button className="secondary-button" disabled={busy} onClick={() => void save(false)}>Save draft</button><button className="primary-button" disabled={busy} onClick={() => void save(true)}>{busy ? 'Saving…' : 'Publish version'}</button></div>}
      </section>}
    </div>
  </div>
}
