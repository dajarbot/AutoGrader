import type { TeacherReviewDecision } from './contracts'

export const teacherReviewDecisions: TeacherReviewDecision[] = [
  'Accept AI',
  'Corrected',
  'Needs follow-up',
  'Unscorable',
  'Extraction problem'
]

export const teacherCorrectionReasons = [
  'Too generous',
  'Too strict',
  'Limited vocabulary',
  'Imprecise wording',
  'Spelling interferes',
  'Simple sentence range',
  'Tense control weak',
  'Grammar interferes',
  'Missing prompt part',
  'Insufficient detail',
  'Weak cohesion',
  'Genre mismatch',
  'Copied prompt',
  'Extraction issue',
  'Other'
] as const
