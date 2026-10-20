import type { RubricDefinition } from './contracts'

export interface RubricValidationResult {
  valid: boolean
  errors: string[]
  maximumTotal: number
}

export function validateRubric(rubric: RubricDefinition): RubricValidationResult {
  const errors: string[] = []
  const keys = new Set<string>()

  if (!rubric.name.trim()) errors.push('Rubric name is required.')
  if (!rubric.criteria.length) errors.push('At least one criterion is required.')

  for (const criterion of rubric.criteria) {
    if (!criterion.key.trim()) errors.push('Every criterion needs a stable key.')
    if (keys.has(criterion.key)) errors.push(`Criterion key "${criterion.key}" is duplicated.`)
    keys.add(criterion.key)

    if (!criterion.name.trim()) errors.push(`Criterion "${criterion.key}" needs a name.`)
    if (!Number.isInteger(criterion.maxScore) || criterion.maxScore < 0) {
      errors.push(`${criterion.name || criterion.key} must have a non-negative integer maximum.`)
    }

    const scores = criterion.levels.map((level) => level.score)
    const uniqueScores = new Set(scores)
    if (scores.length !== uniqueScores.size) errors.push(`${criterion.name} has duplicate score levels.`)
    for (let score = 0; score <= criterion.maxScore; score += 1) {
      if (!uniqueScores.has(score)) errors.push(`${criterion.name} is missing the descriptor for score ${score}.`)
    }
    for (const level of criterion.levels) {
      if (!level.descriptor.trim()) errors.push(`${criterion.name} score ${level.score} needs a descriptor.`)
      if (level.score < 0 || level.score > criterion.maxScore) {
        errors.push(`${criterion.name} score ${level.score} is outside 0–${criterion.maxScore}.`)
      }
    }
  }

  for (const rule of rubric.rules) {
    if (!keys.has(rule.when.criterionKey)) errors.push(`Rule references unknown criterion "${rule.when.criterionKey}".`)
    if (!keys.has(rule.then.criterionKey)) errors.push(`Rule references unknown criterion "${rule.then.criterionKey}".`)
  }

  const maximumTotal = rubric.criteria
    .filter((criterion) => criterion.includedInTotal)
    .reduce((sum, criterion) => sum + criterion.maxScore, 0)

  return { valid: errors.length === 0, errors, maximumTotal }
}
