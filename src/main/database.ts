import Database from 'better-sqlite3'
import { createHash, randomUUID } from 'node:crypto'
import type {
  Assignment,
  CreateAssignmentInput,
  DashboardSummary,
  DraftScoreReview,
  GradingQueueSummary,
  GradingResult,
  RubricDefinition,
  SpreadsheetExportData,
  SpreadsheetExportScope,
  Submission,
  TemplateVersion
} from '../shared/contracts'
import {
  defaultExportLayout,
  defaultFeedbackSettings,
  defaultImportProfile,
  staarRubric
} from '../shared/defaultTemplate'
import { validateRubric } from '../shared/rubricValidation'

interface TemplateRow {
  id: string
  template_key: string
  version: number
  name: string
  status: TemplateVersion['status']
  rubric_json: string
  import_profile_json: string
  feedback_settings_json: string
  export_layout_json: string
  created_at: string
  published_at: string | null
}

interface AssignmentRow {
  id: string
  name: string
  grade: 6 | 7 | 8 | null
  question_text: string
  status: Assignment['status']
  template_version_id: string
  template_name: string
  template_version: number
  submission_count: number
  created_at: string
  updated_at: string
}

interface SubmissionRow {
  id: string
  assignment_id: string
  source_path: string
  source_file_name: string
  content_hash: string
  source_document_hash: string
  student_index: number
  page_number: number | null
  student_name: string | null
  student_id: string | null
  grade: 6 | 7 | 8 | null
  raw_text: string | null
  reviewed_text: string | null
  status: Submission['status']
  issue_message: string | null
  created_at: string
  updated_at: string
}

interface GradingAttemptRow {
  id: string
  submission_id: string
  model_name: string
}

export interface GradingWorkItem {
  attemptId: string
  submissionId: string
  modelName: string
  grade: 6 | 7 | 8 | null
  assignmentMaterial: string
  responseText: string
  rubric: RubricDefinition
}

export class AutoGraderDatabase {
  readonly db: Database.Database

  constructor(path: string) {
    this.db = new Database(path)
    this.db.pragma('journal_mode = WAL')
    this.db.pragma('foreign_keys = ON')
    this.migrate()
    this.seed()
    this.normalizeExtractionStatuses()
    this.recoverInterruptedGrading()
  }

  close(): void {
    this.db.close()
  }

