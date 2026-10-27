import { telpasReferenceText } from './telpasReferences'
import type { AssessmentQuestion, Assignment, Submission } from './contracts'

export function assignmentQuestions(assignment: Pick<Assignment, 'questionText' | 'questions'>): AssessmentQuestion[] {
  return assignment.questions?.length ? assignment.questions : [{ key: 'q1', title: 'Question 1', prompt: assignment.questionText, genre: 'other', stimulusDescription: '', scoringNotes: '', gradeNotes: { '6': '', '7': '', '8': '' } }]
}

export function questionMaterial(assignment: Pick<Assignment, 'questionText' | 'questions' | 'sharedScoringNotes'>, submission: Pick<Submission, 'questionKey' | 'grade'>): string {
  const question = assignmentQuestions(assignment).find(q => q.key === (submission.questionKey ?? 'q1'))
  if (!question) throw new Error('The response question is not part of this assessment.')
  if (!assignment.questions?.length && !assignment.sharedScoringNotes) return assignment.questionText
  return [
    `QUESTION: ${question.title}`, `GENRE: ${question.genre}`, question.prompt,
    question.stimulusDescription && `VERIFIED PICTURE CONTEXT (source material, not a model answer):\n${question.stimulusDescription}`,
    assignment.sharedScoringNotes && `SHARED SCORING GUIDANCE:\n${assignment.sharedScoringNotes}`,
    question.scoringNotes && `QUESTION SCORING GUIDANCE:\n${question.scoringNotes}`,
    submission.grade && `GRADE ${submission.grade} GUIDANCE:\n${question.gradeNotes[String(submission.grade) as '6' | '7' | '8']}`,
    question.referenceExamples && submission.grade && (question.referenceContext?.[String(submission.grade) as '6' | '7' | '8'] ?? telpasReferenceText(submission.grade, question.genre)),
    'Score this answer independently. Do not infer the quality of the student’s other answer. Never invent picture details or penalize reasonable story details that the prompt invites.'
  ].filter(Boolean).join('\n\n')
}

const band67 = 'Apply the common grades 4–12 rubric using the grade 6–7 guide as the reference band. Judge grade-appropriate range and control of language, with no age bonus, fixed word count, or requirement for perfect spelling. Grade 6 versus grade 7 distinctions are teacher guidance, not separate official scoring scales.'
const band8 = 'Apply the common grades 4–12 rubric using the grade 8–9 guide as the reference band. Judge grade-appropriate range and control of language, with no automatic grade penalty or fixed word count. Do not require specialist subject knowledge that the prompt does not ask for.'
export const octoberSharedNotes = 'Score Vocabulary, Usage, and Completeness separately, 1–4 each, for each question. Assess language and effective communication; do not treat the prompt bullets as separately weighted points. Missing or unreadable responses require review, not invented scores. This classroom assessment does not establish an official TELPAS proficiency level.'
export const octoberQuestions: AssessmentQuestion[] = [
  {
    key: 'q1', title: 'Community Garden', genre: 'expository',
    prompt: 'Look at the picture. Think about what you see and what you know about community gardens.\n• Describe what is happening in the picture. Use as many details as you can.\n• Explain why a community garden might be helpful to people and the environment.\n• Compare growing food in a garden with buying food at a grocery store. Explain the similarities and differences.\nWrite your response in complete sentences. Include as many details as you can.',
    stimulusAsset: 'community-garden',
    stimulusDescription: 'A community garden outdoors, with wooden raised planting beds, green plants, a wooden fence, trees, and a sign reading COMMUNITY GARDEN with flower decorations. Three young people wearing gloves work together around a planted bed in the foreground. Another person stands behind them with a wheelbarrow. The picture does not establish their names, relationships, or the exact types of crops.',
    scoringNotes: 'Descriptive/expository task: consider description of the scene, explanation of benefits for people and the environment, and comparison with grocery shopping when evaluating Completeness. Accept reasonable explanations supported by the task; do not require a particular list of benefits or technical gardening vocabulary. This is not a factual science test.',
    gradeNotes: { '6': band67, '7': band67, '8': band8 }
  },
  {
    key: 'q2', title: 'A Surprise at the Park', genre: 'narrative',
    prompt: 'Look at the pictures. Use the pictures to write a story. Your story should have a beginning, a middle, and an end. Write about each picture in order. Include as many details as you can.\n• Tell who the people are, where they are, and what they are doing.\n• Explain what happens and why.\n• Describe what the people see, say, think, or feel.\n• Explain how the problem is solved and how the story ends.',
    stimulusAsset: 'park-story',
    stimulusDescription: 'Four numbered pictures in sequence at a park. 1: Two young people sit on a bench, facing each other, with food in their hands. 2: They encounter a golden-colored dog wearing a collar near a tree; one person reaches toward it. 3: Both people are beside the dog, smiling and touching it. 4: They look at and point toward a LOST DOG poster attached to a tree, with a photograph resembling the dog. An owner reunion is not shown. Names, dialogue, relationships, feelings, and a plausible resolution may be invented by the writer.',
    scoringNotes: 'Narrative task: consider a coherent sequence across all four pictures, characters and setting, events and reasons, reactions, and a resolution. Accept plausible creative elaboration and different endings consistent with the sequence. Do not demand direct dialogue, specific names, a fixed number of paragraphs, or an owner reunion as the only acceptable ending. Evaluate language and story communication rather than exact matching to a model story.',
    gradeNotes: { '6': band67, '7': band67, '8': band8 }
  }
]
