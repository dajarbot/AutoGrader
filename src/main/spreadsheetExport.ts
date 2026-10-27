import ExcelJS from 'exceljs'
import type { SpreadsheetExportData } from '../shared/contracts'
import { teacherCorrectionReasons, teacherReviewDecisions } from '../shared/teacherReview'

const headerFill = '334A3B'
const headerBorder = '26392E'
const stripeFill = 'F4F7F2'
const subtleBorder = 'D9E0DA'
const editableFill = 'FFF2CC'
const changedFill = 'FCE4D6'
const missingFill = 'F4CCCC'
const reviewWorkbookVersion = '1'

export function buildScoresWorkbook(data: SpreadsheetExportData): ExcelJS.Workbook {
  const workbook = new ExcelJS.Workbook()
  workbook.creator = 'AutoGrader'
  workbook.created = new Date()
  workbook.modified = new Date()
  workbook.subject = `${data.assignmentName} — ${data.templateName}`
  workbook.calcProperties.fullCalcOnLoad = true

  addTeacherReviewWorksheet(workbook, data)

  const worksheet = workbook.addWorksheet('Scores', {
    views: [{ state: 'frozen', xSplit: 7, ySplit: 1, showGridLines: false }]
  })

  const criterionColumns = data.rubric.criteria.flatMap((criterion) => [
    { header: `${criterion.name} score`, key: `score_${criterion.key}`, width: 16 },
    { header: `${criterion.name} minimum`, key: `minimum_${criterion.key}`, width: 16 },
    { header: `${criterion.name} maximum`, key: `maximum_${criterion.key}`, width: 16 },
    { header: `${criterion.name} rubric level`, key: `level_${criterion.key}`, width: 38 },
    { header: `${criterion.name} justification`, key: `comment_${criterion.key}`, width: 48 }
  ])

  worksheet.columns = [
    { header: 'Source PDF', key: 'sourceFileName', width: 26 },
    { header: 'Teacher', key: 'teacherName', width: 24 },
    { header: 'Student index', key: 'studentIndex', width: 13 },
    { header: 'PDF start page', key: 'pageNumber', width: 14 },
    { header: 'PDF end page', key: 'pageEndNumber', width: 14 },
    { header: 'Student ID', key: 'studentId', width: 15 },
    { header: 'Student name', key: 'studentName', width: 22 },
    { header: 'Grade', key: 'grade', width: 9 },
    { header: 'Overall category', key: 'overallCategory', width: 34 },
    { header: 'Total score', key: 'totalScore', width: 13 },
    { header: 'Minimum score', key: 'minTotalScore', width: 15 },
    { header: 'Maximum score', key: 'maxTotalScore', width: 15 },
    { header: 'Response', key: 'responseText', width: 55 },
    ...criterionColumns,
    { header: 'Scoring rationale', key: 'scoringRationale', width: 55 },
    { header: 'Overall feedback', key: 'overallComment', width: 42 },
    { header: 'Review status', key: 'reviewStatus', width: 15 },
    { header: 'Model used', key: 'modelName', width: 25 },
    { header: 'Approved at', key: 'approvedAt', width: 21 }
  ]

  for (const item of data.rows) {
    const criteriaByKey = new Map(item.result.criteria.map((criterion) => [criterion.key, criterion]))
    const minTotalScore = data.rubric.criteria
      .filter((criterion) => criterion.includedInTotal)
      .reduce((sum, criterion) => sum + (criterion.minScore ?? 0), 0)
    const rowValues: Record<string, string | number | Date | null> = {
      sourceFileName: item.sourceFileName,
      teacherName: item.teacherName,
      studentIndex: item.studentIndex,
      pageNumber: item.pageNumber,
      pageEndNumber: item.pageEndNumber,
      studentId: item.studentId,
      studentName: item.studentName,
      grade: item.grade,
      overallCategory: overallCategoryForRubric(data.rubric, item.result.totalScore, item.result.maxTotalScore),
      responseText: item.responseText,
      totalScore: item.result.totalScore,
      minTotalScore,
      maxTotalScore: item.result.maxTotalScore,
      scoringRationale: buildScoringRationale(data, item.result.criteria),
      overallComment: item.result.overallComment,
      reviewStatus: item.reviewStatus,
      modelName: item.modelName,
      approvedAt: item.approvedAt ? new Date(item.approvedAt) : null
    }
    for (const criterion of data.rubric.criteria) {
      const score = criteriaByKey.get(criterion.key)
      rowValues[`score_${criterion.key}`] = score?.score ?? (criterion.minScore ?? 0)
      rowValues[`minimum_${criterion.key}`] = criterion.minScore ?? 0
      rowValues[`maximum_${criterion.key}`] = criterion.maxScore
      rowValues[`level_${criterion.key}`] = rubricLevelDescriptor(criterion, score?.score ?? (criterion.minScore ?? 0))
      rowValues[`comment_${criterion.key}`] = score?.comment ?? ''
    }
    const addedRow = worksheet.addRow(rowValues)
    const wrappedValues = [
      { value: rowValues.scoringRationale, width: 55 },
      { value: rowValues.overallComment, width: 42 },
      ...data.rubric.criteria.flatMap((criterion) => [
        { value: rowValues[`level_${criterion.key}`], width: 38 },
        { value: rowValues[`comment_${criterion.key}`], width: 48 }
      ])
    ]
    const requiredLines = Math.max(...wrappedValues.map(({ value, width }) => estimateWrappedLines(value, width)))
    addedRow.height = Math.min(300, Math.max(72, requiredLines * 13 + 8))
  }

  worksheet.autoFilter = {
    from: { row: 1, column: 1 },
    to: { row: 1, column: worksheet.columnCount }
  }
  worksheet.getRow(1).height = 44
  worksheet.getRow(1).eachCell((cell) => {
    cell.font = { name: 'Aptos', size: 10, bold: true, color: { argb: 'FFFFFFFF' } }
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: `FF${headerFill}` } }
    cell.alignment = { vertical: 'middle', horizontal: 'center', wrapText: true }
    cell.border = { bottom: { style: 'medium', color: { argb: `FF${headerBorder}` } } }
  })

  const responseColumn = worksheet.getColumn('responseText').number
  const rationaleColumn = worksheet.getColumn('scoringRationale').number
  const overallColumn = worksheet.getColumn('overallComment').number
  const approvedAtColumn = worksheet.getColumn('approvedAt').number
  const detailColumnNumbers = data.rubric.criteria.flatMap((criterion) => [
    worksheet.getColumn(`level_${criterion.key}`).number,
    worksheet.getColumn(`comment_${criterion.key}`).number
  ])
  const centeredColumnNumbers = [
    worksheet.getColumn('studentIndex').number,
    worksheet.getColumn('pageNumber').number,
    worksheet.getColumn('pageEndNumber').number,
    worksheet.getColumn('grade').number,
    worksheet.getColumn('totalScore').number,
    worksheet.getColumn('minTotalScore').number,
    worksheet.getColumn('maxTotalScore').number,
    ...data.rubric.criteria.flatMap((criterion) => [
      worksheet.getColumn(`score_${criterion.key}`).number,
      worksheet.getColumn(`minimum_${criterion.key}`).number,
      worksheet.getColumn(`maximum_${criterion.key}`).number
    ])
  ]
  worksheet.eachRow((row, rowNumber) => {
    if (rowNumber === 1) return
    row.eachCell({ includeEmpty: true }, (cell, columnNumber) => {
      cell.font = { name: 'Aptos', size: 10, color: { argb: 'FF27312A' } }
      cell.alignment = {
        vertical: 'top',
        horizontal: centeredColumnNumbers.includes(columnNumber) ? 'center' : 'left',
        wrapText: columnNumber === responseColumn || columnNumber === rationaleColumn || columnNumber === overallColumn || detailColumnNumbers.includes(columnNumber)
      }
      cell.border = { bottom: { style: 'thin', color: { argb: `FF${subtleBorder}` } } }
      if (rowNumber % 2 === 0) {
        cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: `FF${stripeFill}` } }
      }
    })
    row.getCell(worksheet.getColumn('studentId').number).numFmt = '@'
    row.getCell(approvedAtColumn).numFmt = 'mm/dd/yy h:mm AM/PM'
  })

  worksheet.pageSetup = {
    orientation: 'landscape',
    scale: 75,
    paperSize: 9,
    margins: { left: 0.25, right: 0.25, top: 0.5, bottom: 0.5, header: 0.2, footer: 0.2 }
  }
  worksheet.pageSetup.printTitlesRow = '1:1'
  worksheet.headerFooter.oddFooter = `&L${data.assignmentName}&RPage &P of &N`
  worksheet.properties.defaultRowHeight = 18
  return workbook
}