  private migrate(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS schema_migrations (
        version INTEGER PRIMARY KEY,
        applied_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS template_versions (
        id TEXT PRIMARY KEY,
        template_key TEXT NOT NULL,
        version INTEGER NOT NULL CHECK (version > 0),
        name TEXT NOT NULL,
        status TEXT NOT NULL CHECK (status IN ('draft', 'published', 'archived')),
        rubric_json TEXT NOT NULL,
        import_profile_json TEXT NOT NULL,
        feedback_settings_json TEXT NOT NULL,
        export_layout_json TEXT NOT NULL,
        created_at TEXT NOT NULL,
        published_at TEXT,
        UNIQUE (template_key, version)
      );

      CREATE TABLE IF NOT EXISTS assignments (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        grade INTEGER CHECK (grade IN (6, 7, 8)),
        question_text TEXT NOT NULL DEFAULT '',
        status TEXT NOT NULL CHECK (status IN ('setup', 'ready', 'active', 'completed')),
        template_version_id TEXT NOT NULL REFERENCES template_versions(id),
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS submissions (
        id TEXT PRIMARY KEY,
        assignment_id TEXT NOT NULL REFERENCES assignments(id) ON DELETE CASCADE,
        source_path TEXT NOT NULL,
        source_file_name TEXT NOT NULL,
        content_hash TEXT NOT NULL,
        student_name TEXT,
        student_id TEXT,
        grade INTEGER CHECK (grade IN (6, 7, 8)),
        raw_text TEXT,
        reviewed_text TEXT,
        status TEXT NOT NULL CHECK (status IN (
          'imported', 'extracted', 'ready', 'scoring', 'draft_scored',
          'reviewed', 'approved', 'extraction_problem', 'scoring_error'
        )),
        issue_message TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        UNIQUE (assignment_id, content_hash)
      );

      CREATE TABLE IF NOT EXISTS grading_attempts (
        id TEXT PRIMARY KEY,
        submission_id TEXT NOT NULL REFERENCES submissions(id) ON DELETE CASCADE,
        template_version_id TEXT NOT NULL REFERENCES template_versions(id),
        model_provider TEXT NOT NULL,
        model_name TEXT NOT NULL,
        status TEXT NOT NULL CHECK (status IN ('queued', 'running', 'succeeded', 'failed', 'invalid')),
        request_fingerprint TEXT NOT NULL,
        result_json TEXT,
        error_message TEXT,
        created_at TEXT NOT NULL,
        completed_at TEXT
      );

      CREATE TABLE IF NOT EXISTS approved_results (
        id TEXT PRIMARY KEY,
        submission_id TEXT NOT NULL REFERENCES submissions(id) ON DELETE CASCADE,
        grading_attempt_id TEXT REFERENCES grading_attempts(id),
        revision INTEGER NOT NULL CHECK (revision > 0),
        result_json TEXT NOT NULL,
        reviewer_name TEXT,
        approved_at TEXT NOT NULL,
        UNIQUE (submission_id, revision)
      );

      CREATE INDEX IF NOT EXISTS idx_assignments_updated ON assignments(updated_at DESC);
      CREATE INDEX IF NOT EXISTS idx_submissions_assignment ON submissions(assignment_id, status);
      CREATE INDEX IF NOT EXISTS idx_attempts_submission ON grading_attempts(submission_id, created_at DESC);
      CREATE UNIQUE INDEX IF NOT EXISTS idx_attempts_one_active
        ON grading_attempts(submission_id)
        WHERE status IN ('queued', 'running');
    `)

    this.addColumnIfMissing('submissions', 'source_document_hash', 'TEXT')
    this.addColumnIfMissing('submissions', 'student_index', 'INTEGER NOT NULL DEFAULT 1')
    this.addColumnIfMissing('submissions', 'page_number', 'INTEGER')
    this.db.exec(`
      UPDATE submissions SET source_document_hash = content_hash WHERE source_document_hash IS NULL;
      CREATE UNIQUE INDEX IF NOT EXISTS idx_submissions_source_student
        ON submissions(assignment_id, source_document_hash, student_index);
    `)
  }

  private addColumnIfMissing(table: string, column: string, definition: string): void {
    const columns = this.db.pragma(`table_info(${table})`) as Array<{ name: string }>
    if (!columns.some((item) => item.name === column)) {
      this.db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`)
    }
  }

