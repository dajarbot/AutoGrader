import type {
  ExportLayout,
  FeedbackSettings,
  ImportProfile,
  RubricDefinition
} from './contracts'

export const staarRubric: RubricDefinition = {
  name: 'STAAR Extended Constructed Response — 5 point',
  criteria: [
    {
      key: 'development_organization',
      name: 'Development & Organization',
      maxScore: 3,
      includedInTotal: true,
      levels: [
        { score: 3, descriptor: 'Accomplished development and organization appropriate to the task.' },
        { score: 2, descriptor: 'Sufficient development and organization with some lapses.' },
        { score: 1, descriptor: 'Limited development or weak organization.' },
        { score: 0, descriptor: 'No evidence of scoreable development and organization.' }
      ]
    },
    {
      key: 'conventions',
      name: 'Conventions',
      maxScore: 2,
      includedInTotal: true,
      levels: [
        { score: 2, descriptor: 'Consistent command of grade-appropriate conventions.' },
        { score: 1, descriptor: 'Inconsistent command; errors are noticeable but meaning remains clear.' },
        { score: 0, descriptor: 'Little or no command; errors interfere with meaning.' }
      ]
    }
  ],
  rules: [
    {
      type: 'force_score',
      when: { criterionKey: 'development_organization', equals: 0 },
      then: { criterionKey: 'conventions', score: 0 },
      explanation: 'If Development & Organization is 0, Conventions must also be 0.'
    }
  ]
}

export const defaultImportProfile: ImportProfile = {
  mode: 'individual_student_pdf',
  responseMarker: 'Student Response',
  identityPattern: '^(.+?)\\s*-\\s*(\\d{5,15})',
  excludeFooterPatterns: [
    '^page\\s+\\d+\\s+(?:of\\s+)?\\d+$',
    '^(?:printed|generated|submitted)\\s*(?:on|at|:)',
    '^(?:©|copyright\\b)'
  ]
}

export const defaultFeedbackSettings: FeedbackSettings = {
  audience: 'teacher',
  includeStrength: true,
  includeNextStep: true,
  commentLength: 'standard'
}

export const defaultExportLayout: ExportLayout = {
  approvedOnlyByDefault: true,
  columns: [
    'source_file_name',
    'teacher_name',
    'student_index',
    'page_number',
    'page_end_number',
    'student_id',
    'student_name',
    'grade',
    'overall_category',
    'total_points',
    'minimum_points',
    'maximum_points',
    'response_text',
    'development_organization_points',
    'development_organization_minimum',
    'development_organization_maximum',
    'development_organization_rubric_level',
    'development_organization_justification',
    'conventions_points',
    'conventions_minimum',
    'conventions_maximum',
    'conventions_rubric_level',
    'conventions_justification',
    'overall_feedback',
    'review_status'
  ]
}
