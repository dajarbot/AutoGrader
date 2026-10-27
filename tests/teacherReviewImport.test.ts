import { afterEach, describe, expect, it } from 'vitest'
import type ExcelJS from 'exceljs'
import { AutoGraderDatabase } from '../src/main/database'
import { buildScoresWorkbook } from '../src/main/spreadsheetExport'
import { parseTeacherReviewWorkbook } from '../src/main/teacherReviewImport'
import type { SpreadsheetExportData } from '../src/shared/contracts'

const data: SpreadsheetExportData = {
  assignmentId: 'assignment-1',
  assignmentName: 'Review import test',
  questionText: 'Explain the response.',
  templateVersionId: 'template-1',
  templateName: 'Test rubric',
  templateVersion: 1,
  rubric: {
    name: 'Test rubric',
    criteria: [
      {
        key: 'development',
        name: 'Development',
        maxScore: 2,
        includedInTotal: true,
        levels: [
          { score: 0, descriptor: 'No development.' },
          { score: 1, descriptor: 'Some development.' },
          { score: 2, descriptor: 'Strong development.' }
        ]
      },
      {
        key: 'conventions',
        name: 'Conventions',
        maxScore: 1,
        includedInTotal: true,
        levels: [
          { score: 0, descriptor: 'Errors interfere.' },
          { score: 1, descriptor: 'Meaning remains clear.' }
        ]
      }
    ],
    rules: []
  },
  rows: [
    scoreRow('submission-1', 'attempt-1', 'Student One', 1, 1),
    scoreRow('submission-2', 'attempt-2', 'Student Two', 1, 1)
  ]
}

function scoreRow(
  submissionId: string,
  gradingAttemptId: string,
  studentName: string,
  development: number,
  conventions: number
): SpreadsheetExportData['rows'][number] {
  return {
    submissionId,
    gradingAttemptId,
    teacherName: 'Teacher A',
    sourceFileName: 'Teacher_A_42_F-001.pdf',
    studentIndex: 1,
    pageNumber: 1,
    pageEndNumber: 1,
    studentId: submissionId,
    studentName,
    grade: 7,
    responseText: 'Student response.',
    reviewStatus: 'AI draft',
    modelName: 'local-test-model',
    approvedAt: null,
    result: {
      criteria: [
        { key: 'development', name: 'Development', score: development, maxScore: 2, comment: 'AI development note.' },
        { key: 'conventions', name: 'Conventions', score: conventions, maxScore: 1, comment: 'AI conventions note.' }
      ],
      totalScore: development + conventions,
      maxTotalScore: 3,
      overallComment: 'AI overall note.'
    }
  }
}

function column(sheet: ExcelJS.Worksheet, header: string): number {
  let found = 0
  sheet.getRow(1).eachCell((cell, columnNumber) => {
    if (cell.value === header) found = columnNumber
  })
  if (!found) throw new Error(`Missing test header: ${header}`)
  return found
}

describe('teacher review workbook import', () => {
  it('parses accepted and corrected rows while leaving blank decisions untouched', () => {
    const workbook = buildScoresWorkbook(data)
    const sheet = workbook.getWorksheet('Teacher Review')!
    sheet.getRow(2).getCell(column(sheet, 'Review decision')).value = 'Accept AI'
    sheet.getRow(2).getCell(column(sheet, 'Reviewer initials')).value = 'JD'
    sheet.getRow(3).getCell(column(sheet, 'Review decision')).value = 'Corrected'
    sheet.getRow(3).getCell(column(sheet, 'Reviewer initials')).value = 'MS'
    sheet.getRow(3).getCell(column(sheet, 'Teacher Development score')).value = 2
    sheet.getRow(3).getCell(column(sheet, 'Development correction reason')).value = 'Too strict'

    const preview = parseTeacherReviewWorkbook(workbook, data.assignmentId, data)

    expect(preview.issues).toEqual([])
    expect(preview.counts).toMatchObject({ reviewed: 2, accepted: 1, corrected: 1, untouched: 0 })
    expect(preview.rows[1]).toMatchObject({
      submissionId: 'submission-2',
      decision: 'Corrected',
      reviewerInitials: 'MS'
    })
    expect(preview.rows[1]?.criteria[0]).toMatchObject({ aiScore: 1, teacherScore: 2 })
  })

  it('rejects a correction without a reason', () => {
    const workbook = buildScoresWorkbook({ ...data, rows: [data.rows[0]!] })
    const sheet = workbook.getWorksheet('Teacher Review')!
    sheet.getRow(2).getCell(column(sheet, 'Review decision')).value = 'Corrected'
    sheet.getRow(2).getCell(column(sheet, 'Reviewer initials')).value = 'JD'
    sheet.getRow(2).getCell(column(sheet, 'Teacher Development score')).value = 2

    const preview = parseTeacherReviewWorkbook(workbook, data.assignmentId, { ...data, rows: [data.rows[0]!] })

    expect(preview.counts.invalid).toBe(1)
    expect(preview.issues[0]?.message).toContain('correction reason')
    expect(preview.rows).toEqual([])
  })

  it('rejects tampered AI values and duplicate reviewed submission identifiers', () => {
    const workbook = buildScoresWorkbook(data)
    const sheet = workbook.getWorksheet('Teacher Review')!
    for (const rowNumber of [2, 3]) {
      sheet.getRow(rowNumber).getCell(column(sheet, 'Review decision')).value = 'Accept AI'
      sheet.getRow(rowNumber).getCell(column(sheet, 'Reviewer initials')).value = 'JD'
    }
    sheet.getRow(2).getCell(column(sheet, 'AI Development score')).value = 2
    sheet.getRow(3).getCell(column(sheet, 'Submission ID')).value = 'submission-1'

    const preview = parseTeacherReviewWorkbook(workbook, data.assignmentId, data)

    expect(preview.counts.conflicts).toBe(1)
    expect(preview.counts.duplicates).toBe(1)
    expect(preview.rows).toEqual([])
  })
})

