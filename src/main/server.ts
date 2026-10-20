import { createHash, timingSafeEqual } from 'node:crypto'
import { createReadStream } from 'node:fs'
import { copyFile, mkdir, open } from 'node:fs/promises'
import { basename, extname, join } from 'node:path'
import Fastify, { type FastifyInstance } from 'fastify'
import { z } from 'zod'
import { rubricDraftSchema } from '../shared/rubricSchema'
import type { ExtractionBatchResult, ImportPdfResult } from '../shared/contracts'
import type { AutoGraderDatabase } from './database'
import { extractStudentPdf, renderPdfPage } from './extraction'
import { validateAndNormalizeResult, type GradingWorker } from './grading'
import type { ProviderStore } from './providerStore'

const assignmentSchema = z.object({
  name: z.string().trim().min(1).max(160),
  grade: z.union([z.literal(6), z.literal(7), z.literal(8)]),
  questionText: z.string().trim().min(1).max(20_000),
  templateVersionId: z.uuid()
})

const importSchema = z.object({
  paths: z.array(z.string().min(1)).min(1).max(500)
})

const reviewExtractionSchema = z.object({
  studentName: z.string().trim().min(1).max(200),
  studentId: z.string().trim().regex(/^[A-Za-z]?\d{5,15}$/, 'Student ID must contain 5–15 digits, with an optional leading letter.'),
  grade: z.union([z.literal(6), z.literal(7), z.literal(8)]),
  reviewedText: z.string().trim().min(1, 'Response text is required.').max(250_000)
})

const providerSchema = z.object({
  model: z.string().trim().min(1).max(200)
})

const scoreReviewSchema = z.object({
  criteria: z.array(z.object({
    key: z.string().trim().min(1).max(100),
    score: z.number().int().min(0).max(20),
    comment: z.string().trim().min(1).max(2_000)
  })).min(1).max(20),
  overallComment: z.string().trim().min(1).max(4_000)
})

