import { createHash } from 'node:crypto'
import type { RubricDefinition } from '../shared/contracts'
import type { AutoGraderDatabase, GradingWorkItem } from './database'
import type { ProviderStore } from './providerStore'

interface ModelCriterion {
  key: string
  score: number
  comment: string
}

interface ModelResult {
  criteria: ModelCriterion[]
  overallComment: string
}

const outputSchema = {
  type: 'object',
  additionalProperties: false,
  properties: {
    criteria: {
      type: 'array',
      description: 'One score and evidence-based teacher comment for each rubric criterion.',
      items: {
        type: 'object',
        additionalProperties: false,
        properties: {
          key: { type: 'string' },
          score: { type: 'integer' },
          comment: { type: 'string' }
        },
        required: ['key', 'score', 'comment']
      }
    },
    overallComment: {
      type: 'string',
      description: 'A brief teacher-facing summary with one strength and one concrete next step.'
    }
  },
  required: ['criteria', 'overallComment']
}

export class GradingWorker {
  private running = false
  private wakeRequested = false

  constructor(
    private readonly database: AutoGraderDatabase,
    private readonly providerStore: ProviderStore
  ) {}

  wake(): void {
    this.wakeRequested = true
    if (!this.running) void this.run()
  }

  private async run(): Promise<void> {
    this.running = true
    try {
      do {
        this.wakeRequested = false
        const apiKey = await this.providerStore.apiKey()
        if (!apiKey) return
        const item = this.database.claimNextGradingAttempt()
        if (!item) return
        const shouldContinue = await this.process(item, apiKey)
        this.wakeRequested = shouldContinue
      } while (this.wakeRequested)
    } finally {
      this.running = false
      if (this.wakeRequested) this.wake()
    }
  }

  private async process(item: GradingWorkItem, apiKey: string): Promise<boolean> {
    try {
      const response = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(item.modelName)}:generateContent`,
        {
          method: 'POST',
          headers: { 'content-type': 'application/json', 'x-goog-api-key': apiKey },
          body: JSON.stringify(buildGeminiRequest(item))
        }
      )

      if (!response.ok) {
        const details = await response.text()
        throw new Error(formatGeminiHttpError(response.status, safeProviderError(details), item.modelName))
      }
      const payload = await response.json() as {
        candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>
      }
      const text = payload.candidates?.[0]?.content?.parts?.map((part) => part.text ?? '').join('').trim()
      if (!text) throw new Error('Gemini returned no score result.')
      const result = validateAndNormalizeResult(JSON.parse(text), item.rubric)
      this.database.completeGradingAttempt(item.attemptId, result)
      return true
    } catch (error) {
      const message = error instanceof Error ? error.message : 'The grading request failed.'
      this.database.failGradingAttempt(
        item.attemptId,
        message
      )
      return !isSystemicProviderFailure(error, message)
    }
  }
}

export function buildGeminiRequest(item: GradingWorkItem) {
  return {
    systemInstruction: {
      parts: [{
        text: 'You are a careful STAAR writing rubric scorer. Score only the supplied response against the supplied task and rubric. Do not infer student identity. Return only the requested structured result.'
      }]
    },
    contents: [{ role: 'user', parts: [{ text: buildPrompt(item) }] }],
    generationConfig: {
      maxOutputTokens: 1024,
      responseFormat: {
        text: { mimeType: 'APPLICATION_JSON', schema: outputSchema }
      }
    }
  }
}

export function gradingFingerprint(input: {
  model: string
  assignmentMaterial: string
  response: string
  rubric: RubricDefinition
}): string {
  return createHash('sha256')
    .update(JSON.stringify(input))
    .digest('hex')
}

function buildPrompt(item: GradingWorkItem): string {
  return [
    `GRADE: ${item.grade ?? 'not specified'}`,
    'ASSIGNMENT MATERIAL:',
    item.assignmentMaterial,
    'RUBRIC:',
    JSON.stringify(item.rubric),
    'STUDENT RESPONSE:',
    item.responseText,
    'SCORING REQUIREMENTS:',
    '- Return one criterion entry for every rubric criterion using its exact key.',
    '- Use an integer score within each criterion range.',
    '- Base comments on evidence present in the response.',
    '- Keep comments concise and teacher-facing.',
    '- Include one strength and one concrete next step in overallComment.'
  ].join('\n\n')
}

export function validateAndNormalizeResult(value: unknown, rubric: RubricDefinition) {
  if (!value || typeof value !== 'object') throw new Error('The model result was not an object.')
  const candidate = value as Partial<ModelResult>
  if (!Array.isArray(candidate.criteria)) throw new Error('The model result omitted rubric criteria.')
  if (typeof candidate.overallComment !== 'string' || !candidate.overallComment.trim()) {
    throw new Error('The model result omitted the overall comment.')
  }

  const received = new Map<string, ModelCriterion>()
  for (const item of candidate.criteria) {
    if (!item || typeof item.key !== 'string' || !Number.isInteger(item.score) || typeof item.comment !== 'string') {
      throw new Error('The model returned an invalid criterion score.')
    }
    if (received.has(item.key)) throw new Error(`The model duplicated criterion "${item.key}".`)
    received.set(item.key, item)
  }

  const scores = new Map<string, number>()
  for (const criterion of rubric.criteria) {
    const item = received.get(criterion.key)
    if (!item) throw new Error(`The model omitted criterion "${criterion.key}".`)
    if (item.score < 0 || item.score > criterion.maxScore) {
      throw new Error(`The model returned an out-of-range score for "${criterion.key}".`)
    }
    scores.set(criterion.key, item.score)
  }

  for (const rule of rubric.rules) {
    if (scores.get(rule.when.criterionKey) === rule.when.equals) {
      scores.set(rule.then.criterionKey, rule.then.score)
    }
  }

  const criteria = rubric.criteria.map((criterion) => ({
    key: criterion.key,
    name: criterion.name,
    score: scores.get(criterion.key)!,
    maxScore: criterion.maxScore,
    comment: received.get(criterion.key)!.comment.trim()
  }))
  const totalScore = criteria
    .filter((item) => rubric.criteria.find((criterion) => criterion.key === item.key)?.includedInTotal)
    .reduce((sum, item) => sum + item.score, 0)
  const maxTotalScore = rubric.criteria
    .filter((criterion) => criterion.includedInTotal)
    .reduce((sum, criterion) => sum + criterion.maxScore, 0)

  return { criteria, totalScore, maxTotalScore, overallComment: candidate.overallComment.trim() }
}

export function isSystemicProviderFailure(error: unknown, message: string): boolean {
  if (error instanceof TypeError) return true
  return /^Gemini returned \d{3}:/.test(message) || /^Gemini model .+ is unavailable/.test(message)
}

export function formatGeminiHttpError(status: number, details: string, modelName: string): string {
  if (status === 404 && /no longer available|not found|not supported/i.test(details)) {
    return `Gemini model ${modelName} is unavailable for this API key. Select Gemini 3.5 Flash-Lite and retry one response.`
  }
  return `Gemini returned ${status}: ${details}`
}

function safeProviderError(details: string): string {
  try {
    const parsed = JSON.parse(details) as { error?: { message?: string } }
    return parsed.error?.message?.slice(0, 500) || 'request failed'
  } catch {
    return details.replace(/\s+/g, ' ').slice(0, 500) || 'request failed'
  }
}
