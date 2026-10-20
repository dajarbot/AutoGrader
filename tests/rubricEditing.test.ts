import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { AutoGraderDatabase } from '../src/main/database'
import { createServer } from '../src/main/server'
import type { ProviderStore } from '../src/main/providerStore'
import type { GradingWorker } from '../src/main/grading'
import { originalRubric, ORIGINAL_RUBRIC_KEY } from '../src/shared/originalRubric'
import { staarRubric } from '../src/shared/defaultTemplate'
import { validateAndNormalizeResult } from '../src/main/grading'
import { validateRubric } from '../src/shared/rubricValidation'

// SQLite is compiled for Electron. Run this suite with ELECTRON_RUN_AS_NODE=1.
describe.skipIf(!process.versions.electron)('rubric editing and assignment isolation', () => {
  let db: AutoGraderDatabase
  beforeEach(() => { db = new AutoGraderDatabase(':memory:') })
  afterEach(() => db.close())

  it('keeps the verbatim original separate from the legacy rubric', () => {
    const templates = db.listTemplates()
    expect(templates.find((t) => t.templateKey === ORIGINAL_RUBRIC_KEY)?.rubric).toEqual(originalRubric)
    expect(templates.find((t) => t.templateKey === 'staar-ecr-current')?.rubric).toEqual(staarRubric)
    expect(originalRubric.criteria[1]!.maxScore).toBe(2)
    expect(originalRubric.rules).toEqual([])
    const original = templates[0]!
    expect(() => db.saveRubricDraft(original.id, { ...original.rubric, name: 'Changed' })).toThrow('Only drafts')
    expect(() => db.createRubricDraft({ sourceId: original.id, newVersion: true })).toThrow('Create a copy')
  })

  it('saves incomplete drafts, validates publishing, and pins assignments to published versions', () => {
    const original = db.listTemplates()[0]!
    const draft = db.createRubricDraft({ sourceId: original.id })
    expect(draft.status).toBe('draft')
    expect(draft.templateKey).not.toBe(original.templateKey)
    const changed = structuredClone(draft.rubric)
    changed.name = 'Other test'
    changed.criteria[0]!.levels[0]!.descriptor = ''
    db.saveRubricDraft(draft.id, changed)
    expect(() => db.publishRubricDraft(draft.id)).toThrow('descriptor')
    expect(() => db.createAssignment({ name: 'Wrong', grade: 6, questionText: 'Task', templateVersionId: draft.id })).toThrow('published')
    changed.criteria[0]!.levels[0]!.descriptor = 'Custom top level.'
    db.saveRubricDraft(draft.id, changed)
    const published = db.publishRubricDraft(draft.id)
    const assignment = db.createAssignment({ name: 'Test', grade: 6, questionText: 'Task', templateVersionId: published.id })
    const revision = db.createRubricDraft({ sourceId: published.id, newVersion: true })
    expect(revision.version).toBe(2)
    expect(revision.templateKey).toBe(published.templateKey)
    db.saveRubricDraft(revision.id, { ...revision.rubric, name: 'Edited later' })
    db.publishRubricDraft(revision.id)
    expect(db.getAssignment(assignment.id)!.templateVersionId).toBe(published.id)
    expect(db.getTemplate(published.id)!.rubric).toEqual(changed)
    expect(db.getTemplate(original.id)!.rubric).toEqual(originalRubric)
    expect(() => db.saveRubricDraft(published.id, originalRubric)).toThrow('Only drafts')
    expect(db.createRubricDraft({ sourceId: published.id, newVersion: true }).version).toBe(3)
    const submission = db.addImportedSubmission({ assignmentId: assignment.id, sourcePath: 'test.pdf', sourceFileName: 'test.pdf', contentHash: 'test', grade: 6 }).submission
    db.approveSubmissionExtraction({ id: submission.id, studentName: 'Test Student', studentId: '1234567', grade: 6, reviewedText: 'A response for this test.' })
    db.enqueueReadySubmissions(assignment.id, 'mistral:latest')
    const work = db.claimNextGradingAttempt()!
    expect(work.rubric).toEqual(changed)
    db.completeGradingAttempt(work.attemptId, validateAndNormalizeResult({ criteria: changed.criteria.map((criterion) => ({ key: criterion.key, score: 1, comment: 'Evidence.' })), overallComment: 'Review.' }, changed))
    expect(db.getNextDraftScore(assignment.id)!.rubric).toEqual(changed)

  })

  it('enforces editing rules and payload validation through the authenticated API', async () => {
    const server = createServer(db, 'test-token', 'unused', {} as ProviderStore, {} as GradingWorker)
    const headers = { 'x-autograder-token': 'test-token' }
    try {
      expect((await server.inject({ method: 'POST', url: '/api/templates', payload: {} })).statusCode).toBe(401)
      const response = await server.inject({ method: 'POST', url: '/api/templates', headers, payload: {} })
      expect(response.statusCode).toBe(201)
      const { id } = response.json()
      expect((await server.inject({ method: 'POST', url: `/api/templates/${id}/publish`, headers })).statusCode).toBe(400)
      expect((await server.inject({ method: 'PUT', url: `/api/templates/${id}`, headers, payload: { name: 'bad' } })).statusCode).toBe(400)
      expect((await server.inject({ method: 'PUT', url: `/api/templates/${id}`, headers, payload: originalRubric })).statusCode).toBe(200)
      expect((await server.inject({ method: 'POST', url: `/api/templates/${id}/publish`, headers })).statusCode).toBe(200)
      expect((await server.inject({ method: 'PUT', url: `/api/templates/${id}`, headers, payload: originalRubric })).statusCode).toBe(400)
    } finally { await server.close() }
  })
})

