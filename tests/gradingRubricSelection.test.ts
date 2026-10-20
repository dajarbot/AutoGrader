import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { AutoGraderDatabase } from '../src/main/database'
import { validateAndNormalizeResult } from '../src/main/grading'
import { createServer } from '../src/main/server'
import type { ProviderStore } from '../src/main/providerStore'
import type { GradingWorker } from '../src/main/grading'

describe.skipIf(!process.versions.electron)('grading-stage rubric selection', () => {
  let db: AutoGraderDatabase
  beforeEach(() => { db = new AutoGraderDatabase(':memory:') })
  afterEach(() => db.close())
  function fixture() {
    const [original, other] = db.listTemplates()
    const assignment = db.createAssignment({ name: 'Compare tests', grade: 6, questionText: 'Explain the idea.', templateVersionId: original!.id })
    const root = db.addImportedSubmission({ assignmentId: assignment.id, sourcePath: 'managed.pdf', sourceFileName: 'packet.pdf', contentHash: 'hash', grade: 6 }).submission
    db.replaceDocumentExtraction({ rootSubmissionId: root.id, students: [{ studentName: 'Example Student', studentId: '1234567', rawText: 'Original', reviewedText: 'A reviewed response with evidence.', pageNumber: 2, pageEndNumber: 4, status: 'extracted', issueMessage: null }] })
    db.acceptCleanExtractions(assignment.id)
    return { assignment, original: original!, other: other!, root }
  }
  it('changes an ungraded assignment in place and queues with the selected rubric', () => {
    const { assignment, other, root } = fixture()
    const result = db.selectGradingRubric(assignment.id, other.id)
    expect(result.createdNewRun).toBe(false)
    expect(result.assignment.id).toBe(assignment.id)
    expect(result.assignment.templateVersionId).toBe(other.id)
    expect(db.listSubmissions(assignment.id)[0]!.id).toBe(root.id)
    db.enqueueReadySubmissions(assignment.id, 'mistral:latest')
    expect(db.claimNextGradingAttempt()!.rubric).toEqual(other.rubric)
  })
  it('blocks changes while queued or running, and rejects drafts and unknown versions', () => {
    const { assignment, other } = fixture()
    expect(() => db.selectGradingRubric(assignment.id, 'missing')).toThrow('published')
    const draft = db.createRubricDraft({})
    expect(() => db.selectGradingRubric(assignment.id, draft.id)).toThrow('published')
    db.enqueueReadySubmissions(assignment.id, 'mistral:latest')
    expect(() => db.selectGradingRubric(assignment.id, other.id)).toThrow('Stop queued')
    db.claimNextGradingAttempt()
    expect(() => db.selectGradingRubric(assignment.id, other.id)).toThrow('Stop queued')
    expect(db.listAssignments()).toHaveLength(1)
  })
  it('keeps approved results in the old run and copies full reviewed responses into a fresh run', () => {
    const { assignment, original, other, root } = fixture()
    db.enqueueReadySubmissions(assignment.id, 'mistral:latest')
    const work = db.claimNextGradingAttempt()!
    const score = validateAndNormalizeResult({ criteria: original.rubric.criteria.map((criterion) => ({ key: criterion.key, score: 1, comment: 'Evidence.' })), overallComment: 'Review.' }, original.rubric)
    db.completeGradingAttempt(work.attemptId, score)
    db.approveDraftScore(root.id, score)
    const unchanged = db.selectGradingRubric(assignment.id, original.id)
    expect(unchanged.createdNewRun).toBe(false)
    const result = db.selectGradingRubric(assignment.id, other.id)
    expect(result.createdNewRun).toBe(true)
    expect(result.assignment.id).not.toBe(assignment.id)
    expect(result.assignment.templateVersionId).toBe(other.id)
    expect(db.getAssignment(assignment.id)!.templateVersionId).toBe(original.id)
    expect(db.exportScoreData(assignment.id, 'approved').rows).toHaveLength(1)
    expect(db.exportScoreData(result.assignment.id, 'all_scored').rows).toHaveLength(0)
    expect(db.listSubmissions(result.assignment.id)[0]).toMatchObject({ studentName: 'Example Student', studentId: '1234567', sourcePath: 'managed.pdf', pageNumber: 2, pageEndNumber: 4, rawText: 'Original', reviewedText: 'A reviewed response with evidence.', status: 'ready', issueMessage: null })
    expect(db.listSubmissions(result.assignment.id)[0]!.id).not.toBe(root.id)
    db.enqueueReadySubmissions(result.assignment.id, 'mistral:latest')
    expect(db.claimNextGradingAttempt()!.rubric).toEqual(other.rubric)
  })
  it('authenticates and validates the selection endpoint', async () => {
    const { assignment, other } = fixture()
    const server = createServer(db, 'test', 'unused', {} as ProviderStore, {} as GradingWorker)
    const url = `/api/assignments/${assignment.id}/grading/rubric`
    const headers = { 'x-autograder-token': 'test' }
    try {
      expect((await server.inject({ method: 'PUT', url, payload: { templateVersionId: other.id } })).statusCode).toBe(401)
      expect((await server.inject({ method: 'PUT', url, headers, payload: {} })).statusCode).toBe(400)
      const result = await server.inject({ method: 'PUT', url, headers, payload: { templateVersionId: other.id } })
      expect(result.statusCode).toBe(200)
      expect(result.json().assignment.templateVersionId).toBe(other.id)
    } finally { await server.close() }
  })
})
