import type { RubricDefinition, ScoringRule } from './contracts'

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
  if (rubric.criteria.length > 20) errors.push('Use at most 20 criteria.')

  for (const criterion of rubric.criteria) {
    const minimum = criterion.minScore ?? 0
    if (!Number.isInteger(minimum) || minimum < 0 || minimum > criterion.maxScore) {
      errors.push(`${criterion.name || criterion.key} must have an integer minimum between 0 and its maximum.`)
    }
    if (!/^[a-z][a-z0-9_]*$/.test(criterion.key)) errors.push('Criterion keys must start with a lowercase letter and use only lowercase letters, digits, or underscores.')
    if (keys.has(criterion.key)) errors.push(`Criterion key "${criterion.key}" is duplicated.`)
    keys.add(criterion.key)

    if (!criterion.name.trim()) errors.push(`Criterion "${criterion.key}" needs a name.`)
    if (!Number.isInteger(criterion.maxScore) || criterion.maxScore < 0 || criterion.maxScore > 20) {
      errors.push(`${criterion.name || criterion.key} must have an integer maximum between 0 and 20.`)
    }

    const scores = criterion.levels.map((level) => level.score)
    const uniqueScores = new Set(scores)
    if (scores.length !== uniqueScores.size) errors.push(`${criterion.name} has duplicate score levels.`)
    for (let score = Math.max(0, minimum); score <= Math.min(20, criterion.maxScore); score += 1) {
      if (!uniqueScores.has(score)) errors.push(`${criterion.name} is missing the descriptor for score ${score}.`)
    }
    for (const level of criterion.levels) {
      if (!level.descriptor.trim()) errors.push(`${criterion.name} score ${level.score} needs a descriptor.`)
      if (!Number.isInteger(level.score) || level.score < minimum || level.score > criterion.maxScore) {
        errors.push(`${criterion.name} score ${level.score} is outside ${minimum}–${criterion.maxScore}.`)
      }
    }
  }

  const targets = new Set<string>()
  for (const rule of rubric.rules) {
    if (!keys.has(rule.when.criterionKey)) errors.push(`Rule references unknown criterion "${rule.when.criterionKey}".`)
    if (!keys.has(rule.then.criterionKey)) errors.push(`Rule references unknown criterion "${rule.then.criterionKey}".`)
    const source = rubric.criteria.find((criterion) => criterion.key === rule.when.criterionKey)
    const target = rubric.criteria.find((criterion) => criterion.key === rule.then.criterionKey)
    if (!Number.isInteger(rule.when.equals) || rule.when.equals < (source?.minScore ?? 0) || (source && rule.when.equals > source.maxScore)) errors.push('Rule trigger score is outside its criterion range.')
    if (!Number.isInteger(rule.then.score) || rule.then.score < (target?.minScore ?? 0) || (target && rule.then.score > target.maxScore)) errors.push('Rule result score is outside its criterion range.')
    if (!rule.explanation.trim()) errors.push('Every scoring rule needs an explanation.')
    if (targets.has(rule.then.criterionKey)) errors.push('Each criterion can be adjusted by only one rule.')
    targets.add(rule.then.criterionKey)
  }

  try { orderedRules(rubric.rules) } catch { errors.push('Scoring rules must not contain a cycle or refer back to the same criterion.') }

  const maximumTotal = rubric.criteria
    .filter((criterion) => criterion.includedInTotal)
    .reduce((sum, criterion) => sum + criterion.maxScore, 0)

  if (maximumTotal <= 0) errors.push('At least one scored criterion must contribute to the total.')

  return { valid: errors.length === 0, errors, maximumTotal }
}

function orderedRules(rules: ScoringRule[]): ScoringRule[] {
  const visiting = new Set<string>()
  const ranks = new Map<string, number>()
  function rank(key: string): number {
    if (visiting.has(key)) throw new Error('Cyclic scoring rules.')
    if (ranks.has(key)) return ranks.get(key)!
    visiting.add(key)
    const incoming = rules.filter((rule) => rule.then.criterionKey === key)
    const value = incoming.length ? Math.max(...incoming.map((rule) => rank(rule.when.criterionKey) + 1)) : 0
    visiting.delete(key); ranks.set(key, value)
    return value
  }
  for (const rule of rules) rank(rule.then.criterionKey)
  return [...rules].sort((a, b) => rank(a.then.criterionKey) - rank(b.then.criterionKey))
}

export function applyScoringRules(scores: Map<string, number>, rubric: RubricDefinition): void {
  for (const rule of orderedRules(rubric.rules)) {
    if (scores.get(rule.when.criterionKey) === rule.when.equals) scores.set(rule.then.criterionKey, rule.then.score)
  }
}