function addTeacherReviewWorksheet(workbook: ExcelJS.Workbook, data: SpreadsheetExportData): void {
  const worksheet = workbook.addWorksheet('Teacher Review', {
    views: [{ state: 'frozen', xSplit: 6, ySplit: 1, showGridLines: false }]
  })
  const criterionColumns = data.rubric.criteria.flatMap((criterion) => [
    { header: `AI ${criterion.name} score`, key: `ai_${criterion.key}`, width: 15 },
    { header: `Teacher ${criterion.name} score`, key: `teacher_${criterion.key}`, width: 18 },
    { header: `${criterion.name} correction reason`, key: `reason_${criterion.key}`, width: 25 },
    { header: `${criterion.name} rubric level`, key: `level_${criterion.key}`, width: 40 },
    { header: `${criterion.name} AI justification`, key: `comment_${criterion.key}`, width: 46 }
  ])

  worksheet.columns = [
    { header: 'Teacher', key: 'teacherName', width: 24 },
    { header: 'Review decision', key: 'reviewDecision', width: 20 },
    { header: 'Reviewer initials', key: 'reviewerInitials', width: 16 },
    { header: 'Student ID', key: 'studentId', width: 15 },
    { header: 'Student name', key: 'studentName', width: 22 },
    { header: 'Grade', key: 'grade', width: 9 },
    { header: 'Question', key: 'questionText', width: 38 },
    { header: 'Source PDF', key: 'sourceFileName', width: 28 },
    { header: 'PDF pages', key: 'pageRange', width: 13 },
    { header: 'Response', key: 'responseText', width: 55 },
    ...criterionColumns,
    { header: 'AI total', key: 'aiTotal', width: 12 },
    { header: 'Teacher total', key: 'teacherTotal', width: 14 },
    { header: 'Teacher note', key: 'teacherNote', width: 38 },
    { header: 'Model', key: 'modelName', width: 24 },
    { header: 'Rubric', key: 'rubricName', width: 32 },
    { header: 'Current status', key: 'currentStatus', width: 15 },
    { header: 'Assignment ID', key: 'assignmentId', width: 12 },
    { header: 'Submission ID', key: 'submissionId', width: 12 },
    { header: 'Grading attempt ID', key: 'gradingAttemptId', width: 12 },
    { header: 'Template version ID', key: 'templateVersionId', width: 12 },
    { header: 'Workbook format version', key: 'workbookVersion', width: 12 }
  ]

  for (const item of data.rows) {
    const criteriaByKey = new Map(item.result.criteria.map((criterion) => [criterion.key, criterion]))
    const rowValues: Record<string, string | number | null> = {
      teacherName: item.teacherName,
      reviewDecision: '',
      reviewerInitials: '',
      studentId: item.studentId,
      studentName: item.studentName,
      grade: item.grade,
      questionText: data.questionText,
      sourceFileName: item.sourceFileName,
      pageRange: pageRangeLabel(item.pageNumber, item.pageEndNumber),
      responseText: item.responseText,
      aiTotal: item.result.totalScore,
      teacherTotal: null,
      teacherNote: '',
      modelName: item.modelName,
      rubricName: `${data.templateName} · v${data.templateVersion}`,
      currentStatus: item.reviewStatus,
      assignmentId: data.assignmentId,
      submissionId: item.submissionId,
      gradingAttemptId: item.gradingAttemptId,
      templateVersionId: data.templateVersionId,
      workbookVersion: reviewWorkbookVersion
    }
    for (const criterion of data.rubric.criteria) {
      const result = criteriaByKey.get(criterion.key)
      const score = result?.score ?? (criterion.minScore ?? 0)
      rowValues[`ai_${criterion.key}`] = score
      rowValues[`teacher_${criterion.key}`] = score
      rowValues[`reason_${criterion.key}`] = ''
      rowValues[`level_${criterion.key}`] = rubricLevelDescriptor(criterion, score)
      rowValues[`comment_${criterion.key}`] = result?.comment ?? ''
    }

    const row = worksheet.addRow(rowValues)
    const teacherScoreCells = data.rubric.criteria
      .filter((criterion) => criterion.includedInTotal)
      .map((criterion) => row.getCell(worksheet.getColumn(`teacher_${criterion.key}`).number).address)
    row.getCell(worksheet.getColumn('teacherTotal').number).value = {
      formula: teacherScoreCells.length ? `SUM(${teacherScoreCells.join(',')})` : '0'
    }
    const wrappedValues = [
      { value: data.questionText, width: 38 },
      { value: item.responseText, width: 55 },
      ...data.rubric.criteria.flatMap((criterion) => [
        { value: rowValues[`level_${criterion.key}`], width: 40 },
        { value: rowValues[`comment_${criterion.key}`], width: 46 }
      ])
    ]
    const requiredLines = Math.max(...wrappedValues.map(({ value, width }) => estimateWrappedLines(value, width)))
    row.height = Math.min(240, Math.max(72, requiredLines * 13 + 8))
  }

  worksheet.autoFilter = {
    from: { row: 1, column: 1 },
    to: { row: 1, column: worksheet.columnCount }
  }
  worksheet.getRow(1).height = 44
  worksheet.getRow(1).eachCell((cell) => {
    cell.font = { name: 'Aptos', size: 10, bold: true, color: { argb: 'FFFFFFFF' } }
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: `FF${headerFill}` } }
    cell.alignment = { vertical: 'middle', horizontal: 'center', wrapText: true }
    cell.border = { bottom: { style: 'medium', color: { argb: `FF${headerBorder}` } } }
  })

  const wrappedColumns = new Set([
    worksheet.getColumn('questionText').number,
    worksheet.getColumn('responseText').number,
    worksheet.getColumn('teacherNote').number,
    ...data.rubric.criteria.flatMap((criterion) => [
      worksheet.getColumn(`level_${criterion.key}`).number,
      worksheet.getColumn(`comment_${criterion.key}`).number
    ])
  ])
  const editableColumns = new Set([
    worksheet.getColumn('reviewDecision').number,
    worksheet.getColumn('reviewerInitials').number,
    worksheet.getColumn('teacherNote').number,
    ...data.rubric.criteria.flatMap((criterion) => [
      worksheet.getColumn(`teacher_${criterion.key}`).number,
      worksheet.getColumn(`reason_${criterion.key}`).number
    ])
  ])
  const centeredColumns = new Set([
    worksheet.getColumn('grade').number,
    worksheet.getColumn('pageRange').number,
    worksheet.getColumn('aiTotal').number,
    worksheet.getColumn('teacherTotal').number,
    ...data.rubric.criteria.flatMap((criterion) => [
      worksheet.getColumn(`ai_${criterion.key}`).number,
      worksheet.getColumn(`teacher_${criterion.key}`).number
    ])
  ])

  worksheet.eachRow((row, rowNumber) => {
    if (rowNumber === 1) return
    row.eachCell({ includeEmpty: true }, (cell, columnNumber) => {
      cell.font = { name: 'Aptos', size: 10, color: { argb: 'FF27312A' } }
      cell.alignment = {
        vertical: 'top',
        horizontal: centeredColumns.has(columnNumber) ? 'center' : 'left',
        wrapText: wrappedColumns.has(columnNumber)
      }
      cell.border = { bottom: { style: 'thin', color: { argb: `FF${subtleBorder}` } } }
      if (editableColumns.has(columnNumber)) {
        cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: `FF${editableFill}` } }
        cell.protection = { locked: false }
      } else if (rowNumber % 2 === 0) {
        cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: `FF${stripeFill}` } }
      }
    })
    row.getCell(worksheet.getColumn('studentId').number).numFmt = '@'
    row.getCell(worksheet.getColumn('reviewDecision').number).dataValidation = {
      type: 'list',
      allowBlank: true,
      formulae: [`"${teacherReviewDecisions.join(',')}"`]
    }
    for (const criterion of data.rubric.criteria) {
      const aiCell = row.getCell(worksheet.getColumn(`ai_${criterion.key}`).number)
      const teacherCell = row.getCell(worksheet.getColumn(`teacher_${criterion.key}`).number)
      const reasonCell = row.getCell(worksheet.getColumn(`reason_${criterion.key}`).number)
      const allowedScores = [...criterion.levels].sort((a, b) => a.score - b.score).map((level) => level.score)
      teacherCell.dataValidation = {
        type: 'list',
        allowBlank: false,
        formulae: [`"${allowedScores.join(',')}"`]
      }
      reasonCell.dataValidation = {
        type: 'list',
        allowBlank: true,
        formulae: [`"${teacherCorrectionReasons.join(',')}"`]
      }
      worksheet.addConditionalFormatting({
        ref: teacherCell.address,
        rules: [{
          type: 'expression',
          priority: 1,
          formulae: [`${teacherCell.address}<>${aiCell.address}`],
          style: { fill: { type: 'pattern', pattern: 'solid', bgColor: { argb: `FF${changedFill}` }, fgColor: { argb: `FF${changedFill}` } } }
        }]
      })
      worksheet.addConditionalFormatting({
        ref: reasonCell.address,
        rules: [{
          type: 'expression',
          priority: 1,
          formulae: [`AND(${teacherCell.address}<>${aiCell.address},${reasonCell.address}="")`],
          style: { fill: { type: 'pattern', pattern: 'solid', bgColor: { argb: `FF${missingFill}` }, fgColor: { argb: `FF${missingFill}` } } }
        }]
      })
    }
  })

  for (const key of ['assignmentId', 'submissionId', 'gradingAttemptId', 'templateVersionId', 'workbookVersion']) {
    worksheet.getColumn(key).hidden = true
  }
  worksheet.pageSetup = {
    orientation: 'landscape',
    scale: 65,
    paperSize: 9,
    margins: { left: 0.25, right: 0.25, top: 0.5, bottom: 0.5, header: 0.2, footer: 0.2 }
  }
  worksheet.pageSetup.printTitlesRow = '1:1'
  worksheet.headerFooter.oddFooter = `&L${data.assignmentName} — Teacher Review&RPage &P of &N`
  worksheet.properties.defaultRowHeight = 18
}

