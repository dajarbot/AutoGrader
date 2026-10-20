import { describe, expect, it } from 'vitest'
import { buildOllamaRequest, formatOllamaHttpError, isSystemicProviderFailure, validateAndNormalizeResult } from '../src/main/grading'
import { staarRubric } from '../src/shared/defaultTemplate'

describe('grading result validation', () => {
  it('requests local structured JSON with bounded deterministic generation', () => {
    const request = buildOllamaRequest({
      attemptId: 'attempt', submissionId: 'submission', modelName: 'mistral:latest', grade: 6,
      assignmentMaterial: 'Explain the central idea.', responseText: 'The student response.', rubric: staarRubric
    })
    expect(request.model).toBe('mistral:latest')
    expect(request.stream).toBe(false)
    expect(request.format.required).toEqual(['criteria', 'overallComment'])
    expect(request.options.temperature).toBe(0)
    expect(request.options.num_predict).toBe(2048)
    expect(request.messages[1]!.content).toContain('The student response.')
    expect(request.messages[1]!.content).not.toContain('submission')
  })

  it('explains missing models and pauses the queue', () => {
    const message = formatOllamaHttpError(404, 'model not found', 'mistral:latest')
    expect(message).toContain('ollama pull mistral:latest')
    expect(isSystemicProviderFailure(new Error(message), message)).toBe(true)
  })

  it('pauses on HTTP, connection, and timeout errors but not invalid scores', () => {
    expect(isSystemicProviderFailure(new Error('server'), 'Ollama returned 500: out of memory')).toBe(true)
    expect(isSystemicProviderFailure(new TypeError('fetch failed'), 'fetch failed')).toBe(true)
    const timeout = new Error('timeout')
    timeout.name = 'TimeoutError'
    expect(isSystemicProviderFailure(timeout, timeout.message)).toBe(true)
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
