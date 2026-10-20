import { expect, it } from 'vitest'
import { extractStudentPdf } from '../src/main/extraction'

it.skipIf(!process.env.PACKET_PDF)('groups the supplied 75-page regression packet by student', async () => {
  const students = await extractStudentPdf(process.env.PACKET_PDF!)
  expect(students[0]).toMatchObject({ pageNumber: 1, pageEndNumber: 2, issues: [] })
  expect(students[1]).toMatchObject({ pageNumber: 3, pageEndNumber: 6, issues: [] })
  expect(students[1]!.responseText).toContain('The conclusion')
  expect(students.every((student) => student.studentId && student.studentName)).toBe(true)
  expect(new Set(students.map((student) => student.studentId)).size).toBe(students.length)
  expect(students.at(-1)!.pageEndNumber).toBe(75)
  expect(students.reduce((count, student) => count + student.pageEndNumber - student.pageNumber + 1, 0)).toBe(75)
  expect(students.every((student) => !/Renaissance|Page \d+ of 75|26-27_Black/.test(student.responseText))).toBe(true)
  console.log(`Packet check: ${students.length} students across 75 pages; ${students.filter((s) => s.issues.length).length} require review.`)
}, 30_000)
