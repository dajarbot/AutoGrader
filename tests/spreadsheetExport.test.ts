import ExcelJS from 'exceljs'
import { describe, expect, it } from 'vitest'
import { buildScoresWorkbook } from '../src/main/spreadsheetExport'
import type { SpreadsheetExportData } from '../src/shared/contracts'

const exportData: SpreadsheetExportData = {
  assignmentName: 'STAAR calibration',
  templateName: 'STAAR ECR — Current School Rubric',
  rubric: {
    name: 'STAAR ECR',
    criteria: [
      { key: 'development_organization', name: 'Development & Organization', maxScore: 3, includedInTotal: true, levels: [] },
      { key: 'conventions', name: 'Conventions', maxScore: 2, includedInTotal: true, levels: [] }
    ],
    rules: []
  },
  rows: [
    {
      sourceFileName: 'period-1.pdf',
      studentIndex: 1,
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
      sourceFileName: 'period-1.pdf',
      studentIndex: 2,
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
      'Student index',
      'Student ID',
      'Student name',
      'Grade',
      'Response',
      'Development & Organization score',
      'Conventions score',
      'Total score',
      'Development & Organization comment',
      'Conventions comment',
      'Overall feedback',
      'Review status',
      'Model used',
      'Approved at'
    ])
    expect(sheet?.getCell('C2').value).toBe('001234')
    expect(sheet?.getCell('C2').numFmt).toBe('@')
    expect(sheet?.getCell('G2').value).toBe(2)
    expect(sheet?.getCell('I2').value).toBe(3)
    expect(sheet?.getCell('M3').value).toBe('AI draft')
    expect(sheet?.getCell('O2').value).toBeInstanceOf(Date)
    expect(sheet?.autoFilter).toBe('A1:O1')
    expect(sheet?.views[0]).toMatchObject({ state: 'frozen', xSplit: 4, ySplit: 1, showGridLines: false })
  })
})
