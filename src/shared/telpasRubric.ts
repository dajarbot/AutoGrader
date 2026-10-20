import type { RubricDefinition } from './contracts'

export const TELPAS_RUBRIC_KEY = 'telpas-writing-2025-original'

// Descriptor wording transcribed from page 9 of the 2025 TELPAS grades 8–9
// writing scoring guide. Line wrapping and bullet formatting are normalized.
export const telpasRubric: RubricDefinition = {
  name: 'Original TELPAS writing rubric — 2025',
  scoringNotes: [
    'Application scoring guidance based on the rubric and annotated examples; these notes are separate from the official descriptor wording.',
    'Use only for constructed responses. Score Vocabulary, Usage, and Completeness independently from 1 to 4, for a total of 3–12. Do not apply ECR development/conventions rules or sentence-rewrite rules.',
    'Judge the demonstrated range, precision, control, and effectiveness of language against the task. Use the best-fitting descriptor supported by evidence across the response; do not mechanically count errors or require every bullet to appear.',
    'Vocabulary includes range, precision, and spelling as it affects comprehensibility. Familiar words alone and an absence of spelling errors do not establish a high score.',
    'Usage includes sentence and tense control and the range of constructions demonstrated. Simple error-free sentences alone do not establish the highest score. Minor grammar errors may coexist with high scores when understanding is not impeded.',
    'Completeness includes cohesion, specificity, details, genre alignment, and effective communication in relation to all parts of the prompt. Length alone does not establish completeness.',
    'Consider the demands of the actual prompt and any supplied stimulus. Do not invent graph data, missing assignment information, or student evidence. Do not infer native language, identity, or background.',
    'Give a concise evidence-based explanation for each trait, referring to specific language in the response. Treat copied prompt language as limited evidence of independent language production.',
    'These are item scores, not an overall TELPAS proficiency classification. Do not convert the total into a proficiency level.'
  ].join('\n\n'),
  criteria: [
    { key: 'vocabulary', name: 'Vocabulary', minScore: 1, maxScore: 4, includedInTotal: true, levels: [
      { score: 1, descriptor: 'May contain some high-frequency or routine words and phrases; may even contain a small number of very simple formulaic sentences\nMay include vocabulary from the student’s native language\nContains widespread spelling errors that significantly interfere with comprehensibility even with common, high-frequency words; spelling errors reflect frequent borrowing from the student’s native language' },
      { score: 2, descriptor: 'Uses vocabulary that is repetitive or limited in range and variety, particularly when writing is academic\nMay circumlocute when the precise word is unknown or struggle to use words correctly\nContains some spelling errors that may interfere with comprehensibility; spelling errors may reflect some borrowing from the native language' },
      { score: 3, descriptor: 'Generally uses a variety and range of grade-appropriate social language; may struggle to use vocabulary that is academic or newly introduced\nSometimes uses vocabulary that is precise; may not always have the right word(s) for the task\nContains occasional spelling errors that do not significantly interfere with comprehensibility; errors do not represent a significant level of interference from the native language' },
      { score: 4, descriptor: 'Consistently uses a variety and range of grade-appropriate academic and social language\nConsistently uses precise vocabulary; employs the right word(s) for the task\nContains infrequent spelling errors that do not interfere with comprehensibility, similar to those made by native English-speaking peers; errors are only rarely due to interference from the native language' }
    ] },
    { key: 'usage', name: 'Usage', minScore: 1, maxScore: 4, includedInTotal: true, levels: [
      { score: 1, descriptor: 'May contain some simple sentences using present tense or memorized past tense verbs but with errors and inaccuracies\nIncludes significant grammar usage errors that interfere with comprehensibility' },
      { score: 2, descriptor: 'Contains mostly simple sentences using present tense; other tenses used inconsistently or inaccurately\nIncludes frequent grammar usage errors that sometimes interfere with comprehensibility' },
      { score: 3, descriptor: 'May still contain many simple sentences but shows ability to use simple tenses successfully and a developing ability to use complex tenses\nDemonstrates an emerging ability to write compound and/or complex sentences\nIncludes some grammar usage errors that do not significantly interfere with comprehensibility' },
      { score: 4, descriptor: 'Consistently demonstrates ability to correctly use both simple and complex tenses\nContains some expanded compound and/or complex sentences\nDemonstrates grammar usage that is generally correct and comparable to that of grade-level native English-speaking peers\nIncludes infrequent grammar usage errors which do not interfere with comprehensibility; errors may be similar to those made by native English-speaking peers or be limited to complex grammar structures' }
    ] },
    { key: 'completeness', name: 'Completeness', minScore: 1, maxScore: 4, includedInTotal: true, levels: [
      { score: 1, descriptor: 'May copy the prompt or contain no English\nContains simple sentences lacking details or language needed to align to the task\nIs minimally effective in communicating intended message' },
      { score: 2, descriptor: 'May include limited or repetitive use of words and phrases needed to sequence events and show relationships between sentences (cohesive devices)\nNarrates, describes, or explains in a limited way with few details; lacks language needed to align to the task\nShows limited effectiveness in communicating intended message' },
      { score: 3, descriptor: 'Includes some of the appropriate words and phrases needed to sequence events and show the relationship between sentences but does so inconsistently and with some repetition or unnaturalness\nNarrates, describes, or explains in some detail but shows a decline when topics are more academic or abstract\nIs mostly effective in communicating intended message but lacks some specificity needed to complete the task' },
      { score: 4, descriptor: 'Includes the appropriate words, phrases, and/or clauses needed to sequence events and show the relationship between sentences or parts of sentences\nReflects a clear alignment to the specific genre (narration, description, explanation, etc.)\nMostly achieves the intended goal and contains a degree of specificity and detail needed to address the task completely' }
    ] }
  ],
  rules: []
}
