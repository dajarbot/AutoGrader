import { describe, expect, it } from 'vitest'
import { parseStudentText, parseStudentPages } from '../src/shared/parseStudentText'

describe('student PDF text parsing', () => {
  it('extracts dash-delimited identity and text following the response marker', () => {
    const parsed = parseStudentText(`Hem Owen - 1920064
Student Response
The speaker learns to remain calm and continue working toward the goal.
26-27_Black MS_CFA_G6_RLA_E_ECRMidCycleU2
Page 1 of 1`)

    expect(parsed.studentName).toBe('Hem Owen')
    expect(parsed.studentId).toBe('1920064')
    expect(parsed.responseText).toBe('The speaker learns to remain calm and continue working toward the goal.')
    expect(parsed.foundResponseMarker).toBe(true)
    expect(parsed.issues).toEqual([])
  })

  it('keeps fallback text visible but warns when the response marker is missing', () => {
    const parsed = parseStudentText(`Student Name: Jordan Lee
Student ID: 1234567
This is the response that still needs a boundary review.`)

    expect(parsed.studentName).toBe('Jordan Lee')
    expect(parsed.studentId).toBe('1234567')
    expect(parsed.responseText).toBe('This is the response that still needs a boundary review.')
    expect(parsed.issues).toContain('The “Student Response” marker was not found; review the extracted boundary.')
  })

  it('does not invent identity or response content', () => {
    const parsed = parseStudentText('')

    expect(parsed.studentName).toBeNull()
    expect(parsed.studentId).toBeNull()
    expect(parsed.responseText).toBe('')
    expect(parsed.issues).toContain('No student response text was extracted.')
  })
})

const footer = '\n26-27_Black MS_CFA_G8_RLA_E_ECRUnit2MidCycle\nPage 1 of 75\t© 2026 Renaissance Learning, Inc. All rights reserved.\t10/18/2026 04:54 PM'
const page = (num: number, text: string) => ({ num, text: text + footer })

describe('multi-page student packets', () => {
  it('joins name-only, item-only, response, and continuation pages until the next identity', () => {
    const students = parseStudentPages([
      page(1, 'First Student - 1234567\tFirst Student - 1234567'),
      page(2, 'CR Item # 1 - Possible Points: 5'),
      page(3, 'Student Response\nThe first student begins a response with supporting evidence.'),
      page(4, 'The first student finishes their conclusion here.'),
      page(5, 'Second Student - 7654321\nStudent Response\nThis is the next student and must stay separate.')
    ])
    expect(students).toHaveLength(2)
    expect(students[0]).toMatchObject({ studentName: 'First Student', studentId: '1234567', pageNumber: 1, pageEndNumber: 4, issues: [] })
    expect(students[0]!.responseText).toContain('finishes their conclusion')
    expect(students[0]!.responseText).not.toMatch(/CR Item|Renaissance|Page 1|26-27|Second Student/)
    expect(students[1]).toMatchObject({ studentId: '7654321', pageNumber: 5, pageEndNumber: 5 })
  })

  it('keeps a repeated same-student header with its response', () => {
    const students = parseStudentPages([
      page(1, 'Student Name: Jordan Lee\nStudent ID: 1234567\nStudent Response\nThis is the beginning of the response.'),
      page(2, 'Student Name: Jordan Lee\nStudent ID: 1234567\nStudent Response\nThis is the end of that same response.')
    ])
    expect(students).toHaveLength(1)
    expect(students[0]!.responseText).toBe('This is the beginning of the response.\n\nThis is the end of that same response.')
  })

  it('does not assign an orphan page to the following student or fill a blank answer with report headings', () => {
    const students = parseStudentPages([
      page(1, 'Student Response\nAn orphan answer with no preceding student header.'),
      page(2, 'Blank Student - 1234567'),
      page(3, 'CR Item # 1 - Possible Points: 5'),
      page(4, 'Next Student - 7654321\nStudent Response\nThe next student has a complete answer.')
    ])
    expect(students).toHaveLength(3)
    expect(students[0]!.studentId).toBeNull()
    expect(students[1]!.responseText).toBe('')
    expect(students[1]!.issues).toContain('No student response text was extracted.')
    expect(students[2]!.responseText).not.toContain('orphan')
  })
})
