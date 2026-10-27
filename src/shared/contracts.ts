export type TemplateStatus = 'draft' | 'published' | 'archived'
export type AssignmentStatus = 'setup' | 'ready' | 'active' | 'completed'
export type SubmissionStatus =
  | 'imported'
  | 'extracted'
  | 'ready'
  | 'scoring'
  | 'draft_scored'
  | 'reviewed'
  | 'approved'
  | 'extraction_problem'
  | 'scoring_error'

export interface RubricLevel {
  score: number
  descriptor: string
}

export interface RubricCriterion {
  key: string
  name: string
  minScore?: number
  maxScore: number
  includedInTotal: boolean
  levels: RubricLevel[]
}

export interface ScoringRule {
  type: 'force_score'
  when: { criterionKey: string; equals: number }
  then: { criterionKey: string; score: number }
  explanation: string
}

export interface RubricDefinition {
  name: string
  scoringNotes?: string
  criteria: RubricCriterion[]
  rules: ScoringRule[]
}

export interface ImportProfile {
  mode: 'individual_student_pdf'
  responseMarker: string
  identityPattern: string
  excludeFooterPatterns: string[]
}

export interface FeedbackSettings {
  audience: 'teacher' | 'student'
  includeStrength: boolean
  includeNextStep: boolean
  commentLength: 'brief' | 'standard' | 'detailed'
}

export interface ExportLayout {
  columns: string[]
  approvedOnlyByDefault: boolean
}

export interface TemplateVersion {
  id: string
  templateKey: string
  version: number
  name: string
  status: TemplateStatus
  rubric: RubricDefinition
  importProfile: ImportProfile
  feedbackSettings: FeedbackSettings
  exportLayout: ExportLayout
  createdAt: string
  publishedAt: string | null
}

export interface Assignment {
  id: string
  name: string
  grade: 6 | 7 | 8 | null
  questionText: string
  status: AssignmentStatus
  templateVersionId: string
  templateName: string
  templateVersion: number
  submissionCount: number
  createdAt: string
  updatedAt: string
}

export interface SelectGradingRubricResult {
  assignment: Assignment
  createdNewRun: boolean
}

export interface DashboardSummary {
  assignmentCount: number
  submissionCount: number
  needsAttentionCount: number
  approvedCount: number
  recentAssignments: Assignment[]
}

export interface CreateAssignmentInput {
  name: string
  grade: 6 | 7 | 8
  questionText: string
  templateVersionId: string
}

export interface Submission {
  id: string
  assignmentId: string
  sourcePath: string
  sourceFileName: string
  contentHash: string
  sourceDocumentHash: string
  studentIndex: number
  pageEndNumber: number | null
  pageNumber: number | null
  studentName: string | null
  studentId: string | null
  grade: 6 | 7 | 8 | null
  rawText: string | null
  reviewedText: string | null
  status: SubmissionStatus
  issueMessage: string | null
  createdAt: string
  updatedAt: string
}

export interface ExtractionBatchResult {
  extracted: number
  needsReview: number
  skipped: number
  submissions: Submission[]
}

export interface ReviewExtractionInput {
  studentName: string
  studentId: string
  grade: 6 | 7 | 8
  reviewedText: string
}

export interface SelectedPdfFile {
  path: string
  name: string
  size: number
}

export interface ImportPdfResult {
  imported: number
  duplicates: number
  rejected: string[]
  submissions: Submission[]
}

export interface ServiceConnection {
  baseUrl: string
  token: string
}

export type GradingAttemptStatus = 'queued' | 'running' | 'succeeded' | 'failed' | 'invalid'

export interface CriterionScore {
  key: string
  name: string
  score: number
  maxScore: number
  comment: string
}

export interface GradingResult {
  criteria: CriterionScore[]
  totalScore: number
  maxTotalScore: number
  overallComment: string
}

export interface GradingQueueSummary {
  ready: number
  queued: number
  running: number
  draftScored: number
  failed: number
  approved: number
  lastError: string | null
}

export interface ProviderStatus {
  provider: 'ollama'
  model: string
  configured: boolean
  models: string[]
}

export interface SaveProviderInput {
  model: string
}

export interface CreateRubricDraftInput {
  sourceId?: string
  newVersion?: boolean
}

export interface DraftScoreReview {
  rubric: RubricDefinition
  attemptId: string
  submission: Submission
  result: GradingResult
  modelName: string
  completedAt: string
}

export type SpreadsheetExportScope = 'approved' | 'all_scored'

export interface SpreadsheetScoreRow {
  submissionId: string
  gradingAttemptId: string
  teacherName: string
  sourceFileName: string
  studentIndex: number
  pageNumber: number | null
  pageEndNumber: number | null
  studentId: string
  studentName: string
  grade: 6 | 7 | 8 | null
  responseText: string
  reviewStatus: 'Approved' | 'AI draft'
  modelName: string
  approvedAt: string | null
  result: GradingResult
}

export interface SpreadsheetExportData {
  assignmentId: string
  assignmentName: string
  questionText: string
  templateVersionId: string
  templateName: string
  templateVersion: number
  rubric: RubricDefinition
  rows: SpreadsheetScoreRow[]
}

export interface SpreadsheetExportResult {
  cancelled: boolean
  filePath?: string
  rowCount: number
}

export type TeacherReviewDecision =
  | 'Accept AI'
  | 'Corrected'
  | 'Needs follow-up'
  | 'Unscorable'
  | 'Extraction problem'

export interface TeacherReviewCriterionInput {
  key: string
  aiScore: number
  teacherScore: number
  reason: string
}

export interface TeacherReviewImportRow {
  rowNumber: number
  submissionId: string
  gradingAttemptId: string
  reviewerInitials: string
  decision: TeacherReviewDecision
  teacherNote: string
  criteria: TeacherReviewCriterionInput[]
}

export interface TeacherReviewImportCounts {
  reviewed: number
  accepted: number
  corrected: number
  needsFollowUp: number
  unscorable: number
  extractionProblems: number
  untouched: number
  invalid: number
  conflicts: number
  duplicates: number
}

export interface TeacherReviewImportPreview {
  assignmentId: string
  templateVersionId: string
  workbookVersion: string
  rows: TeacherReviewImportRow[]
  counts: TeacherReviewImportCounts
  issues: Array<{ rowNumber: number | null; kind: 'invalid' | 'conflict' | 'duplicate'; message: string }>
}

export interface TeacherReviewImportResult extends TeacherReviewImportCounts {
  cancelled: boolean
  applied: boolean
  fileName?: string
  message?: string
  summary?: GradingQueueSummary
}
