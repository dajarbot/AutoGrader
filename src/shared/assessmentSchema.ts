import { z } from 'zod'
export const assessmentQuestionSchema = z.object({
  key: z.string().regex(/^q[1-9][0-9]*$/), title: z.string().trim().min(1).max(160),
  prompt: z.string().trim().min(1).max(20000), genre: z.enum(['expository', 'narrative', 'other']),
  referenceExamples: z.boolean().optional(),
  stimulusDescription: z.string().max(12000), stimulusAsset: z.enum(['community-garden', 'park-story']).optional(),
  scoringNotes: z.string().max(12000), gradeNotes: z.object({ '6': z.string().max(12000), '7': z.string().max(12000), '8': z.string().max(12000) })
})
export const assessmentQuestionsSchema = z.array(assessmentQuestionSchema).min(1).max(2).refine(qs => new Set(qs.map(q => q.key)).size === qs.length, 'Question keys must be unique.')
