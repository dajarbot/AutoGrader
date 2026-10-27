import { describe, expect, it } from 'vitest'
import { teacherNameFromSourceFile } from '../src/shared/teacherName'

describe('teacher filename parsing', () => {
  it('normalizes underscore and space variants into the same teacher name', () => {
    expect(teacherNameFromSourceFile('Duncan_Melanie_42_F-00311074_1.pdf')).toBe('Duncan Melanie')
    expect(teacherNameFromSourceFile('Duncan Melanie_42_F-00311074_2.pdf')).toBe('Duncan Melanie')
  })

  it('normalizes capitalization without changing name order', () => {
    expect(teacherNameFromSourceFile('JONES KY ANDREA_42_F-00177921_1.pdf')).toBe('Jones Ky Andrea')
  })

  it('does not guess when a filename does not match the supported convention', () => {
    expect(teacherNameFromSourceFile('period-1.pdf')).toBe('')
  })
})
