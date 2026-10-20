import { describe, expect, it } from 'vitest'
import { buildGeminiRequest, formatGeminiHttpError, isSystemicProviderFailure, validateAndNormalizeResult } from '../src/main/grading'
import { staarRubric } from '../src/shared/defaultTemplate'

describe('grading result validation', () => {
  it('uses the REST enum required for JSON structured output', () => {
    const request = buildGeminiRequest({
      attemptId: 'attempt',
      submissionId: 'submission',
      modelName: 'gemini-3.8-flash',
      grade: 6,
      assignmentMaterial: 'Explain the central idea.',
      responseText: 'The student response.',
      rubric: staarRubric
    })
    expect(request.generationConfig.responseFormat.text.mimeType).toBe('APPLICATION_JSON')
  })

  it('uses minimal-cost defaults and caps output for Flash-Lite', () => {
    const request = buildGeminiRequest({
      attemptId: 'attempt', submissionId: 'submission', modelName: 'gemini-3.5-flash-lite', grade: 6,
      assignmentMaterial: 'Explain the central idea.', responseText: 'The student response.', rubric: staarRubric
    })
    expect(request.generationConfig.maxOutputTokens).toBe(1024)
    expect(request.generationConfig).not.toHaveProperty('temperature')
    expect(request.generationConfig).not.toHaveProperty('thinkingConfig')
  })

  it('explains retired model errors with an actionable replacement', () => {
    const message = formatGeminiHttpError(404, 'This model is no longer available to new users.', 'gemini-2.5-flash-lite')
    expect(message).toContain('Select Gemini 3.5 Flash-Lite')
    expect(isSystemicProviderFailure(new Error(message), message)).toBe(true)
  })

  it('pauses the queue for every provider HTTP error, including billing failures', () => {
    expect(isSystemicProviderFailure(new Error('billing'), 'Gemini returned 402: credits depleted')).toBe(true)
    expect(isSystemicProviderFailure(new Error('rate'), 'Gemini returned 429: rate limited')).toBe(true)
    expect(isSystemicProviderFailure(new Error('bad score'), 'The model omitted criterion "conventions".')).toBe(false)
  })

  it('computes totals from the rubric instead of trusting the model', () => {
    const result = validateAndNormalizeResult({
      criteria: [
        { key: 'development_organization', score: 3, comment: 'Clear central idea and progression.' },
        { key: 'conventions', score: 2, comment: 'Consistent sentence control.' }
      ],
      overallComment: 'Strong development; add even more precise evidence.'
    }, staarRubric)

    expect(result.totalScore).toBe(5)
    expect(result.maxTotalScore).toBe(5)
  })

  it('enforces the zero development rule in application code', () => {
    const result = validateAndNormalizeResult({
      criteria: [
        { key: 'development_organization', score: 0, comment: 'No scoreable development.' },
        { key: 'conventions', score: 2, comment: 'Model-provided score is overridden.' }
      ],
      overallComment: 'The response needs a scoreable central idea.'
    }, staarRubric)

    expect(result.criteria.find((criterion) => criterion.key === 'conventions')?.score).toBe(0)
    expect(result.totalScore).toBe(0)
  })

  it('rejects missing rubric criteria', () => {
    expect(() => validateAndNormalizeResult({
      criteria: [{ key: 'development_organization', score: 2, comment: 'Some development.' }],
      overallComment: 'Keep revising.'
    }, staarRubric)).toThrow('omitted criterion')
  })
})