export function createServer(
  database: AutoGraderDatabase,
  token: string,
  fileStorageRoot: string,
  providerStore: ProviderStore,
  gradingWorker: GradingWorker
): FastifyInstance {
  const app = Fastify({ logger: false, bodyLimit: 2 * 1024 * 1024 })
  const pagePreviewCache = new Map<string, { dataUrl: string; width: number; height: number }>()

  app.addHook('onRequest', async (request, reply) => {
    reply.header('access-control-allow-origin', '*')
    reply.header('access-control-allow-methods', 'GET,POST,PUT,OPTIONS')
    reply.header('access-control-allow-headers', 'content-type,x-autograder-token')
    if (request.method === 'OPTIONS') return reply.code(204).send()

    const supplied = request.headers['x-autograder-token']
    if (typeof supplied !== 'string' || !tokensMatch(supplied, token)) {
      return reply.code(401).send({ error: 'Unauthorized' })
    }
  })

  app.get('/health', async () => ({ status: 'ok' }))
  app.get('/api/dashboard', async () => database.dashboard())
  app.get('/api/templates', async () => database.listTemplates())
  app.post('/api/templates', async (request, reply) => {
    const parsed = z.object({ sourceId: z.uuid().optional(), newVersion: z.boolean().optional() }).safeParse(request.body)
    if (!parsed.success) return reply.code(400).send({ error: 'Invalid rubric source.' })
    try { return reply.code(201).send(database.createRubricDraft(parsed.data)) }
    catch (error) { return reply.code(400).send({ error: error instanceof Error ? error.message : 'Could not create rubric.' }) }
  })
  app.put('/api/templates/:id', async (request, reply) => {
    const parsed = rubricDraftSchema.safeParse(request.body)
    if (!parsed.success) return reply.code(400).send({ error: 'Invalid rubric. Use up to 20 criteria, scores from 0 to 20, and descriptors up to 4,000 characters.' })
    try { return database.saveRubricDraft((request.params as { id: string }).id, parsed.data) }
    catch (error) { return reply.code(400).send({ error: error instanceof Error ? error.message : 'Could not save rubric.' }) }
  })
  app.post('/api/templates/:id/publish', async (request, reply) => {
    try { return database.publishRubricDraft((request.params as { id: string }).id) }
    catch (error) { return reply.code(400).send({ error: error instanceof Error ? error.message : 'Could not publish rubric.' }) }
  })
  app.get('/api/assignments', async () => database.listAssignments())
  app.get('/api/provider', async () => providerStore.status())

  app.put('/api/provider', async (request, reply) => {
    const parsed = providerSchema.safeParse(request.body)
    if (!parsed.success) return reply.code(400).send({ error: 'Choose an installed Ollama model.' })
    try {
      const status = await providerStore.save(parsed.data)
      return status
    } catch (error) {
      return reply.code(400).send({ error: error instanceof Error ? error.message : 'Provider settings could not be saved.' })
    }
  })

  app.get('/api/assignments/:id', async (request, reply) => {
    const { id } = request.params as { id: string }
    const assignment = database.getAssignment(id)
    if (!assignment) return reply.code(404).send({ error: 'Assignment not found.' })
    return { assignment, submissions: database.listSubmissions(id) }
  })

  app.post('/api/assignments', async (request, reply) => {
    const parsed = assignmentSchema.safeParse(request.body)
    if (!parsed.success) {
      return reply.code(400).send({
        error: 'Assignment details are incomplete.',
        details: parsed.error.issues.map((issue) => issue.message)
      })
    }

    try {
      const assignment = database.createAssignment(parsed.data)
      return reply.code(201).send(assignment)
    } catch (error) {
      return reply.code(400).send({ error: error instanceof Error ? error.message : 'Unable to create assignment.' })
    }
  })

  app.post('/api/assignments/:id/submissions/import', async (request, reply) => {
    const { id } = request.params as { id: string }
    const assignment = database.getAssignment(id)
    if (!assignment) return reply.code(404).send({ error: 'Assignment not found.' })

    const parsed = importSchema.safeParse(request.body)
    if (!parsed.success) return reply.code(400).send({ error: 'Select at least one PDF file.' })

    const result: ImportPdfResult = {
      imported: 0,
      duplicates: 0,
      rejected: [],
      submissions: []
    }
    const assignmentDirectory = join(fileStorageRoot, id)
    await mkdir(assignmentDirectory, { recursive: true })

    for (const sourcePath of parsed.data.paths) {
      try {
        if (extname(sourcePath).toLowerCase() !== '.pdf') throw new Error('not a PDF file')
        if (!(await hasPdfSignature(sourcePath))) throw new Error('the file does not contain a PDF signature')

        const contentHash = await hashFile(sourcePath)
        const managedPath = join(assignmentDirectory, `${contentHash}.pdf`)
        await copyFile(sourcePath, managedPath)
        const inserted = database.addImportedSubmission({
          assignmentId: id,
          sourcePath: managedPath,
          sourceFileName: basename(sourcePath),
          contentHash,
          grade: assignment.grade
        })
        if (inserted.inserted) {
          result.imported += 1
          await extractOne(database, inserted.submission.id, managedPath)
        } else result.duplicates += 1
      } catch (error) {
        result.rejected.push(`${basename(sourcePath)}: ${error instanceof Error ? error.message : 'could not be imported'}`)
      }
    }

    result.submissions = database.listSubmissions(id)
    return reply.code(result.imported ? 201 : 200).send(result)
  })

  app.post('/api/assignments/:id/submissions/extract', async (request, reply) => {
    const { id } = request.params as { id: string }
    if (!database.getAssignment(id)) return reply.code(404).send({ error: 'Assignment not found.' })

    const allSubmissions = database.listSubmissions(id)
    const sourceGroups = new Map<string, typeof allSubmissions>()
    for (const submission of allSubmissions) {
      const group = sourceGroups.get(submission.sourceDocumentHash) ?? []
      group.push(submission)
      sourceGroups.set(submission.sourceDocumentHash, group)
    }
    const candidateGroups = new Map<string, (typeof allSubmissions)[number]>()
    for (const submission of allSubmissions) {
      const needsExtraction = ['imported', 'extracted', 'extraction_problem'].includes(submission.status)
      const isLegacyCombinedExtraction = submission.status === 'ready' && submission.pageNumber === null
      if (!needsExtraction && !isLegacyCombinedExtraction) continue
      const group = sourceGroups.get(submission.sourceDocumentHash) ?? []
      if (group.some((item) => !['imported', 'extracted', 'extraction_problem'].includes(item.status))) continue
      const current = candidateGroups.get(submission.sourceDocumentHash)
      if (!current || submission.studentIndex < current.studentIndex) {
        candidateGroups.set(submission.sourceDocumentHash, submission)
      }
    }
    const candidates = [...candidateGroups.values()]
    const result: ExtractionBatchResult = { extracted: 0, needsReview: 0, skipped: 0, submissions: [] }
    for (const submission of candidates) {
      const status = await extractOne(database, submission.id, submission.sourcePath)
      if (status === 'extracted') result.extracted += 1
      else result.needsReview += 1
    }
    result.skipped = allSubmissions.filter((submission) => submission.status === 'ready' && submission.pageNumber !== null).length
    result.submissions = database.listSubmissions(id)
    return result
  })

  app.post('/api/assignments/:id/submissions/accept-clean', async (request, reply) => {
    const { id } = request.params as { id: string }
    if (!database.getAssignment(id)) return reply.code(404).send({ error: 'Assignment not found.' })
    const accepted = database.acceptCleanExtractions(id)
    return { accepted, submissions: database.listSubmissions(id) }
  })

  app.get('/api/assignments/:id/grading', async (request, reply) => {
    const { id } = request.params as { id: string }
    if (!database.getAssignment(id)) return reply.code(404).send({ error: 'Assignment not found.' })
    return database.gradingQueueSummary(id)
  })

  app.put('/api/assignments/:id/grading/rubric', async (request, reply) => {
    const { id } = request.params as { id: string }
    if (!database.getAssignment(id)) return reply.code(404).send({ error: 'Assignment not found.' })
    const parsed = z.object({ templateVersionId: z.uuid() }).safeParse(request.body)
    if (!parsed.success) return reply.code(400).send({ error: 'Choose a published rubric version.' })
    try { return database.selectGradingRubric(id, parsed.data.templateVersionId) }
    catch (error) { return reply.code(409).send({ error: error instanceof Error ? error.message : 'Could not change rubric.' }) }
  })

  app.post('/api/assignments/:id/grading/start', async (request, reply) => {
    const { id } = request.params as { id: string }
    if (!database.getAssignment(id)) return reply.code(404).send({ error: 'Assignment not found.' })
    const provider = await providerStore.status()
    if (!provider.configured) return reply.code(409).send({ error: 'Open Ollama and select an installed model before starting grading.' })
    const queued = database.enqueueReadySubmissions(id, provider.model)
    gradingWorker.wake()
    return { queued, summary: database.gradingQueueSummary(id) }
  })

  app.post('/api/assignments/:id/grading/start-all', async (request, reply) => {
    const { id } = request.params as { id: string }
    if (!database.getAssignment(id)) return reply.code(404).send({ error: 'Assignment not found.' })
    const provider = await providerStore.status()
    if (!provider.configured) return reply.code(409).send({ error: 'Open Ollama and select an installed model before starting grading.' })
    const queued = database.enqueueAllReadySubmissions(id, provider.model)
    gradingWorker.wake()
    return { queued, summary: database.gradingQueueSummary(id) }
  })

  app.post('/api/assignments/:id/grading/retry', async (request, reply) => {
    const { id } = request.params as { id: string }
    if (!database.getAssignment(id)) return reply.code(404).send({ error: 'Assignment not found.' })
    const provider = await providerStore.status()
    if (!provider.configured) return reply.code(409).send({ error: 'Open Ollama and select an installed model before retrying grading.' })
    const queued = database.retryFailedSubmissions(id, provider.model)
    gradingWorker.wake()
    return { queued, summary: database.gradingQueueSummary(id) }
  })

  app.post('/api/assignments/:id/grading/cancel', async (request, reply) => {
    const { id } = request.params as { id: string }
    if (!database.getAssignment(id)) return reply.code(404).send({ error: 'Assignment not found.' })
    const cancelled = database.cancelPendingGrading(id)
    return { cancelled, summary: database.gradingQueueSummary(id) }
  })

  app.get('/api/assignments/:id/grading/draft', async (request, reply) => {
    const { id } = request.params as { id: string }
    if (!database.getAssignment(id)) return reply.code(404).send({ error: 'Assignment not found.' })
    return { draft: database.getNextDraftScore(id) }
  })

  app.put('/api/submissions/:id/score', async (request, reply) => {
    const { id } = request.params as { id: string }
    const parsed = scoreReviewSchema.safeParse(request.body)
    if (!parsed.success) return reply.code(400).send({ error: 'Every rubric score and comment is required.' })
    const submission = database.getSubmission(id)
    if (!submission) return reply.code(404).send({ error: 'Submission not found.' })
    const assignment = database.getAssignment(submission.assignmentId)
    const template = assignment ? database.getTemplate(assignment.templateVersionId) : null
    if (!template) return reply.code(404).send({ error: 'The assignment rubric could not be loaded.' })
    try {
      const result = validateAndNormalizeResult(parsed.data, template.rubric)
      database.approveDraftScore(id, result)
      return { result, summary: database.gradingQueueSummary(submission.assignmentId) }
    } catch (error) {
      return reply.code(400).send({ error: error instanceof Error ? error.message : 'The draft score could not be approved.' })
    }
  })

  app.get('/api/submissions/:id/page-preview', async (request, reply) => {
    const { id } = request.params as { id: string }
    const submission = database.getSubmission(id)
    if (!submission) return reply.code(404).send({ error: 'Submission not found.' })
    if (!submission.pageNumber) return reply.code(409).send({ error: 'This submission is not linked to a PDF page.' })

    const query = z.object({ page: z.coerce.number().int().optional() }).safeParse(request.query)
    if (!query.success) return reply.code(400).send({ error: 'Invalid page number.' })
    const pageNumber = query.data.page ?? submission.pageNumber
    if (pageNumber < submission.pageNumber || pageNumber > (submission.pageEndNumber ?? submission.pageNumber)) {
      return reply.code(400).send({ error: 'Page is outside this student response.' })
    }
    const cacheKey = `${submission.sourcePath}:${pageNumber}`
    let preview = pagePreviewCache.get(cacheKey)
    if (!preview) {
      try {
        preview = await renderPdfPage(submission.sourcePath, pageNumber)
        pagePreviewCache.set(cacheKey, preview)
        if (pagePreviewCache.size > 24) {
          const oldest = pagePreviewCache.keys().next().value
          if (oldest) pagePreviewCache.delete(oldest)
        }
      } catch (error) {
        return reply.code(422).send({ error: error instanceof Error ? error.message : 'The PDF page could not be rendered.' })
      }
    }
    return { ...preview, pageNumber, sourceFileName: submission.sourceFileName }
  })

  app.put('/api/submissions/:id/extraction', async (request, reply) => {
    const { id } = request.params as { id: string }
    const parsed = reviewExtractionSchema.safeParse(request.body)
    if (!parsed.success) {
      return reply.code(400).send({
        error: 'Review the required extraction fields.',
        details: parsed.error.issues.map((issue) => issue.message)
      })
    }
    try {
      return database.approveSubmissionExtraction({ id, ...parsed.data })
    } catch (error) {
      return reply.code(404).send({ error: error instanceof Error ? error.message : 'Submission not found.' })
    }
  })

  return app
}

