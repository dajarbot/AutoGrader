import type {
  Assignment,
  CreateAssignmentInput,
  DashboardSummary,
  DraftScoreReview,
  ExtractionBatchResult,
  GradingQueueSummary,
  GradingResult,
  ImportPdfResult,
  ProviderStatus,
  ReviewExtractionInput,
  SaveProviderInput,
  ServiceConnection,
  Submission,
  TemplateVersion
} from '../../shared/contracts'

let connectionPromise: Promise<ServiceConnection> | undefined

async function connection(): Promise<ServiceConnection> {
  connectionPromise ??= window.autoGrader.getServiceConnection()
  return connectionPromise
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const service = await connection()
  const response = await fetch(`${service.baseUrl}${path}`, {
    ...init,
    headers: {
      'content-type': 'application/json',
      'x-autograder-token': service.token,
      ...init?.headers
    }
  })

  const body = await response.json()
  if (!response.ok) throw new Error(body.error ?? 'The local service could not complete the request.')
  return body as T
}

export const api = {
  dashboard: (): Promise<DashboardSummary> => request('/api/dashboard'),
  templates: (): Promise<TemplateVersion[]> => request('/api/templates'),
  assignments: (): Promise<Assignment[]> => request('/api/assignments'),
  assignment: (id: string): Promise<{ assignment: Assignment; submissions: Submission[] }> =>
    request(`/api/assignments/${encodeURIComponent(id)}`),
  createAssignment: (input: CreateAssignmentInput): Promise<Assignment> =>
    request('/api/assignments', { method: 'POST', body: JSON.stringify(input) }),
  importPdfs: (assignmentId: string, paths: string[]): Promise<ImportPdfResult> =>
    request(`/api/assignments/${encodeURIComponent(assignmentId)}/submissions/import`, {
      method: 'POST',
      body: JSON.stringify({ paths })
    }),
  extractPdfs: (assignmentId: string): Promise<ExtractionBatchResult> =>
    request(`/api/assignments/${encodeURIComponent(assignmentId)}/submissions/extract`, {
      method: 'POST',
      body: JSON.stringify({})
    }),
  approveExtraction: (submissionId: string, input: ReviewExtractionInput): Promise<Submission> =>
    request(`/api/submissions/${encodeURIComponent(submissionId)}/extraction`, {
      method: 'PUT',
      body: JSON.stringify(input)
    }),
  acceptCleanExtractions: (assignmentId: string): Promise<{ accepted: number; submissions: Submission[] }> =>
    request(`/api/assignments/${encodeURIComponent(assignmentId)}/submissions/accept-clean`, {
      method: 'POST',
      body: JSON.stringify({})
    }),
  pagePreview: (submissionId: string): Promise<{
    dataUrl: string
    width: number
    height: number
    pageNumber: number
    sourceFileName: string
  }> => request(`/api/submissions/${encodeURIComponent(submissionId)}/page-preview`),
  provider: (): Promise<ProviderStatus> => request('/api/provider'),
  saveProvider: (input: SaveProviderInput): Promise<ProviderStatus> =>
    request('/api/provider', { method: 'PUT', body: JSON.stringify(input) }),
  gradingSummary: (assignmentId: string): Promise<GradingQueueSummary> =>
    request(`/api/assignments/${encodeURIComponent(assignmentId)}/grading`),
  startGrading: (assignmentId: string): Promise<{ queued: number; summary: GradingQueueSummary }> =>
    request(`/api/assignments/${encodeURIComponent(assignmentId)}/grading/start`, {
      method: 'POST', body: JSON.stringify({})
    }),
  startAllGrading: (assignmentId: string): Promise<{ queued: number; summary: GradingQueueSummary }> =>
    request(`/api/assignments/${encodeURIComponent(assignmentId)}/grading/start-all`, {
      method: 'POST', body: JSON.stringify({})
    }),
  retryGrading: (assignmentId: string): Promise<{ queued: number; summary: GradingQueueSummary }> =>
    request(`/api/assignments/${encodeURIComponent(assignmentId)}/grading/retry`, {
      method: 'POST', body: JSON.stringify({})
    }),
  cancelGrading: (assignmentId: string): Promise<{ cancelled: number; summary: GradingQueueSummary }> =>
    request(`/api/assignments/${encodeURIComponent(assignmentId)}/grading/cancel`, {
      method: 'POST', body: JSON.stringify({})
    }),
  nextDraftScore: (assignmentId: string): Promise<{ draft: DraftScoreReview | null }> =>
    request(`/api/assignments/${encodeURIComponent(assignmentId)}/grading/draft`),
  approveScore: (submissionId: string, result: Pick<GradingResult, 'criteria' | 'overallComment'>): Promise<{ result: GradingResult; summary: GradingQueueSummary }> =>
    request(`/api/submissions/${encodeURIComponent(submissionId)}/score`, {
      method: 'PUT', body: JSON.stringify(result)
    })
}
