import { afterEach, describe, expect, it, vi } from 'vitest'
import { GradingWorker, buildOllamaRequest, validateAndNormalizeResult } from '../src/main/grading'
import { OLLAMA_URL } from '../src/main/providerStore'
import type { AutoGraderDatabase } from '../src/main/database'
import { staarRubric } from '../src/shared/defaultTemplate'

const item = {
  attemptId: 'attempt', submissionId: 'submission', modelName: 'mistral:latest', grade: 6 as const,
  assignmentMaterial: 'Explain why planting trees helps a neighborhood. Support your answer with examples.',
  responseText: 'Planting trees helps neighborhoods because trees give shade and homes to animals. On a hot day, people can sit under a tree to stay cool. Birds can build nests in the branches. These benefits make the neighborhood better for both people and wildlife.',
  rubric: staarRubric
}

afterEach(() => vi.unstubAllGlobals())

describe('Ollama worker', () => {
  it('stores validated local results without a credential', async () => {
    const result = {
      criteria: [{ key: 'development_organization', score: 2, comment: 'Some evidence.' }, { key: 'conventions', score: 2, comment: 'Clear sentences.' }],
      overallComment: 'Add more detail.'
    }
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ message: { content: JSON.stringify(result) } })))
    vi.stubGlobal('fetch', fetchMock)
    const database = {
      claimNextGradingAttempt: vi.fn().mockReturnValueOnce(item).mockReturnValue(null),
      completeGradingAttempt: vi.fn(),
      failGradingAttempt: vi.fn()
    }
    new GradingWorker(database as unknown as AutoGraderDatabase).wake()
    await vi.waitFor(() => expect(database.completeGradingAttempt).toHaveBeenCalled())
    expect(fetchMock.mock.calls[0]![0]).toBe(`${OLLAMA_URL}/api/chat`)
    expect(database.completeGradingAttempt.mock.calls[0]![1].totalScore).toBe(4)
    expect(database.failGradingAttempt).not.toHaveBeenCalled()
  })

  it('leaves remaining work queued when the local model is missing', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('{"error":"model not found"}', { status: 404 })))
    const database = {
      claimNextGradingAttempt: vi.fn().mockReturnValue(item),
      completeGradingAttempt: vi.fn(),
      failGradingAttempt: vi.fn()
    }
    new GradingWorker(database as unknown as AutoGraderDatabase).wake()
    await vi.waitFor(() => expect(database.failGradingAttempt).toHaveBeenCalled())
    expect(database.claimNextGradingAttempt).toHaveBeenCalledTimes(1)
    expect(database.failGradingAttempt.mock.calls[0]![1]).toContain('ollama pull')
  })
})

it.skipIf(process.env.OLLAMA_SMOKE !== '1')('grades a synthetic response using installed Mistral', async () => {
  const response = await fetch(`${OLLAMA_URL}/api/chat`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify(buildOllamaRequest(item)), signal: AbortSignal.timeout(600_000)
  })
  expect(response.ok).toBe(true)
  const payload = await response.json() as { message: { content: string } }
  const result = validateAndNormalizeResult(JSON.parse(payload.message.content), staarRubric)
  expect(result.criteria).toHaveLength(2)
  expect(result.totalScore).toBeGreaterThanOrEqual(0)
  expect(result.totalScore).toBeLessThanOrEqual(5)
}, 610_000)
