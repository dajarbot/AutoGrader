import { expect, it } from 'vitest'
import { AutoGraderDatabase } from '../src/main/database'

it.skipIf(!process.versions.electron)('persists student page ranges and replaces unreviewed page splits', () => {
  const database = new AutoGraderDatabase(':memory:')
  try {
    const assignment = database.createAssignment({ name: 'Packet regression', grade: 8, questionText: 'Explain.', templateVersionId: database.listTemplates()[0]!.id })
    const root = database.addImportedSubmission({ assignmentId: assignment.id, sourcePath: 'packet.pdf', sourceFileName: 'packet.pdf', contentHash: 'packet', grade: 8 }).submission
    const student = (name: string, start: number, end: number) => ({
      studentName: name, studentId: '1234567', rawText: 'Original text', reviewedText: 'Complete response text.',
      pageNumber: start, pageEndNumber: end, status: 'extracted' as const, issueMessage: null
    })
    database.replaceDocumentExtraction({ rootSubmissionId: root.id, students: [student('First', 1, 1), student('Partial', 2, 2), student('Next', 3, 3)] })
    database.replaceDocumentExtraction({ rootSubmissionId: root.id, students: [student('First', 1, 2), student('Next', 3, 4)] })
    const rows = database.listSubmissions(assignment.id)
    expect(rows).toHaveLength(2)
    expect(rows.find((row) => row.studentName === 'First')).toMatchObject({ pageNumber: 1, pageEndNumber: 2 })
    expect(rows.find((row) => row.studentName === 'Next')).toMatchObject({ pageNumber: 3, pageEndNumber: 4 })
    expect(database.getSubmission(root.id)!.pageEndNumber).toBe(2)
    expect(database.acceptCleanExtractions(assignment.id)).toBe(2)
  } finally { database.close() }
})