function pageRangeLabel(pageNumber: number | null, pageEndNumber: number | null): string {
  if (pageNumber === null) return ''
  if (pageEndNumber === null || pageEndNumber === pageNumber) return String(pageNumber)
  return `${pageNumber}–${pageEndNumber}`
}

export function overallCategoryForRubric(
  rubric: SpreadsheetExportData['rubric'],
  totalScore: number,
  maxTotalScore: number
): string {
  const criterionKeys = new Set(rubric.criteria.map((criterion) => criterion.key))
  const isTelpasItem = criterionKeys.has('vocabulary') && criterionKeys.has('usage') && criterionKeys.has('completeness')
  if (isTelpasItem) return 'Item score only — no TELPAS proficiency classification'

  const isStaarEcr = maxTotalScore === 5 && criterionKeys.has('development_organization') && criterionKeys.has('conventions')
  if (!isStaarEcr) return 'No category defined for this rubric'
  return estimatedStaarPerformanceLevel(totalScore, maxTotalScore)
}

function estimatedStaarPerformanceLevel(totalScore: number, maxTotalScore: number): string {
  if (maxTotalScore <= 0) return 'Not available'
  const ratio = totalScore / maxTotalScore
  if (ratio >= 1) return 'Masters Grade Level'
  if (ratio >= 0.8) return 'Meets Grade Level'
  if (ratio >= 0.6) return 'Approaches Grade Level'
  return 'Did Not Meet Grade Level'
}

