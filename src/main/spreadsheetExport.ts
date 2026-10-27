import { assessmentSummaryRows } from '../shared/assessmentExport'
import ExcelJS from 'exceljs'
import type { SpreadsheetExportData } from '../shared/contracts'

const headerFill = '334A3B'
const headerBorder = '26392E'
const stripeFill = 'F4F7F2'
const subtleBorder = 'D9E0DA'

export function buildScoresWorkbook(data: SpreadsheetExportData): ExcelJS.Workbook {
  const workbook = new ExcelJS.Workbook()
  workbook.creator = 'AutoGrader'
  workbook.created = new Date()
  workbook.modified = new Date()
  workbook.subject = `${data.assignmentName} — ${data.templateName}`

  if ((data.questions?.length ?? 0) > 1) {
    const summary = workbook.addWorksheet('Student summary', { views: [{ state: 'frozen', ySplit: 1 }] })
    const maximum = data.rubric.criteria.filter(c => c.includedInTotal).reduce((sum,c) => sum+c.maxScore,0)
    summary.columns = [
      { header: 'Student ID', key: 'studentId', width: 18 }, { header: 'Student name', key: 'studentName', width: 26 }, { header: 'Grade', key: 'grade', width: 10 },
      ...data.questions!.flatMap(q => [
        { header: `${q.key.toUpperCase()} ${q.title} — status`, key: `${q.key}_status`, width: 30 },
        ...data.rubric.criteria.map(c => ({ header: `${q.key.toUpperCase()} ${c.name} (${c.minScore ?? 0}–${c.maxScore})`, key: `${q.key}_${c.key}`, width: 22 })),
        { header: `${q.key.toUpperCase()} total / ${maximum}`, key: `${q.key}_total`, width: 18 }
      ]),
      { header: `Combined classroom total / ${maximum * data.questions!.length}`, key: 'combinedTotal', width: 26 },
      { header: 'Completion / review status', key: 'completion', width: 28 }
    ]
    summary.addRows(assessmentSummaryRows(data))
    summary.getRow(1).height = 48
    summary.getRow(1).eachCell(cell => { cell.font = { bold: true, color: { argb: 'FFFFFFFF' } }; cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF334A3B' } }; cell.alignment = { wrapText: true, vertical: 'middle' } })
    summary.getColumn('studentId').numFmt = '@'
    summary.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: summary.columnCount } }
    summary.eachRow((row, i) => { if (i > 1) { row.height = 38; row.eachCell(cell => { cell.alignment = { wrapText: true, vertical: 'middle' } }) } })
  }
  const worksheet = workbook.addWorksheet('Scores' , {
    views: [{ state: 'frozen', xSplit: 4, ySplit: 1, showGridLines: false }]
  })

  const scoreColumns = data.rubric.criteria.map((criterion) => ({
    header: `${criterion.name} score`,
    key: `score_${criterion.key}`,
    width: 16
  }))
  const commentColumns = data.rubric.criteria.map((criterion) => ({
    header: `${criterion.name} comment`,
    key: `comment_${criterion.key}`,
    width: 42
  }))

  worksheet.columns = [
    { header: 'Source PDF', key: 'sourceFileName', width: 26 },
    { header: 'Student index', key: 'studentIndex', width: 13 },
    { header: 'Student ID', key: 'studentId', width: 15 },
    { header: 'Student name', key: 'studentName', width: 22 },
    { header: 'Grade', key: 'grade', width: 9 },
    { header: 'Response', key: 'responseText', width: 55 },
    ...scoreColumns,
    { header: 'Total score', key: 'totalScore', width: 13 },
    ...commentColumns,
    { header: 'Overall feedback', key: 'overallComment', width: 42 },
    { header: 'Review status', key: 'reviewStatus', width: 15 },
    { header: 'Model used', key: 'modelName', width: 25 },
    { header: 'Approved at', key: 'approvedAt', width: 21 },
    ...((data.questions?.length ?? 0) > 1 ? [{ header: 'Question', key: 'question', width: 30 }] : [])
  ]

  for (const item of data.rows) {
    const criteriaByKey = new Map(item.result.criteria.map((criterion) => [criterion.key, criterion]))
    const rowValues: Record<string, string | number | Date | null> = {
      sourceFileName: item.sourceFileName,
      question: data.questions?.find(q => q.key === item.questionKey)?.title ?? '',
      studentIndex: item.studentIndex,
      studentId: item.studentId,
      studentName: item.studentName,
      grade: item.grade,
      responseText: item.responseText,
      totalScore: item.result.totalScore,
      overallComment: item.result.overallComment,
      reviewStatus: item.reviewStatus,
      modelName: item.modelName,
      approvedAt: item.approvedAt ? new Date(item.approvedAt) : null
    }
    for (const criterion of data.rubric.criteria) {
      const score = criteriaByKey.get(criterion.key)
      rowValues[`score_${criterion.key}`] = score?.score ?? null
      rowValues[`comment_${criterion.key}`] = score?.comment ?? ''
    }
    worksheet.addRow(rowValues)
  }

  worksheet.autoFilter = {
    from: { row: 1, column: 1 },
    to: { row: 1, column: worksheet.columnCount }
  }
  worksheet.getRow(1).height = 30
  worksheet.getRow(1).eachCell((cell) => {
    cell.font = { name: 'Aptos', size: 10, bold: true, color: { argb: 'FFFFFFFF' } }
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: `FF${headerFill}` } }
    cell.alignment = { vertical: 'middle', horizontal: 'center', wrapText: true }
    cell.border = { bottom: { style: 'medium', color: { argb: `FF${headerBorder}` } } }
  })

  const responseColumn = worksheet.getColumn('responseText').number
  const overallColumn = worksheet.getColumn('overallComment').number
  const approvedAtColumn = worksheet.getColumn('approvedAt').number
  const commentColumnNumbers = data.rubric.criteria.map((criterion) => worksheet.getColumn(`comment_${criterion.key}`).number)
  worksheet.eachRow((row, rowNumber) => {
    if (rowNumber === 1) return
    row.height = 54
    row.eachCell({ includeEmpty: true }, (cell, columnNumber) => {
      cell.font = { name: 'Aptos', size: 10, color: { argb: 'FF27312A' } }
      cell.alignment = {
        vertical: 'top',
        horizontal: [2, 5, ...scoreColumns.map((_, index) => 7 + index), 7 + scoreColumns.length].includes(columnNumber) ? 'center' : 'left',
        wrapText: columnNumber === responseColumn || columnNumber === overallColumn || commentColumnNumbers.includes(columnNumber)
      }
      cell.border = { bottom: { style: 'thin', color: { argb: `FF${subtleBorder}` } } }
      if (rowNumber % 2 === 0) {
        cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: `FF${stripeFill}` } }
      }
    })
    row.getCell(3).numFmt = '@'
    row.getCell(approvedAtColumn).numFmt = 'mm/dd/yy h:mm AM/PM'
  })

  worksheet.pageSetup = {
    orientation: 'landscape',
    fitToPage: true,
    fitToWidth: 1,
    fitToHeight: 0,
    paperSize: 9,
    margins: { left: 0.25, right: 0.25, top: 0.5, bottom: 0.5, header: 0.2, footer: 0.2 }
  }
  worksheet.headerFooter.oddFooter = `&L${data.assignmentName}&RPage &P of &N`
  worksheet.properties.defaultRowHeight = 18
  return workbook
}

export async function writeScoresWorkbook(data: SpreadsheetExportData, filePath: string): Promise<void> {
  await buildScoresWorkbook(data).xlsx.writeFile(filePath)
}