async function extractOne(
  database: AutoGraderDatabase,
  submissionId: string,
  path: string
): Promise<'extracted' | 'extraction_problem'> {
  try {
    const extractedPages = await extractStudentPdf(path)
    const students = extractedPages.map((extracted) => {
      const blockingIssues = extracted.issues.filter((issue) =>
        issue.includes('No student response') ||
        issue.includes('unusually short') ||
        issue.includes('Student name') ||
        issue.includes('Student ID') ||
        issue.includes('marker was not found')
      )
      return {
        studentName: extracted.studentName,
        studentId: extracted.studentId,
        rawText: extracted.rawText,
        reviewedText: extracted.responseText,
        pageNumber: extracted.pageNumber,
        pageEndNumber: extracted.pageEndNumber,
        status: blockingIssues.length ? 'extraction_problem' as const : 'extracted' as const,
        issueMessage: extracted.issues.length ? extracted.issues.join(' ') : null
      }
    })
    database.replaceDocumentExtraction({ rootSubmissionId: submissionId, students })
    return students.some((student) => student.status === 'extraction_problem') ? 'extraction_problem' : 'extracted'
  } catch (error) {
    database.updateSubmissionExtraction({
      id: submissionId,
      studentName: null,
      studentId: null,
      rawText: '',
      reviewedText: '',
      status: 'extraction_problem',
      issueMessage: error instanceof Error ? error.message : 'PDF text extraction failed.'
    })
    return 'extraction_problem'
  }
}

async function hasPdfSignature(path: string): Promise<boolean> {
  const file = await open(path, 'r')
  try {
    const buffer = Buffer.alloc(5)
    const { bytesRead } = await file.read(buffer, 0, 5, 0)
    return bytesRead === 5 && buffer.toString('ascii') === '%PDF-'
  } finally {
    await file.close()
  }
}

async function hashFile(path: string): Promise<string> {
  const hash = createHash('sha256')
  for await (const chunk of createReadStream(path)) hash.update(chunk)
  return hash.digest('hex')
}

function tokensMatch(supplied: string, expected: string): boolean {
  const suppliedBuffer = Buffer.from(supplied)
  const expectedBuffer = Buffer.from(expected)
  return suppliedBuffer.length === expectedBuffer.length && timingSafeEqual(suppliedBuffer, expectedBuffer)
}
