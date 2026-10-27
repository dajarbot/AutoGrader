import ExcelJS from 'exceljs'
import type {
  SpreadsheetExportData,
  TeacherReviewDecision,
  TeacherReviewImportCounts,
  TeacherReviewImportPreview,
  TeacherReviewImportRow
} from '../shared/contracts'
import { applyScoringRules } from '../shared/rubricValidation'
import { teacherCorrectionReasons, teacherReviewDecisions } from '../shared/teacherReview'

const workbookVersion = '1'
const decisions = new Set<TeacherReviewDecision>(teacherReviewDecisions)
const correctionReasons = new Set<string>(teacherCorrectionReasons)

export async function readTeacherReviewWorkbook(
  filePath: string,
  expectedAssignmentId: string,
  context: SpreadsheetExportData
): Promise<TeacherReviewImportPreview> {
  const workbook = new ExcelJS.Workbook()
  await workbook.xlsx.readFile(filePath)
  return parseTeacherReviewWorkbook(workbook, expectedAssignmentId, context)
}

export function parseTeacherReviewWorkbook(
  workbook: ExcelJS.Workbook,
  expectedAssignmentId: string,
  context: SpreadsheetExportData
): TeacherReviewImportPreview {
  const worksheet = workbook.getWorksheet('Teacher Review')
  if (!worksheet) throw new Error('This workbook does not contain a Teacher Review sheet.')

  const headers = new Map<string, number>()
  worksheet.getRow(1).eachCell({ includeEmpty: false }, (cell, columnNumber) => {
    const header = literalText(cell).trim()
    if (header && !headers.has(header)) headers.set(header, columnNumber)
  })
  const requiredHeaders = [
    'Review decision',
    'Reviewer initials',
    'Teacher note',
    'Assignment ID',
    'Submission ID',
    'Grading attempt ID',
    'Template version ID',
    'Workbook format version',
    ...context.rubric.criteria.flatMap((criterion) => [
      `AI ${criterion.name} score`,
      `Teacher ${criterion.name} score`,
      `${criterion.name} correction reason`
    ])
  ]
  const missingHeaders = requiredHeaders.filter((header) => !headers.has(header))
  if (missingHeaders.length) {
    throw new Error(`The Teacher Review sheet is missing required columns: ${missingHeaders.join(', ')}.`)
  }

  const counts: TeacherReviewImportCounts = {
    reviewed: 0,
    accepted: 0,
    corrected: 0,
    needsFollowUp: 0,
    unscorable: 0,
    extractionProblems: 0,
    untouched: 0,
    invalid: 0,
    conflicts: 0,
    duplicates: 0
  }
  const issues: TeacherReviewImportPreview['issues'] = []
  const rows: TeacherReviewImportRow[] = []
  const seenSubmissions = new Set<string>()
  const contextRows = new Map(context.rows.map((row) => [row.submissionId, row]))

  for (let rowNumber = 2; rowNumber <= worksheet.actualRowCount; rowNumber += 1) {
    const row = worksheet.getRow(rowNumber)
    const decisionText = valueAt(row, headers, 'Review decision')
    if (!decisionText) {
      counts.untouched += 1
      continue
    }

    if (!decisions.has(decisionText as TeacherReviewDecision)) {
      addIssue(counts, issues, rowNumber, 'invalid', `Unknown review decision "${decisionText}".`)
      continue
    }
    const decision = decisionText as TeacherReviewDecision
    const reviewerInitials = valueAt(row, headers, 'Reviewer initials')
    const assignmentId = valueAt(row, headers, 'Assignment ID')
    const submissionId = valueAt(row, headers, 'Submission ID')
    const gradingAttemptId = valueAt(row, headers, 'Grading attempt ID')
    const templateVersionId = valueAt(row, headers, 'Template version ID')
    const rowWorkbookVersion = valueAt(row, headers, 'Workbook format version')

    if (!reviewerInitials) {
      addIssue(counts, issues, rowNumber, 'invalid', 'Reviewer initials are required for every reviewed row.')
      continue
    }
    if (!submissionId || !gradingAttemptId) {
      addIssue(counts, issues, rowNumber, 'conflict', 'The hidden submission or grading-attempt identifier is missing.')
      continue
    }
    if (seenSubmissions.has(submissionId)) {
      addIssue(counts, issues, rowNumber, 'duplicate', 'The submission appears more than once among reviewed rows.')
      continue
    }
    seenSubmissions.add(submissionId)
    if (assignmentId !== expectedAssignmentId || assignmentId !== context.assignmentId) {
      addIssue(counts, issues, rowNumber, 'conflict', 'The row belongs to a different assignment.')
      continue
    }
    if (templateVersionId !== context.templateVersionId) {
      addIssue(counts, issues, rowNumber, 'conflict', 'The row uses a different rubric version.')
      continue
    }
    if (rowWorkbookVersion !== workbookVersion) {
      addIssue(counts, issues, rowNumber, 'conflict', `Unsupported workbook format version "${rowWorkbookVersion || 'blank'}".`)
      continue
    }

    const source = contextRows.get(submissionId)
    if (!source || source.gradingAttemptId !== gradingAttemptId) {
      addIssue(counts, issues, rowNumber, 'conflict', 'The submission or AI grading attempt no longer matches this assignment.')
      continue
    }

    const sourceScores = new Map(source.result.criteria.map((criterion) => [criterion.key, criterion]))
    const criterionInputs: TeacherReviewImportRow['criteria'] = []
    let invalidMessage = ''
    for (const criterion of context.rubric.criteria) {
      const sourceScore = sourceScores.get(criterion.key)
      if (!sourceScore) {
        invalidMessage = `${criterion.name} is missing from the saved AI result.`
        break
      }
      const aiScore = numberAt(row, headers, `AI ${criterion.name} score`)
      const teacherScore = numberAt(row, headers, `Teacher ${criterion.name} score`)
      const reason = valueAt(row, headers, `${criterion.name} correction reason`)
      if (aiScore === null || aiScore !== sourceScore.score) {
        invalidMessage = `${criterion.name} AI score does not match the saved grading attempt.`
        break
      }
      if (teacherScore === null || !criterion.levels.some((level) => level.score === teacherScore)) {
        invalidMessage = `${criterion.name} teacher score must use one of the rubric levels.`
        break
      }
      criterionInputs.push({ key: criterion.key, aiScore, teacherScore, reason })
    }
    if (invalidMessage) {
      addIssue(counts, issues, rowNumber, 'conflict', invalidMessage)
      continue
    }

    const changed = criterionInputs.filter((criterion) => criterion.aiScore !== criterion.teacherScore)
    if (decision === 'Accept AI' && changed.length) {
      addIssue(counts, issues, rowNumber, 'invalid', 'Use Corrected when any teacher score differs from the AI score.')
      continue
    }
    if (decision === 'Corrected' && !changed.length) {
      addIssue(counts, issues, rowNumber, 'invalid', 'Corrected requires at least one changed criterion score.')
      continue
    }
    if (decision === 'Corrected' && changed.some((criterion) => !criterion.reason)) {
      addIssue(counts, issues, rowNumber, 'invalid', 'Every changed criterion requires a correction reason.')
      continue
    }
    if (decision === 'Corrected' && changed.some((criterion) => !correctionReasons.has(criterion.reason))) {
      addIssue(counts, issues, rowNumber, 'invalid', 'Every changed criterion must use a correction reason from the workbook list.')
      continue
    }
    if (!['Accept AI', 'Corrected'].includes(decision) && changed.length) {
      addIssue(counts, issues, rowNumber, 'invalid', 'Only Corrected rows may change criterion scores.')
      continue
    }
    if (decision === 'Corrected') {
      const requested = new Map(criterionInputs.map((criterion) => [criterion.key, criterion.teacherScore]))
      const normalized = new Map(requested)
      applyScoringRules(normalized, context.rubric)
      if ([...requested].some(([key, score]) => normalized.get(key) !== score)) {
        addIssue(counts, issues, rowNumber, 'invalid', 'The corrected scores conflict with a conditional rubric rule.')
        continue
      }
    }

    rows.push({
      rowNumber,
      submissionId,
      gradingAttemptId,
      reviewerInitials: reviewerInitials.slice(0, 80),
      decision,
      teacherNote: valueAt(row, headers, 'Teacher note').slice(0, 2000),
      criteria: criterionInputs
    })
    counts.reviewed += 1
    if (decision === 'Accept AI') counts.accepted += 1
    else if (decision === 'Corrected') counts.corrected += 1
    else if (decision === 'Needs follow-up') counts.needsFollowUp += 1
    else if (decision === 'Unscorable') counts.unscorable += 1
    else counts.extractionProblems += 1
  }

  return {
    assignmentId: context.assignmentId,
    templateVersionId: context.templateVersionId,
    workbookVersion,
    rows,
    counts,
    issues
  }
}

function valueAt(row: ExcelJS.Row, headers: Map<string, number>, header: string): string {
  return literalText(row.getCell(headers.get(header)!)).trim()
}

function numberAt(row: ExcelJS.Row, headers: Map<string, number>, header: string): number | null {
  const value = row.getCell(headers.get(header)!).value
  if (typeof value === 'number' && Number.isInteger(value)) return value
  if (typeof value === 'string' && /^-?\d+$/.test(value.trim())) return Number(value.trim())
  return null
}

function literalText(cell: ExcelJS.Cell): string {
  const value = cell.value
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') return String(value)
  if (value && typeof value === 'object' && 'text' in value && typeof value.text === 'string') return value.text
  return ''
}

function addIssue(
  counts: TeacherReviewImportCounts,
  issues: TeacherReviewImportPreview['issues'],
  rowNumber: number,
  kind: 'invalid' | 'conflict' | 'duplicate',
  message: string
): void {
  if (kind === 'invalid') counts.invalid += 1
  else if (kind === 'conflict') counts.conflicts += 1
  else counts.duplicates += 1
  issues.push({ rowNumber, kind, message })
}
