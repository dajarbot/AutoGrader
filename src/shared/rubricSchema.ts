import { z } from 'zod'

// Drafts may be incomplete, but must remain bounded and structurally safe.
export const rubricDraftSchema = z.object({
  name: z.string().max(160),
  scoringNotes: z.string().max(12000).optional(),
  criteria: z.array(z.object({
    key: z.string().max(100), name: z.string().max(160),
    minScore: z.number().int().min(0).max(20).optional(),
    maxScore: z.number().int().min(0).max(20), includedInTotal: z.boolean(),
    levels: z.array(z.object({ score: z.number().int().min(0).max(20), descriptor: z.string().max(4000) })).max(21)
  })).max(20),
  rules: z.array(z.object({
    type: z.literal('force_score'),
    when: z.object({ criterionKey: z.string().max(100), equals: z.number().int().min(0).max(20) }),
    then: z.object({ criterionKey: z.string().max(100), score: z.number().int().min(0).max(20) }),
    explanation: z.string().max(2000)
  })).max(20)
})
