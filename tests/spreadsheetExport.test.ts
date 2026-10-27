import ExcelJS from 'exceljs'
import { describe, expect, it } from 'vitest'
import { buildScoresWorkbook, overallCategoryForRubric } from '../src/main/spreadsheetExport'
import type { SpreadsheetExportData } from '../src/shared/contracts'
import { telpasRubric } from '../src/shared/telpasRubric'

const exportData: SpreadsheetExportData = {
  assignmentId: '00000000-0000-4000-8000-000000000001',
  assignmentName: 'STAAR calibration',
  questionText: 'Explain how the character changes during the story.',
  templateVersionId: '00000000-0000-4000-8000-000000000002',
  templateName: 'STAAR ECR — Current School Rubric',
  templateVersion: 3,
  rubric: {
    name: 'STAAR ECR',
    criteria: [
      {
        key: 'development_organization',
        name: 'Development & Organization',
        maxScore: 3,
        includedInTotal: true,
        levels: [
          { score: 3, descriptor: 'Accomplished development and organization appropriate to the task.' },
          { score: 2, descriptor: 'Sufficient development and organization with some lapses.' },
          { score: 1, descriptor: 'Limited development or weak organization.' },
          { score: 0, descriptor: 'No evidence of scoreable development and organization.' }
        ]
      },
      {
        key: 'conventions',
        name: 'Conventions',
        maxScore: 2,
        includedInTotal: true,
        levels: [
          { score: 2, descriptor: 'Consistent command of grade-appropriate conventions.' },
          { score: 1, descriptor: 'Inconsistent command; errors are noticeable but meaning remains clear.' },
          { score: 0, descriptor: 'Little or no command; errors interfere with meaning.' }
        ]
      }
    ],
    rules: []
  },
  rows: [
    {
      submissionId: '00000000-0000-4000-8000-000000000003',
      gradingAttemptId: '00000000-0000-4000-8000-000000000004',
      teacherName: 'Duncan Melanie',
      sourceFileName: 'Duncan_Melanie_42_F-00311074_1.pdf',
      studentIndex: 1,
      pageNumber: 4,
      pageEndNumber: 6,
      studentId: '001234',
      studentName: 'Sample Student',
      grade: 8,
      responseText: 'A complete response.',
      reviewStatus: 'Approved',
      modelName: 'gemini-3.5-flash-lite',
      approvedAt: '2026-10-19T15:30:00.000Z',
      result: {
        criteria: [
          { key: 'development_organization', name: 'Development & Organization', score: 2, maxScore: 3, comment: 'Clear central idea.' },
          { key: 'conventions', name: 'Conventions', score: 1, maxScore: 2, comment: 'Some sentence errors.' }
        ],
        totalScore: 3,
        maxTotalScore: 5,
        overallComment: 'Strong start; revise sentence boundaries.'
      }
    },
    {
      submissionId: '00000000-0000-4000-8000-000000000005',
      gradingAttemptId: '00000000-0000-4000-8000-000000000006',
      teacherName: 'Duncan Melanie',
      sourceFileName: 'Duncan Melanie_42_F-00311074_2.pdf',
      studentIndex: 2,
      pageNumber: 7,
      pageEndNumber: 7,
      studentId: '009876',
      studentName: 'Draft Student',
      grade: 8,
      responseText: 'Another response.',
      reviewStatus: 'AI draft',
      modelName: 'gemini-3.5-flash-lite',
      approvedAt: null,
      result: {
        criteria: [
          { key: 'development_organization', name: 'Development & Organization', score: 1, maxScore: 3, comment: 'Needs more development.' },
          { key: 'conventions', name: 'Conventions', score: 1, maxScore: 2, comment: 'Meaning remains clear.' }
        ],
        totalScore: 2,
        maxTotalScore: 5,
        overallComment: 'AI draft awaiting teacher review.'
      }
    }
  ]
}

