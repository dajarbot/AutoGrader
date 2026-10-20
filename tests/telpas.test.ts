import { afterEach, describe, expect, it } from 'vitest'
import { telpasRubric, TELPAS_RUBRIC_KEY } from '../src/shared/telpasRubric'
import { originalRubric } from '../src/shared/originalRubric'
import { validateRubric } from '../src/shared/rubricValidation'
import { rubricDraftSchema } from '../src/shared/rubricSchema'
import { buildOllamaRequest, gradingFingerprint, validateAndNormalizeResult } from '../src/main/grading'
import { AutoGraderDatabase } from '../src/main/database'
import { createServer } from '../src/main/server'
import type { ProviderStore } from '../src/main/providerStore'
import type { GradingWorker } from '../src/main/grading'
const result = (score: number) => ({ criteria: telpasRubric.criteria.map(c => ({ key: c.key, score, comment: 'Response evidence.' })), overallComment: 'Develop the explanation.' })

describe('TELPAS score ranges and notes', () => {
  it('accepts 1–4 descriptors without adding a zero and preserves legacy zero-based rubrics', () => {
    expect(validateRubric(telpasRubric)).toEqual({ valid: true, errors: [], maximumTotal: 12 })
    expect(validateRubric(originalRubric).valid).toBe(true)
    expect(rubricDraftSchema.parse(telpasRubric)).toEqual(telpasRubric)
    expect(validateAndNormalizeResult(result(1), telpasRubric).totalScore).toBe(3)
    expect(validateAndNormalizeResult(result(4), telpasRubric).totalScore).toBe(12)
    for (const score of [0, -1, 5, 1.5]) expect(() => validateAndNormalizeResult(result(score), telpasRubric)).toThrow()
  })
  it('rejects invalid minimums, missing levels, zero descriptors, and below-minimum rules', () => {
    for (const minimum of [-1, 1.5, 5, NaN]) {
      const rubric = structuredClone(telpasRubric); rubric.criteria[0]!.minScore = minimum
      expect(validateRubric(rubric).valid).toBe(false)
    }
    const rubric = structuredClone(telpasRubric)
    rubric.criteria[0]!.levels = rubric.criteria[0]!.levels.filter(l => l.score !== 2)
    expect(validateRubric(rubric).errors.join(' ')).toContain('missing the descriptor for score 2')
    rubric.criteria[0]!.levels.push({ score: 0, descriptor: 'Invalid' })
    rubric.rules.push({ type: 'force_score', when: { criterionKey: 'vocabulary', equals: 0 }, then: { criterionKey: 'usage', score: 0 }, explanation: 'Invalid zero rule.' })
    const errors = validateRubric(rubric).errors.join(' ')
    expect(errors).toContain('outside 1–4')
    expect(errors).toContain('Rule trigger score is outside')
    expect(errors).toContain('Rule result score is outside')
  })
  it('sends rubric-specific notes and score bounds to Ollama and fingerprints changes', () => {
    const item = { attemptId: 'a', submissionId: 's', modelName: 'mistral:latest', grade: 8 as const, assignmentMaterial: 'Prompt', responseText: 'Response', rubric: telpasRubric }
    const request = buildOllamaRequest(item)
    expect(request.messages[1]!.content).toContain(telpasRubric.scoringNotes)
    expect(request.messages[1]!.content).toContain('vocabulary: integers 1 through 4')
    const input = { model: item.modelName, assignmentMaterial: item.assignmentMaterial, response: item.responseText, rubric: telpasRubric }
    expect(gradingFingerprint(input)).not.toBe(gradingFingerprint({ ...input, rubric: { ...telpasRubric, scoringNotes: 'Changed notes.' } }))
  })
})

describe.skipIf(!process.versions.electron)('TELPAS persistence and teacher review', () => {
  let db: AutoGraderDatabase | undefined
  afterEach(() => db?.close())
  it('protects the baseline, preserves notes in copies, and rejects zero in teacher approvals', async () => {
    db = new AutoGraderDatabase(':memory:')
    const original = db.listTemplates().find(t => t.templateKey === TELPAS_RUBRIC_KEY)!
    expect(original.rubric).toEqual(telpasRubric)
    expect(() => db!.saveRubricDraft(original.id, original.rubric)).toThrow('Only drafts')
    expect(() => db!.createRubricDraft({ sourceId: original.id, newVersion: true })).toThrow('Create a copy')
    const copy = db.createRubricDraft({ sourceId: original.id })
    const edited = { ...copy.rubric, scoringNotes: 'Custom teacher notes.' }
    db.saveRubricDraft(copy.id, edited); db.publishRubricDraft(copy.id)
    expect(db.getTemplate(copy.id)!.rubric).toEqual(edited)
    expect(db.getTemplate(original.id)!.rubric).toEqual(telpasRubric)
    const assignment = db.createAssignment({ name: 'TELPAS test', grade: 8, questionText: 'Prompt', templateVersionId: copy.id })
    const submission = db.addImportedSubmission({ assignmentId: assignment.id, sourcePath: 'test.pdf', sourceFileName: 'test.pdf', contentHash: 'telpas', grade: 8 }).submission
    db.approveSubmissionExtraction({ id: submission.id, studentName: 'Test', studentId: '1234567', grade: 8, reviewedText: 'Student response.' })
    db.enqueueReadySubmissions(assignment.id, 'mistral:latest')
    const work = db.claimNextGradingAttempt()!
    expect(work.rubric.scoringNotes).toBe('Custom teacher notes.')
    db.completeGradingAttempt(work.attemptId, validateAndNormalizeResult(result(2), edited))
    const server = createServer(db, 'test-token', 'unused', {} as ProviderStore, {} as GradingWorker)
    try {
      const headers = { 'x-autograder-token': 'test-token' }
      const url = `/api/submissions/${submission.id}/score`
      expect((await server.inject({ method: 'PUT', url, headers, payload: result(0) })).statusCode).toBe(400)
      expect((await server.inject({ method: 'PUT', url, headers, payload: result(1) })).statusCode).toBe(200)
    } finally { await server.close() }
  })
})
