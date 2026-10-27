import type { SpreadsheetExportData } from './contracts'

// Missing, unreadable, unapproved, and duplicate answers never become zeroes.
export function assessmentSummaryRows(data: SpreadsheetExportData): Array<Record<string, string | number | null>> {
  const questions = data.questions ?? []
  const groups = new Map<string, NonNullable<SpreadsheetExportData['submissions']>>()
  for (const s of data.submissions ?? []) {
    const key = s.studentId ? `id:${s.studentId}` : `source:${s.sourceDocumentHash}:${s.studentIndex}`
    groups.set(key, [...(groups.get(key) ?? []), s])
  }
  return [...groups.values()].map(submissions => {
    const first = submissions[0]!
    const row: Record<string, string | number | null> = { studentId: first.studentId ?? '', studentName: first.studentName ?? '', grade: first.grade, combinedTotal: null, completion: 'Incomplete' }
    let total = 0, complete = true, allApproved = true
    if (new Set(submissions.map(s => s.grade)).size > 1) complete = false
    for (const q of questions) {
      const answers = submissions.filter(s => (s.questionKey ?? 'q1') === q.key)
      const answer = answers.length === 1 ? answers[0] : undefined
      const score = answer ? data.rows.find(r => (r.questionKey ?? 'q1') === q.key && r.sourceDocumentHash === answer.sourceDocumentHash && r.studentIndex === answer.studentIndex) : undefined
      row[`${q.key}_status`] = answers.length > 1 ? 'Duplicate answers — review required' : !answer ? 'Missing' : score?.reviewStatus ?? (answer.responseDisposition === 'missing' ? 'Missing' : answer.responseDisposition === 'unreadable' ? 'Unreadable' : answer.status === 'approved' ? 'Approved result unavailable' : 'Not approved/scored in this export')
      row[`${q.key}_total`] = score?.result.totalScore ?? null
      for (const criterion of data.rubric.criteria) row[`${q.key}_${criterion.key}`] = score?.result.criteria.find(c => c.key === criterion.key)?.score ?? null
      if (!score) complete = false
      else { total += score.result.totalScore; allApproved &&= score.reviewStatus === 'Approved' }
    }
    if (complete) { row.combinedTotal = total; row.completion = allApproved ? 'Both approved' : 'Includes AI draft' }
    return row
  })
}