function rubricLevelDescriptor(
  criterion: SpreadsheetExportData['rubric']['criteria'][number],
  score: number
): string {
  return criterion.levels.find((level) => level.score === score)?.descriptor ?? `${score} of ${criterion.maxScore}`
}

function buildScoringRationale(
  data: SpreadsheetExportData,
  scores: SpreadsheetExportData['rows'][number]['result']['criteria']
): string {
  const scoresByKey = new Map(scores.map((score) => [score.key, score]))
  return data.rubric.criteria.map((criterion) => {
    const result = scoresByKey.get(criterion.key)
    const score = result?.score ?? (criterion.minScore ?? 0)
    const justification = result?.comment?.trim() || 'No criterion justification was saved.'
    return `${criterion.name} — ${score}/${criterion.maxScore}. ${justification}`
  }).join('\n\n')
}

function estimateWrappedLines(value: string | number | Date | null | undefined, columnWidth: number): number {
  const text = value == null ? '' : String(value)
  return text.split('\n').reduce((lines, segment) => lines + Math.max(1, Math.ceil(segment.length / columnWidth)), 0)
}

export async function writeScoresWorkbook(data: SpreadsheetExportData, filePath: string): Promise<void> {
  await buildScoresWorkbook(data).xlsx.writeFile(filePath)
}