describe('spreadsheet export', () => {
  it('creates a readable, typed workbook with one row per student', async () => {
    const buffer = await buildScoresWorkbook(exportData).xlsx.writeBuffer()
    const reopened = new ExcelJS.Workbook()
    await reopened.xlsx.load(buffer)
    const sheet = reopened.getWorksheet('Scores')

    expect(sheet).toBeDefined()
    expect(sheet?.rowCount).toBe(3)
    expect(sheet?.getRow(1).values).toEqual([
      undefined,
      'Source PDF',
      'Teacher',
      'Student index',
      'PDF start page',
      'PDF end page',
      'Student ID',
      'Student name',
      'Grade',
      'Overall category',
      'Total score',
      'Minimum score',
      'Maximum score',
      'Response',
      'Development & Organization score',
      'Development & Organization minimum',
      'Development & Organization maximum',
      'Development & Organization rubric level',
      'Development & Organization justification',
      'Conventions score',
      'Conventions minimum',
      'Conventions maximum',
      'Conventions rubric level',
      'Conventions justification',
      'Scoring rationale',
      'Overall feedback',
      'Review status',
      'Model used',
      'Approved at'
    ])
    expect(sheet?.getCell('B2').value).toBe('Duncan Melanie')
    expect(sheet?.getCell('F2').value).toBe('001234')
    expect(sheet?.getCell('F2').numFmt).toBe('@')
    expect(sheet?.getCell('I2').value).toBe('Approaches Grade Level')
    expect(sheet?.getCell('J2').value).toBe(3)
    expect(sheet?.getCell('K2').value).toBe(0)
    expect(sheet?.getCell('L2').value).toBe(5)
    expect(sheet?.getCell('N2').value).toBe(2)
    expect(sheet?.getCell('Q2').value).toBe('Sufficient development and organization with some lapses.')
    expect(String(sheet?.getCell('X2').value)).toContain('Development & Organization — 2/3. Clear central idea.')
    expect(sheet?.getRow(2).height).toBeGreaterThanOrEqual(72)
    expect(sheet?.getCell('Z3').value).toBe('AI draft')
    expect(sheet?.getCell('AB2').value).toBeInstanceOf(Date)
    expect(sheet?.autoFilter).toBe('A1:AB1')
    expect(sheet?.views[0]).toMatchObject({ state: 'frozen', xSplit: 7, ySplit: 1, showGridLines: false })
  })

  it('creates a teacher-filterable round-trip review sheet', async () => {
    const buffer = await buildScoresWorkbook(exportData).xlsx.writeBuffer()
    const reopened = new ExcelJS.Workbook()
    await reopened.xlsx.load(buffer)
    const sheet = reopened.getWorksheet('Teacher Review')

    expect(reopened.worksheets.map((worksheet) => worksheet.name)).toEqual(['Teacher Review', 'Scores'])
    expect(sheet?.rowCount).toBe(3)
    expect(sheet?.getCell('A2').value).toBe('Duncan Melanie')
    expect(sheet?.getCell('B2').value).toBe('')
    expect(sheet?.getCell('D2').value).toBe('001234')
    expect(sheet?.getCell('I2').value).toBe('4–6')
    expect(sheet?.getCell('K2').value).toBe(2)
    expect(sheet?.getCell('L2').value).toBe(2)
    expect(sheet?.getCell('V2').value).toEqual({ formula: 'SUM(L2,Q2)' })
    expect(sheet?.getCell('B2').dataValidation).toMatchObject({ type: 'list', allowBlank: true })
    expect(sheet?.getCell('L2').dataValidation).toMatchObject({ type: 'list' })
    expect(sheet?.getCell('M2').dataValidation).toMatchObject({ type: 'list', allowBlank: true })
    expect(sheet?.getColumn('AA').hidden).toBe(true)
    expect(sheet?.getColumn('AB').hidden).toBe(true)
    expect(sheet?.getColumn('AC').hidden).toBe(true)
    expect(sheet?.getColumn('AD').hidden).toBe(true)
    expect(sheet?.getColumn('AE').hidden).toBe(true)
    expect(sheet?.getCell('AB2').value).toBe(exportData.rows[0]?.submissionId)
    expect(sheet?.autoFilter).toBe('A1:AE1')
    expect(sheet?.views[0]).toMatchObject({ state: 'frozen', xSplit: 6, ySplit: 1, showGridLines: false })
  })

  it('uses the five-point performance bands from the prior ScoresWide export', () => {
    expect(overallCategoryForRubric(exportData.rubric, 2, 5)).toBe('Did Not Meet Grade Level')
    expect(overallCategoryForRubric(exportData.rubric, 3, 5)).toBe('Approaches Grade Level')
    expect(overallCategoryForRubric(exportData.rubric, 4, 5)).toBe('Meets Grade Level')
    expect(overallCategoryForRubric(exportData.rubric, 5, 5)).toBe('Masters Grade Level')
  })

  it('does not convert TELPAS item totals into a proficiency classification', () => {
    expect(overallCategoryForRubric(telpasRubric, 9, 12)).toBe('Item score only — no TELPAS proficiency classification')
  })
})