  private seed(): void {
    const existing = this.db
      .prepare('SELECT id FROM template_versions WHERE template_key = ? LIMIT 1')
      .get('staar-ecr-current')
    if (existing) return

    const validation = validateRubric(staarRubric)
    if (!validation.valid) throw new Error(`Bundled rubric is invalid: ${validation.errors.join(' ')}`)

    const now = new Date().toISOString()
    this.db.prepare(`
      INSERT INTO template_versions (
        id, template_key, version, name, status, rubric_json, import_profile_json,
        feedback_settings_json, export_layout_json, created_at, published_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      randomUUID(),
      'staar-ecr-current',
      1,
      'STAAR ECR — Current School Rubric',
      'published',
      JSON.stringify(staarRubric),
      JSON.stringify(defaultImportProfile),
      JSON.stringify(defaultFeedbackSettings),
      JSON.stringify(defaultExportLayout),
      now,
      now
    )
  }

  private normalizeExtractionStatuses(): void {
    this.db.prepare(`
      UPDATE submissions
      SET status = 'extraction_problem',
          issue_message = CASE
            WHEN issue_message IS NULL OR trim(issue_message) = ''
              THEN 'Student identity is incomplete and requires review.'
            ELSE issue_message
          END
      WHERE status = 'extracted'
        AND (student_name IS NULL OR trim(student_name) = '' OR student_id IS NULL OR trim(student_id) = '')
    `).run()
  }

  private recoverInterruptedGrading(): void {
    const now = new Date().toISOString()
    const interrupted = this.db.prepare(`
      SELECT submission_id FROM grading_attempts WHERE status = 'running'
    `).all() as Array<{ submission_id: string }>
    if (!interrupted.length) return
    const transaction = this.db.transaction(() => {
      this.db.prepare(`
        UPDATE grading_attempts
        SET status = 'failed', error_message = ?, completed_at = ?
        WHERE status = 'running'
      `).run('AutoGrader closed while this request was running. Retry it explicitly to avoid an unnoticed duplicate charge.', now)
      const update = this.db.prepare(`
        UPDATE submissions SET status = 'scoring_error', issue_message = ?, updated_at = ? WHERE id = ?
      `)
      for (const item of interrupted) {
        update.run('Grading was interrupted before a result was saved.', now, item.submission_id)
      }
    })
    transaction()
  }

  listTemplates(): TemplateVersion[] {
    const rows = this.db
      .prepare('SELECT * FROM template_versions ORDER BY template_key, version DESC')
      .all() as TemplateRow[]
    return rows.map(mapTemplate)
  }

  listAssignments(): Assignment[] {
    const rows = this.db.prepare(`
      SELECT
        a.*,
        t.name AS template_name,
        t.version AS template_version,
        COUNT(s.id) AS submission_count
      FROM assignments a
      JOIN template_versions t ON t.id = a.template_version_id
      LEFT JOIN submissions s ON s.assignment_id = a.id
      GROUP BY a.id
      ORDER BY a.updated_at DESC
    `).all() as AssignmentRow[]
    return rows.map(mapAssignment)
  }

  getAssignment(id: string): Assignment | null {
    return this.listAssignments().find((assignment) => assignment.id === id) ?? null
  }

  listSubmissions(assignmentId: string): Submission[] {
    const rows = this.db.prepare(`
      SELECT id, assignment_id, source_path, source_file_name, content_hash,
             source_document_hash, student_index, page_number,
             student_name, student_id, grade, raw_text, reviewed_text,
             status, issue_message, created_at, updated_at
      FROM submissions
      WHERE assignment_id = ?
      ORDER BY created_at DESC, source_file_name
    `).all(assignmentId) as SubmissionRow[]
    return rows.map(mapSubmission)
  }

  getSubmission(id: string): Submission | null {
    const row = this.db.prepare(`
      SELECT id, assignment_id, source_path, source_file_name, content_hash,
             source_document_hash, student_index, page_number,
             student_name, student_id, grade, raw_text, reviewed_text,
             status, issue_message, created_at, updated_at
      FROM submissions WHERE id = ?
    `).get(id) as SubmissionRow | undefined
    return row ? mapSubmission(row) : null
  }

  acceptCleanExtractions(assignmentId: string): number {
    const now = new Date().toISOString()
    this.db.prepare(`
      UPDATE submissions
      SET status = 'extraction_problem',
          issue_message = CASE
            WHEN issue_message IS NULL OR trim(issue_message) = ''
              THEN 'Student identity is incomplete and requires review.'
            ELSE issue_message
          END,
          updated_at = ?
      WHERE assignment_id = ? AND status = 'extracted'
        AND (student_name IS NULL OR trim(student_name) = '' OR student_id IS NULL OR trim(student_id) = '')
    `).run(now, assignmentId)
    const result = this.db.prepare(`
      UPDATE submissions
      SET status = 'ready', updated_at = ?
      WHERE assignment_id = ? AND status = 'extracted'
        AND student_name IS NOT NULL AND student_id IS NOT NULL
        AND reviewed_text IS NOT NULL AND length(trim(reviewed_text)) > 0
    `).run(now, assignmentId)
    this.db.prepare('UPDATE assignments SET updated_at = ? WHERE id = ?').run(now, assignmentId)
    return result.changes
  }

  addImportedSubmission(input: {
    assignmentId: string
    sourcePath: string
    sourceFileName: string
    contentHash: string
    grade: 6 | 7 | 8 | null
  }): { inserted: boolean; submission: Submission } {
    const id = randomUUID()
    const now = new Date().toISOString()
    const result = this.db.prepare(`
      INSERT OR IGNORE INTO submissions (
        id, assignment_id, source_path, source_file_name, content_hash,
        source_document_hash, student_index, grade, status, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, 1, ?, 'imported', ?, ?)
    `).run(
      id,
      input.assignmentId,
      input.sourcePath,
      input.sourceFileName,
      input.contentHash,
      input.contentHash,
      input.grade,
      now,
      now
    )

    this.db.prepare('UPDATE assignments SET updated_at = ? WHERE id = ?').run(now, input.assignmentId)
    const row = this.db.prepare(`
      SELECT id, assignment_id, source_path, source_file_name, content_hash,
             source_document_hash, student_index, page_number,
             student_name, student_id, grade, raw_text, reviewed_text,
             status, issue_message, created_at, updated_at
      FROM submissions WHERE assignment_id = ? AND content_hash = ?
    `).get(input.assignmentId, input.contentHash) as SubmissionRow | undefined
    if (!row) throw new Error('The imported submission could not be loaded.')
    return { inserted: result.changes > 0, submission: mapSubmission(row) }
  }

  updateSubmissionExtraction(input: {
    id: string
    studentName: string | null
    studentId: string | null
    rawText: string
    reviewedText: string
    status: 'extracted' | 'extraction_problem'
    issueMessage: string | null
  }): void {
    const now = new Date().toISOString()
    this.db.prepare(`
      UPDATE submissions
      SET student_name = ?, student_id = ?, raw_text = ?, reviewed_text = ?,
          status = ?, issue_message = ?, updated_at = ?
      WHERE id = ?
    `).run(
      input.studentName,
      input.studentId,
      input.rawText,
      input.reviewedText,
      input.status,
      input.issueMessage,
      now,
      input.id
    )
  }

  replaceDocumentExtraction(input: {
    rootSubmissionId: string
    students: Array<{
      studentName: string | null
      studentId: string | null
      rawText: string
      reviewedText: string
      pageNumber: number
      status: 'extracted' | 'extraction_problem'
      issueMessage: string | null
    }>
  }): void {
    const root = this.db.prepare(`
      SELECT id, assignment_id, source_path, source_file_name, content_hash,
             source_document_hash, student_index, page_number,
             student_name, student_id, grade, raw_text, reviewed_text,
             status, issue_message, created_at, updated_at
      FROM submissions WHERE id = ?
    `).get(input.rootSubmissionId) as SubmissionRow | undefined
    if (!root) throw new Error('Source PDF record not found.')
    if (!input.students.length) throw new Error('No student pages were extracted from the PDF.')

    const documentHash = root.source_document_hash || root.content_hash
    const now = new Date().toISOString()
    const transaction = this.db.transaction(() => {
      this.db.prepare(`
        DELETE FROM submissions
        WHERE assignment_id = ? AND source_document_hash = ? AND id <> ?
          AND status IN ('imported', 'extracted', 'extraction_problem')
      `).run(root.assignment_id, documentHash, root.id)

      const first = input.students[0]!
      this.db.prepare(`
        UPDATE submissions
        SET source_document_hash = ?, student_index = 1, page_number = ?,
            student_name = ?, student_id = ?, raw_text = ?, reviewed_text = ?,
            status = ?, issue_message = ?, updated_at = ?
        WHERE id = ?
      `).run(
        documentHash, first.pageNumber, first.studentName, first.studentId,
        first.rawText, first.reviewedText, first.status, first.issueMessage, now, root.id
      )

      const insert = this.db.prepare(`
        INSERT INTO submissions (
          id, assignment_id, source_path, source_file_name, content_hash,
          source_document_hash, student_index, page_number, student_name, student_id,
          grade, raw_text, reviewed_text, status, issue_message, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `)
      input.students.slice(1).forEach((student, offset) => {
        const studentIndex = offset + 2
        insert.run(
          randomUUID(), root.assignment_id, root.source_path, root.source_file_name,
          `${documentHash}:${studentIndex}`, documentHash, studentIndex, student.pageNumber,
          student.studentName, student.studentId, root.grade, student.rawText,
          student.reviewedText, student.status, student.issueMessage, now, now
        )
      })
    })
    transaction()
  }

  approveSubmissionExtraction(input: {
    id: string
    studentName: string
    studentId: string
    grade: 6 | 7 | 8
    reviewedText: string
  }): Submission {
    const now = new Date().toISOString()
    const result = this.db.prepare(`
      UPDATE submissions
      SET student_name = ?, student_id = ?, grade = ?, reviewed_text = ?,
          status = 'ready', issue_message = NULL, updated_at = ?
      WHERE id = ?
    `).run(input.studentName, input.studentId, input.grade, input.reviewedText, now, input.id)
    if (!result.changes) throw new Error('Submission not found.')

    const row = this.db.prepare(`
      SELECT id, assignment_id, source_path, source_file_name, content_hash,
             source_document_hash, student_index, page_number,
             student_name, student_id, grade, raw_text, reviewed_text,
             status, issue_message, created_at, updated_at
      FROM submissions WHERE id = ?
    `).get(input.id) as SubmissionRow
    return mapSubmission(row)
  }

  createAssignment(input: CreateAssignmentInput): Assignment {
    const template = this.db
      .prepare('SELECT id FROM template_versions WHERE id = ? AND status = ?')
      .get(input.templateVersionId, 'published')
    if (!template) throw new Error('Choose a published template version.')

    const id = randomUUID()
    const now = new Date().toISOString()
    this.db.prepare(`
      INSERT INTO assignments (
        id, name, grade, question_text, status, template_version_id, created_at, updated_at
      ) VALUES (?, ?, ?, ?, 'setup', ?, ?, ?)
    `).run(id, input.name.trim(), input.grade, input.questionText.trim(), input.templateVersionId, now, now)

    const created = this.listAssignments().find((assignment) => assignment.id === id)
    if (!created) throw new Error('The assignment was created but could not be loaded.')
    return created
  }

  enqueueReadySubmissions(assignmentId: string, modelName: string, limit = 1): number {
    const assignment = this.getAssignment(assignmentId)
    if (!assignment) throw new Error('Assignment not found.')
    const template = this.getTemplate(assignment.templateVersionId)
    if (!template) throw new Error('The assignment rubric could not be loaded.')
    const ready = this.listSubmissions(assignmentId)
      .filter((submission) => submission.status === 'ready')
      .slice(0, limit)
    const now = new Date().toISOString()
    let queued = 0
    const insert = this.db.prepare(`
      INSERT OR IGNORE INTO grading_attempts (
        id, submission_id, template_version_id, model_provider, model_name,
        status, request_fingerprint, created_at
      ) VALUES (?, ?, ?, 'gemini', ?, 'queued', ?, ?)
    `)
    const update = this.db.prepare(`
      UPDATE submissions SET status = 'scoring', issue_message = NULL, updated_at = ?
      WHERE id = ? AND status = 'ready'
    `)
    const transaction = this.db.transaction(() => {
      for (const submission of ready) {
        if (!submission.reviewedText) continue
        const fingerprint = createHash('sha256').update(JSON.stringify({
          model: modelName,
          assignmentMaterial: assignment.questionText,
          response: submission.reviewedText,
          rubric: template.rubric
        })).digest('hex')
        const result = insert.run(
          randomUUID(), submission.id, assignment.templateVersionId, modelName, fingerprint, now
        )
        if (result.changes) {
          update.run(now, submission.id)
          queued += 1
        }
      }
      if (queued) {
        this.db.prepare('UPDATE assignments SET status = ?, updated_at = ? WHERE id = ?')
          .run('active', now, assignmentId)
      }
    })
    transaction()
    return queued
  }

  enqueueAllReadySubmissions(assignmentId: string, modelName: string): number {
    return this.enqueueReadySubmissions(assignmentId, modelName, Number.MAX_SAFE_INTEGER)
  }

  retryFailedSubmissions(assignmentId: string, modelName: string): number {
    const now = new Date().toISOString()
    this.db.prepare(`
      UPDATE submissions SET status = 'ready', issue_message = NULL, updated_at = ?
      WHERE assignment_id = ? AND status = 'scoring_error'
    `).run(now, assignmentId)
    return this.enqueueReadySubmissions(assignmentId, modelName)
  }

  cancelPendingGrading(assignmentId: string): number {
    const now = new Date().toISOString()
    return this.db.transaction(() => {
      const pending = this.db.prepare(`
        SELECT ga.id, ga.submission_id
        FROM grading_attempts ga
        JOIN submissions s ON s.id = ga.submission_id
        WHERE s.assignment_id = ? AND ga.status = 'queued'
      `).all(assignmentId) as Array<{ id: string; submission_id: string }>
      const stopAttempt = this.db.prepare(`
        UPDATE grading_attempts SET status = 'failed', error_message = ?, completed_at = ? WHERE id = ?
      `)
      const resetSubmission = this.db.prepare(`
        UPDATE submissions SET status = 'ready', issue_message = NULL, updated_at = ?
        WHERE id = ? AND status = 'scoring'
      `)
      for (const item of pending) {
        stopAttempt.run('Stopped before this provider request began.', now, item.id)
        resetSubmission.run(now, item.submission_id)
      }
      return pending.length
    })()
  }

  claimNextGradingAttempt(): GradingWorkItem | null {
    return this.db.transaction(() => {
      const attempt = this.db.prepare(`
        SELECT id, submission_id, model_name
        FROM grading_attempts WHERE status = 'queued' ORDER BY created_at, id LIMIT 1
      `).get() as GradingAttemptRow | undefined
      if (!attempt) return null
      const claimed = this.db.prepare(`
        UPDATE grading_attempts SET status = 'running' WHERE id = ? AND status = 'queued'
      `).run(attempt.id)
      if (!claimed.changes) return null
      const row = this.db.prepare(`
        SELECT s.id AS submission_id, s.grade, s.reviewed_text,
               a.question_text, t.rubric_json
        FROM submissions s
        JOIN assignments a ON a.id = s.assignment_id
        JOIN template_versions t ON t.id = a.template_version_id
        WHERE s.id = ?
      `).get(attempt.submission_id) as {
        submission_id: string
        grade: 6 | 7 | 8 | null
        reviewed_text: string | null
        question_text: string
        rubric_json: string
      } | undefined
      if (!row?.reviewed_text) {
        this.failGradingAttempt(attempt.id, 'The reviewed student response is missing.')
        return null
      }
      return {
        attemptId: attempt.id,
        submissionId: row.submission_id,
        modelName: attempt.model_name,
        grade: row.grade,
        assignmentMaterial: row.question_text,
        responseText: row.reviewed_text,
        rubric: JSON.parse(row.rubric_json) as RubricDefinition
      }
    })()
  }

  completeGradingAttempt(attemptId: string, result: GradingResult): void {
    const now = new Date().toISOString()
    this.db.transaction(() => {
      const attempt = this.db.prepare('SELECT submission_id FROM grading_attempts WHERE id = ?')
        .get(attemptId) as { submission_id: string } | undefined
      if (!attempt) throw new Error('Grading attempt not found.')
      this.db.prepare(`
        UPDATE grading_attempts
        SET status = 'succeeded', result_json = ?, error_message = NULL, completed_at = ?
        WHERE id = ?
      `).run(JSON.stringify(result), now, attemptId)
      this.db.prepare(`
        UPDATE submissions SET status = 'draft_scored', issue_message = NULL, updated_at = ? WHERE id = ?
      `).run(now, attempt.submission_id)
    })()
  }

  failGradingAttempt(attemptId: string, message: string): void {
    const now = new Date().toISOString()
    this.db.transaction(() => {
      const attempt = this.db.prepare('SELECT submission_id FROM grading_attempts WHERE id = ?')
        .get(attemptId) as { submission_id: string } | undefined
      if (!attempt) return
      this.db.prepare(`
        UPDATE grading_attempts
        SET status = 'failed', error_message = ?, completed_at = ? WHERE id = ?
      `).run(message.slice(0, 1000), now, attemptId)
      this.db.prepare(`
        UPDATE submissions SET status = 'scoring_error', issue_message = ?, updated_at = ? WHERE id = ?
      `).run(message.slice(0, 1000), now, attempt.submission_id)
    })()
  }

  getNextDraftScore(assignmentId: string): DraftScoreReview | null {
    const row = this.db.prepare(`
      SELECT ga.id AS attempt_id, ga.submission_id, ga.model_name, ga.result_json, ga.completed_at
      FROM grading_attempts ga
      JOIN submissions s ON s.id = ga.submission_id
      WHERE s.assignment_id = ? AND s.status = 'draft_scored'
        AND ga.status = 'succeeded' AND ga.result_json IS NOT NULL
        AND ga.id = (
          SELECT newest.id FROM grading_attempts newest
          WHERE newest.submission_id = s.id AND newest.status = 'succeeded'
          ORDER BY newest.completed_at DESC LIMIT 1
        )
      ORDER BY ga.completed_at, ga.id
      LIMIT 1
    `).get(assignmentId) as {
      attempt_id: string
      submission_id: string
      model_name: string
      result_json: string
      completed_at: string
    } | undefined
    if (!row) return null
    const submission = this.getSubmission(row.submission_id)
    if (!submission) return null
    return {
      attemptId: row.attempt_id,
      submission,
      result: JSON.parse(row.result_json) as GradingResult,
      modelName: row.model_name,
      completedAt: row.completed_at
    }
  }

  approveDraftScore(submissionId: string, result: GradingResult): void {
    const now = new Date().toISOString()
    this.db.transaction(() => {
      const submission = this.getSubmission(submissionId)
      if (!submission || submission.status !== 'draft_scored') {
        throw new Error('This draft score is no longer awaiting review.')
      }
      const attempt = this.db.prepare(`
        SELECT id FROM grading_attempts
        WHERE submission_id = ? AND status = 'succeeded'
        ORDER BY completed_at DESC LIMIT 1
      `).get(submissionId) as { id: string } | undefined
      if (!attempt) throw new Error('The grading attempt could not be found.')
      const revision = Number((this.db.prepare(`
        SELECT COALESCE(MAX(revision), 0) + 1 AS revision FROM approved_results WHERE submission_id = ?
      `).get(submissionId) as { revision: number }).revision)
      this.db.prepare(`
        INSERT INTO approved_results (
          id, submission_id, grading_attempt_id, revision, result_json, approved_at
        ) VALUES (?, ?, ?, ?, ?, ?)
      `).run(randomUUID(), submissionId, attempt.id, revision, JSON.stringify(result), now)
      this.db.prepare(`
        UPDATE submissions SET status = 'approved', issue_message = NULL, updated_at = ? WHERE id = ?
      `).run(now, submissionId)
    })()
  }

  exportScoreData(assignmentId: string, scope: SpreadsheetExportScope): SpreadsheetExportData {
    const assignment = this.getAssignment(assignmentId)
    if (!assignment) throw new Error('Assignment not found.')
    const template = this.getTemplate(assignment.templateVersionId)
    if (!template) throw new Error('The assignment rubric could not be loaded.')

    const statusFilter = scope === 'approved'
      ? "s.status = 'approved'"
      : "s.status IN ('approved', 'draft_scored')"
    const rows = this.db.prepare(`
      WITH latest_attempt AS (
        SELECT grading_attempts.*,
               ROW_NUMBER() OVER (
                 PARTITION BY submission_id
                 ORDER BY completed_at DESC, created_at DESC, id DESC
               ) AS rank
        FROM grading_attempts
        WHERE status = 'succeeded' AND result_json IS NOT NULL
      ),
      latest_approval AS (
        SELECT approved_results.*,
               ROW_NUMBER() OVER (
                 PARTITION BY submission_id
                 ORDER BY revision DESC
               ) AS rank
        FROM approved_results
      )
      SELECT
        s.source_file_name,
        s.student_index,
        s.student_id,
        s.student_name,
        s.grade,
        COALESCE(s.reviewed_text, s.raw_text, '') AS response_text,
        s.status,
        CASE WHEN s.status = 'approved' THEN approval.result_json ELSE attempt.result_json END AS result_json,
        CASE WHEN s.status = 'approved' THEN approved_attempt.model_name ELSE attempt.model_name END AS model_name,
        approval.approved_at
      FROM submissions s
      LEFT JOIN latest_attempt attempt
        ON attempt.submission_id = s.id AND attempt.rank = 1
      LEFT JOIN latest_approval approval
        ON approval.submission_id = s.id AND approval.rank = 1
      LEFT JOIN grading_attempts approved_attempt
        ON approved_attempt.id = approval.grading_attempt_id
      WHERE s.assignment_id = ? AND ${statusFilter}
      ORDER BY s.source_file_name COLLATE NOCASE, s.student_index, s.student_name COLLATE NOCASE
    `).all(assignmentId) as Array<{
      source_file_name: string
      student_index: number
      student_id: string | null
      student_name: string | null
      grade: 6 | 7 | 8 | null
      response_text: string
      status: Submission['status']
      result_json: string | null
      model_name: string | null
      approved_at: string | null
    }>

    return {
      assignmentName: assignment.name,
      templateName: assignment.templateName,
      rubric: template.rubric,
      rows: rows.flatMap((row) => row.result_json ? [{
        sourceFileName: row.source_file_name,
        studentIndex: row.student_index,
        studentId: row.student_id ?? '',
        studentName: row.student_name ?? '',
        grade: row.grade,
        responseText: row.response_text,
        reviewStatus: row.status === 'approved' ? 'Approved' as const : 'AI draft' as const,
        modelName: row.model_name ?? '',
        approvedAt: row.approved_at,
        result: JSON.parse(row.result_json) as GradingResult
      }] : [])
    }
  }

  gradingQueueSummary(assignmentId: string): GradingQueueSummary {
    const row = this.db.prepare(`
      SELECT
        SUM(CASE WHEN s.status = 'ready' THEN 1 ELSE 0 END) AS ready,
        SUM(CASE WHEN s.status = 'draft_scored' THEN 1 ELSE 0 END) AS draft_scored,
        SUM(CASE WHEN s.status = 'scoring_error' THEN 1 ELSE 0 END) AS failed,
        SUM(CASE WHEN s.status = 'approved' THEN 1 ELSE 0 END) AS approved,
        (SELECT COUNT(*) FROM grading_attempts ga
          JOIN submissions qs ON qs.id = ga.submission_id
          WHERE qs.assignment_id = ? AND ga.status = 'queued') AS queued,
        (SELECT COUNT(*) FROM grading_attempts ga
          JOIN submissions rs ON rs.id = ga.submission_id
          WHERE rs.assignment_id = ? AND ga.status = 'running') AS running
      FROM submissions s WHERE s.assignment_id = ?
    `).get(assignmentId, assignmentId, assignmentId) as Record<string, number | null>
    const latestFailure = this.db.prepare(`
      SELECT ga.error_message
      FROM grading_attempts ga
      JOIN submissions s ON s.id = ga.submission_id
      WHERE s.assignment_id = ? AND s.status = 'scoring_error'
        AND ga.status = 'failed' AND ga.error_message IS NOT NULL
      ORDER BY CASE WHEN ga.error_message LIKE 'Gemini returned %' THEN 0 ELSE 1 END,
               ga.completed_at DESC
      LIMIT 1
    `).get(assignmentId) as { error_message: string } | undefined
    return {
      ready: Number(row.ready ?? 0),
      queued: Number(row.queued ?? 0),
      running: Number(row.running ?? 0),
      draftScored: Number(row.draft_scored ?? 0),
      failed: Number(row.failed ?? 0),
      approved: Number(row.approved ?? 0),
      lastError: latestFailure?.error_message ?? null
    }
  }

  getTemplate(id: string): TemplateVersion | null {
    return this.listTemplates().find((template) => template.id === id) ?? null
  }

  dashboard(): DashboardSummary {
    const counts = this.db.prepare(`
      SELECT
        (SELECT COUNT(*) FROM assignments) AS assignment_count,
        (SELECT COUNT(*) FROM submissions) AS submission_count,
        (SELECT COUNT(*) FROM submissions WHERE status IN ('extraction_problem', 'scoring_error')) AS needs_attention_count,
        (SELECT COUNT(*) FROM submissions WHERE status = 'approved') AS approved_count
    `).get() as {
      assignment_count: number
      submission_count: number
      needs_attention_count: number
      approved_count: number
    }

    return {
      assignmentCount: counts.assignment_count,
      submissionCount: counts.submission_count,
      needsAttentionCount: counts.needs_attention_count,
      approvedCount: counts.approved_count,
      recentAssignments: this.listAssignments().slice(0, 5)
    }
  }
}

function mapTemplate(row: TemplateRow): TemplateVersion {
  return {
    id: row.id,
    templateKey: row.template_key,
    version: row.version,
    name: row.name,
    status: row.status,
    rubric: JSON.parse(row.rubric_json),
    importProfile: JSON.parse(row.import_profile_json),
    feedbackSettings: JSON.parse(row.feedback_settings_json),
    exportLayout: JSON.parse(row.export_layout_json),
    createdAt: row.created_at,
    publishedAt: row.published_at
  }
}

function mapAssignment(row: AssignmentRow): Assignment {
  return {
    id: row.id,
    name: row.name,
    grade: row.grade,
    questionText: row.question_text,
    status: row.status,
    templateVersionId: row.template_version_id,
    templateName: row.template_name,
    templateVersion: row.template_version,
    submissionCount: Number(row.submission_count),
    createdAt: row.created_at,
    updatedAt: row.updated_at
  }
}

function mapSubmission(row: SubmissionRow): Submission {
  return {
    id: row.id,
    assignmentId: row.assignment_id,
    sourcePath: row.source_path,
    sourceFileName: row.source_file_name,
    contentHash: row.content_hash,
    sourceDocumentHash: row.source_document_hash,
    studentIndex: row.student_index,
    pageNumber: row.page_number,
    studentName: row.student_name,
    studentId: row.student_id,
    grade: row.grade,
    rawText: row.raw_text,
    reviewedText: row.reviewed_text,
    status: row.status,
    issueMessage: row.issue_message,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  }
}
