import { describe, expect, it } from 'vitest'
import { staarRubric } from '../src/shared/defaultTemplate'
import { validateRubric } from '../src/shared/rubricValidation'

describe('rubric validation', () => {
  it('accepts the bundled STAAR rubric and calculates a five-point maximum', () => {
    const result = validateRubric(staarRubric)

    expect(result.valid).toBe(true)
    expect(result.errors).toEqual([])
    expect(result.maximumTotal).toBe(5)
  })

  it('rejects missing score descriptors', () => {
    const rubric = structuredClone(staarRubric)
    rubric.criteria[0]!.levels = rubric.criteria[0]!.levels.filter((level) => level.score !== 2)

    const result = validateRubric(rubric)

    expect(result.valid).toBe(false)
    expect(result.errors).toContain('Development & Organization is missing the descriptor for score 2.')
  })

  it('rejects rules that reference unknown criteria', () => {
    const rubric = structuredClone(staarRubric)
    rubric.rules[0]!.then.criterionKey = 'unknown_trait'

    const result = validateRubric(rubric)

    expect(result.valid).toBe(false)
    expect(result.errors).toContain('Rule references unknown criterion "unknown_trait".')
  })
})