describe('custom scoring', () => {
  it('does not impose the legacy zero rule on the verbatim original', () => {
    const result = validateAndNormalizeResult({ criteria: [
      { key: 'development_organization', score: 0, comment: 'No central idea.' },
      { key: 'conventions', score: 2, comment: 'Readable sentences.' }
    ], overallComment: 'Develop a central idea.' }, originalRubric)
    expect(result.totalScore).toBe(2)
  })

  it('rejects cyclic and out-of-range rules', () => {
    const rubric = structuredClone(staarRubric)
    rubric.rules.push({ type: 'force_score', when: { criterionKey: 'conventions', equals: 0 }, then: { criterionKey: 'development_organization', score: 0 }, explanation: 'Cycle' })
    expect(validateRubric(rubric).errors.join(' ')).toContain('cycle')
    rubric.rules = [{ type: 'force_score', when: { criterionKey: 'development_organization', equals: 4 }, then: { criterionKey: 'conventions', score: 3 }, explanation: 'Invalid' }]
    expect(validateRubric(rubric).errors.join(' ')).toContain('outside')
  })

  it('applies chained rules regardless of list order and excludes diagnostic traits from totals', () => {
    const rubric = structuredClone(staarRubric)
    rubric.criteria.push({ ...structuredClone(rubric.criteria[1]!), key: 'diagnostic', name: 'Diagnostic', includedInTotal: false })
    rubric.rules.unshift({ type: 'force_score', when: { criterionKey: 'conventions', equals: 0 }, then: { criterionKey: 'diagnostic', score: 0 }, explanation: 'Diagnostic follows conventions.' })
    expect(validateRubric(rubric).valid).toBe(true)
    const result = validateAndNormalizeResult({ criteria: rubric.criteria.map((c) => ({ key: c.key, score: c.key === 'development_organization' ? 0 : 2, comment: 'Evidence.' })), overallComment: 'Revise.' }, rubric)
    expect(result.criteria.map((c) => c.score)).toEqual([0, 0, 0])
    expect(result.maxTotalScore).toBe(5)
  })
})