describe.skipIf(!process.versions.electron)('teacher review database import', () => {
  let database: AutoGraderDatabase | undefined
  afterEach(() => database?.close())

  it('creates an audited approval revision and rejects a repeated workbook', () => {
    database = new AutoGraderDatabase(':memory:')
    const template = database.listTemplates().find((item) => item.status === 'published')!
    const assignment = database.createAssignment({
      name: 'Teacher import',
      grade: 7,
      questionText: 'Explain the response.',
      templateVersionId: template.id
    })
    const submission = database.addImportedSubmission({
      assignmentId: assignment.id,
      sourcePath: '/tmp/Teacher_A_42_F-001.pdf',
      sourceFileName: 'Teacher_A_42_F-001.pdf',
      contentHash: 'teacher-import-test',
      grade: 7
    }).submission
    database.approveSubmissionExtraction({
      id: submission.id,
      studentName: 'Student One',
      studentId: '1001',
      grade: 7,
      reviewedText: 'Student response.'
    })
    database.enqueueReadySubmissions(assignment.id, 'local-test-model')
    const work = database.claimNextGradingAttempt()!
    const aiResult = {
      criteria: template.rubric.criteria.map((criterion) => ({
        key: criterion.key,
        name: criterion.name,
        score: criterion.levels[0]!.score,
        maxScore: criterion.maxScore,
        comment: 'AI criterion note.'
      })),
      totalScore: template.rubric.criteria
        .filter((criterion) => criterion.includedInTotal)
        .reduce((sum, criterion) => sum + criterion.levels[0]!.score, 0),
      maxTotalScore: template.rubric.criteria
        .filter((criterion) => criterion.includedInTotal)
        .reduce((sum, criterion) => sum + criterion.maxScore, 0),
      overallComment: 'AI overall note.'
    }
    database.completeGradingAttempt(work.attemptId, aiResult)

    const context = database.teacherReviewImportContext(assignment.id)
    const workbook = buildScoresWorkbook(context)
    const sheet = workbook.getWorksheet('Teacher Review')!
    sheet.getRow(2).getCell(column(sheet, 'Review decision')).value = 'Accept AI'
    sheet.getRow(2).getCell(column(sheet, 'Reviewer initials')).value = 'JD'
    const preview = parseTeacherReviewWorkbook(workbook, assignment.id, context)
    const imported = database.applyTeacherReviewImport(preview, 'teacher-review.xlsx', 'hash-1')

    expect(imported.accepted).toBe(1)
    expect(database.getSubmission(submission.id)?.status).toBe('approved')
    const approval = database.db.prepare(
      'SELECT reviewer_name, result_json FROM approved_results WHERE submission_id = ?'
    ).get(submission.id) as { reviewer_name: string; result_json: string }
    expect(approval.reviewer_name).toBe('JD')
    expect(JSON.parse(approval.result_json)).toEqual(aiResult)
    const event = database.db.prepare(
      'SELECT decision, criterion_feedback_json, ai_result_json FROM teacher_review_events WHERE submission_id = ?'
    ).get(submission.id) as { decision: string; criterion_feedback_json: string; ai_result_json: string }
    expect(event.decision).toBe('Accept AI')
    expect(JSON.parse(event.criterion_feedback_json)[0]).toHaveProperty('delta', 0)
    expect(JSON.parse(event.ai_result_json)).toEqual(aiResult)
    expect(database.hasTeacherReviewImport('hash-1')).toBe(true)
    expect(() => database!.applyTeacherReviewImport(preview, 'teacher-review.xlsx', 'hash-1'))
      .toThrow('already been imported')
  })
})
