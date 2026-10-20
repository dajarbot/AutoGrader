import { describe, expect, it } from 'vitest'
import { parseStudentText } from '../src/shared/parseStudentText'

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
