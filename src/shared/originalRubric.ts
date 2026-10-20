import type { RubricDefinition } from './contracts'

export const ORIGINAL_RUBRIC_KEY = 'staar-ecr-verbatim-original'

// User-supplied wording. Keep this baseline separate from the legacy rubric
// already attached to assignments; experiments are saved as copies/versions.
export const originalRubric: RubricDefinition = {
  name: 'Original ECR rubric — verbatim',
  criteria: [
    {
      key: 'development_organization',
      name: 'Development & Organization',
      maxScore: 3,
      includedInTotal: true,
      levels: [
        { score: 3, descriptor: 'Presents a clear, focused central idea; provides well-chosen, relevant evidence and explanations; ideas are well-organized and progress logically with purposeful transitions throughout.' },
        { score: 2, descriptor: 'Central idea is present and generally clear; evidence and explanations are mostly relevant but may be uneven; organization is apparent with some lapses in clarity or flow.' },
        { score: 1, descriptor: 'Central idea may be unclear or overly general; evidence is minimal, irrelevant, or weakly explained; organization is weak or confusing with frequent lapses.' },
        { score: 0, descriptor: 'No clear central idea; little to no relevant evidence; response may be off-topic, disorganized, or too brief to evaluate.' }
      ]
    },
    {
      key: 'conventions',
      name: 'Conventions',
      maxScore: 2,
      includedInTotal: true,
      levels: [
        { score: 2, descriptor: 'Demonstrates general command of sentence formation, grammar, usage, and mechanics; errors do not impede understanding.' },
        { score: 1, descriptor: 'Frequent errors in sentence structure, grammar, usage, or mechanics sometimes impede understanding.' },
        { score: 0, descriptor: 'Severe and frequent errors significantly impede understanding or make the response difficult to read.' }
      ]
    }
  ],
  rules: []
}
