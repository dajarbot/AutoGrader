import type { AssessmentQuestion } from '../../shared/contracts'
import garden from './assets/community-garden.png'
import park from './assets/park-story.png'
const images = { 'community-garden': garden, 'park-story': park }
export function QuestionContext({ question, grade }: { question: AssessmentQuestion; grade?: 6 | 7 | 8 | null }) {
  return <details className="question-context"><summary>{question.key.toUpperCase()} · {question.title} · Prompt and scoring guidance</summary>
    <p className="preline">{question.prompt}</p>
    {question.stimulusAsset && <img className="question-picture" src={images[question.stimulusAsset]} alt={`Original picture prompt: ${question.title}`} />}
    {question.stimulusDescription && <><h4>Picture description supplied to the model</h4><p>{question.stimulusDescription}</p></>}
    <h4>Question guidance</h4><p>{question.scoringNotes || 'Use the selected rubric.'}</p>
    {grade && <><h4>Grade {grade} guidance</h4><p>{question.gradeNotes[String(grade) as '6' | '7' | '8'] || 'Use the grade-appropriate rubric descriptors.'}</p></>}
  </details>
}
export function QuestionEditor({ questions, onChange }: { questions: AssessmentQuestion[]; onChange: (questions: AssessmentQuestion[]) => void }) {
  const update = (index: number, patch: Partial<AssessmentQuestion>) => onChange(questions.map((q,i) => i === index ? { ...q, ...patch } : q))
  return <div className="question-editors">{questions.map((q,index) => <fieldset key={q.key}><legend>{q.key.toUpperCase()} · {q.title}</legend>
    <label>Question {index+1} title<input value={q.title} maxLength={160} required onChange={e => update(index, { title: e.target.value })} /></label>
    <label>Question {index+1} prompt<textarea rows={5} value={q.prompt} maxLength={20000} required onChange={e => update(index, { prompt: e.target.value })} /></label>
    <label>Writing type<select value={q.genre} onChange={e => update(index, { genre: e.target.value as AssessmentQuestion['genre'] })}><option value="expository">Descriptive / Expository</option><option value="narrative">Narrative</option><option value="other">Other</option></select></label>
    <QuestionContext question={q} />
    <label>Verified picture description<textarea rows={4} value={q.stimulusDescription} maxLength={12000} onChange={e => update(index, { stimulusDescription: e.target.value })} /></label>
    <label className="rubric-check"><input type="checkbox" checked={q.referenceExamples ?? false} onChange={e => update(index, { referenceExamples: e.target.checked })} />Include official reference examples in scoring (experimental)</label><p>Uses separate 6–7 expository/narrative examples and 8–9 expository examples. No 8–9 narrative examples were supplied.</p>
    <label>Question-specific scoring notes<textarea rows={4} value={q.scoringNotes} maxLength={12000} onChange={e => update(index, { scoringNotes: e.target.value })} /></label>
    <details><summary>Grade-specific guidance · teacher-editable</summary><p>Grades 6 and 7 share the official 6–7 reference band. Grade 8 uses the 8–9 band. Any finer distinctions are local teacher guidance.</p>{(['6','7','8'] as const).map(grade => <label key={grade}>Grade {grade} notes<textarea rows={4} value={q.gradeNotes[grade]} maxLength={12000} onChange={e => update(index, { gradeNotes: { ...q.gradeNotes, [grade]: e.target.value } })} /></label>)}</details>
  </fieldset>)}</div>
}
