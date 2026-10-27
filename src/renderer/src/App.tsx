import { assignmentQuestions, octoberQuestions, octoberSharedNotes } from '../../shared/assessment'
import { TELPAS_RUBRIC_KEY } from '../../shared/telpasRubric'
import { QuestionContext, QuestionEditor } from './AssessmentQuestions'
import type { AssessmentQuestion } from '../../shared/contracts'
import { useEffect, useRef, useState, type FormEvent } from 'react'
import { api } from './api'
import { RubricLibrary, type RubricLibraryHandle } from './RubricLibrary'
import { applyScoringRules } from '../../shared/rubricValidation'
import type {
  Assignment,
  CreateAssignmentInput,
  DraftScoreReview,
  GradingQueueSummary,
  ImportPdfResult,
  ProviderStatus,
  ReviewExtractionInput,
  SpreadsheetExportScope,
  Submission,
  TemplateVersion
} from '../../shared/contracts'

type Screen = 'assignment' | 'templates'

export function App(): React.JSX.Element {
  const rubricLibrary = useRef<RubricLibraryHandle>(null)
  const [screen, setScreen] = useState<Screen>('assignment')
  const [assignments, setAssignments] = useState<Assignment[]>([])
  const [templates, setTemplates] = useState<TemplateVersion[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [showNewAssignment, setShowNewAssignment] = useState(false)
  const [assignmentToCopy, setAssignmentToCopy] = useState<Assignment | undefined>()
  const [showAssignmentChooser, setShowAssignmentChooser] = useState(false)
  const [selectedAssignmentId, setSelectedAssignmentId] = useState('')

  const refresh = async (): Promise<void> => {
    try {
      setError('')
      const [assignmentData, templateData] = await Promise.all([api.assignments(), api.templates()])
      setAssignments(assignmentData)
      setTemplates(templateData)
      setSelectedAssignmentId((current) => current || assignmentData[0]?.id || '')
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'AutoGrader could not load its local workspace.')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    void refresh()
  }, [])

  const leaveRubric = async (next: () => void): Promise<void> => {
    try { if (screen === 'templates') await rubricLibrary.current?.saveBeforeLeave(); next() }
    catch (cause) { setError(cause instanceof Error ? cause.message : 'Save the rubric before continuing.') }
  }

  const selectedAssignment = assignments.find((assignment) => assignment.id === selectedAssignmentId)

  return (
    <div className="workflow-app">
      <header className="workflow-topbar">
        <div className="brand compact"><div className="brand-mark">A</div><div><strong>AutoGrader</strong><span>Local workflow</span></div></div>
        <div className="topbar-assignment">
          {selectedAssignment ? (
            <button className="assignment-switcher" onClick={() => void leaveRubric(() => setShowAssignmentChooser(true))}>
              <span>Current assignment</span><strong>{selectedAssignment.name}</strong><b>⌄</b>
            </button>
          ) : <span className="topbar-empty">No assignment yet</span>}
        </div>
        <div className="topbar-actions">
          <button className="quiet-button" onClick={() => void leaveRubric(() => setScreen(screen === 'templates' ? 'assignment' : 'templates'))}>
            {screen === 'templates' ? 'Back to workflow' : 'Rubric'}
          </button>
          {selectedAssignment && <button className="quiet-button" onClick={() => void leaveRubric(() => { setAssignmentToCopy(selectedAssignment); setShowNewAssignment(true) })}>Copy setup</button>}
          <button className="primary-button" onClick={() => void leaveRubric(() => { setAssignmentToCopy(undefined); setShowNewAssignment(true) })}>＋ New assignment</button>
        </div>
      </header>
      <main className="guided-main">
        {error && <div className="error-banner">{error}</div>}
        {loading ? (
          <LoadingState />
        ) : screen === 'templates' ? (
          <RubricLibrary ref={rubricLibrary} templates={templates} onRefresh={refresh} />
        ) : selectedAssignmentId ? (
          <AssignmentWorkspace assignmentId={selectedAssignmentId} templates={templates} onAssignmentActivated={async (id) => { await refresh(); setSelectedAssignmentId(id) }} />
        ) : (
          <div className="start-workflow"><div className="empty-icon"><Icon name="papers" /></div><h1>Start with an assignment</h1><p>Add the writing task, then AutoGrader will take you directly through PDFs, extraction, grading, review, and export.</p><button className="primary-button" onClick={() => void leaveRubric(() => setShowNewAssignment(true))}>Create assignment</button></div>
        )}
      </main>

      {showAssignmentChooser && (
        <AssignmentChooser
          assignments={assignments}
          selectedId={selectedAssignmentId}
          onClose={() => setShowAssignmentChooser(false)}
          onSelect={(id) => {
            setSelectedAssignmentId(id)
            setScreen('assignment')
            setShowAssignmentChooser(false)
          }}
        />
      )}
      {showNewAssignment && (
        <NewAssignmentDialog
          initial={assignmentToCopy}
          templates={templates.filter((template) => template.status === 'published')}
          onClose={() => setShowNewAssignment(false)}
          onCreated={async (assignment) => {
            setShowNewAssignment(false)
            await refresh()
            setSelectedAssignmentId(assignment.id)
            setScreen('assignment')
          }}
        />
      )}
    </div>
  )
}

function AssignmentChooser({ assignments, selectedId, onClose, onSelect }: {
  assignments: Assignment[]
  selectedId: string
  onClose: () => void
  onSelect: (id: string) => void
}): React.JSX.Element {
  return (
    <div className="dialog-backdrop" role="presentation" onMouseDown={(event) => { if (event.currentTarget === event.target) onClose() }}>
      <section className="dialog assignment-chooser" role="dialog" aria-modal="true">
        <div className="dialog-header"><div><p className="eyebrow">Switch work</p><h2>Assignments</h2><p>Open another assignment without returning to a dashboard.</p></div><button className="close-button" onClick={onClose}>×</button></div>
        <div className="assignment-list">
          {assignments.map((assignment) => (
            <button key={assignment.id} className={`chooser-row ${assignment.id === selectedId ? 'selected' : ''}`} onClick={() => onSelect(assignment.id)}>
              <span className="grade-badge">G{assignment.grade}</span><span><strong>{assignment.name}</strong><small>{assignment.submissionCount} submissions · {assignment.status}</small></span><b>→</b>
            </button>
          ))}
        </div>
      </section>
    </div>
  )
}

const emptyQueue: GradingQueueSummary = { ready: 0, queued: 0, running: 0, draftScored: 0, failed: 0, approved: 0, lastError: null }

function AssignmentWorkspace({ assignmentId, templates, onAssignmentActivated }: { assignmentId: string; templates: TemplateVersion[]; onAssignmentActivated: (id: string) => Promise<void> }): React.JSX.Element {
  const [assignment, setAssignment] = useState<Assignment | null>(null)
  const [submissions, setSubmissions] = useState<Submission[]>([])
  const [provider, setProvider] = useState<ProviderStatus | null>(null)
  const [queue, setQueue] = useState<GradingQueueSummary>(emptyQueue)
  const [stage, setStage] = useState<'prepare' | 'grade' | 'review'>('prepare')
  const [loading, setLoading] = useState(true)
  const [importing, setImporting] = useState(false)
  const [extracting, setExtracting] = useState(false)
  const [accepting, setAccepting] = useState(false)
  const [starting, setStarting] = useState(false)
  const [switchingRubric, setSwitchingRubric] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [selectedSubmission, setSelectedSubmission] = useState<Submission | null>(null)
  const [visibleCount, setVisibleCount] = useState(75)
  const sourcePdfCount = new Set(submissions.map((submission) => submission.sourceDocumentHash)).size
  const cleanCount = submissions.filter((submission) =>
    submission.status === 'extracted' && submission.studentName && submission.studentId && submission.reviewedText
  ).length
  const extractionProblems = submissions.filter((submission) => submission.status === 'extraction_problem').length
  const sourcesWithReadyStudents = new Set(
    submissions.filter((submission) => submission.responseDisposition !== 'response' || !['imported', 'extracted', 'extraction_problem'].includes(submission.status)).map((submission) => submission.sourceDocumentHash)
  )
  const canReextract = submissions.some((submission) =>
    ['imported', 'extracted', 'extraction_problem'].includes(submission.status) &&
    !sourcesWithReadyStudents.has(submission.sourceDocumentHash)
  )

  const load = async (): Promise<void> => {
    try {
      setError('')
      const [data, providerData, queueData] = await Promise.all([
        api.assignment(assignmentId), api.provider(), api.gradingSummary(assignmentId)
      ])
      setAssignment(data.assignment)
      setSubmissions(data.submissions)
      setProvider(providerData)
      setQueue(queueData)
      const hasGradingWork = queueData.ready + queueData.queued + queueData.running + queueData.draftScored + queueData.failed > 0
      setStage(hasGradingWork ? 'grade' : 'prepare')
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'The assignment could not be loaded.')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    setLoading(true)
    void load()
  }, [assignmentId])

  useEffect(() => {
    if (!(queue.queued || queue.running)) return
    const timer = window.setInterval(() => {
      void api.gradingSummary(assignmentId).then((summary) => {
        setQueue(summary)
        if (!summary.queued && !summary.running) void api.assignment(assignmentId).then((data) => setSubmissions(data.submissions))
      }).catch(() => undefined)
    }, 1600)
    return () => window.clearInterval(timer)
  }, [assignmentId, queue.queued, queue.running])

  const importPdfs = async (): Promise<void> => {
    try {
      setImporting(true); setError(''); setNotice('')
      const selected = await window.autoGrader.choosePdfFiles()
      if (!selected.length) return
      const result: ImportPdfResult = await api.importPdfs(assignmentId, selected.map((file) => file.path))
      setSubmissions(result.submissions)
      const parts = [`${result.imported} PDF${result.imported === 1 ? '' : 's'} imported`]
      if (result.duplicates) parts.push(`${result.duplicates} duplicate${result.duplicates === 1 ? '' : 's'} skipped`)
      if (result.rejected.length) parts.push(`${result.rejected.length} rejected`)
      setNotice(parts.join(' · '))
      if (result.rejected.length) setError(result.rejected.join('\n'))
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'The PDFs could not be imported.')
    } finally { setImporting(false) }
  }

  const extractPending = async (): Promise<void> => {
    try {
      setExtracting(true); setError(''); setNotice('')
      const result = await api.extractPdfs(assignmentId)
      setSubmissions(result.submissions)
      setNotice(`${result.extracted} source PDFs extracted · ${result.needsReview} source PDFs contain review flags · ${result.skipped} student responses already confirmed`)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Text extraction could not be completed.')
    } finally { setExtracting(false) }
  }

  const acceptClean = async (): Promise<void> => {
    try {
      setAccepting(true); setError('')
      const result = await api.acceptCleanExtractions(assignmentId)
      setSubmissions(result.submissions)
      setQueue(await api.gradingSummary(assignmentId))
      setNotice(`${result.accepted} clean student responses are ready for grading. Flagged records were left unchanged.`)
      if (result.accepted) setStage('grade')
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Clean extractions could not be advanced.')
    } finally { setAccepting(false) }
  }

  const startGrading = async (mode: 'one' | 'all' | 'retry' = 'one'): Promise<void> => {
    try {
      setStarting(true); setError(''); setNotice('')
      const result = mode === 'retry'
        ? await api.retryGrading(assignmentId)
        : mode === 'all'
          ? await api.startAllGrading(assignmentId)
          : await api.startGrading(assignmentId)
      setQueue(result.summary)
      setNotice(result.queued
        ? mode === 'all'
          ? `${result.queued} responses were queued. AutoGrader will send one provider request at a time.`
          : 'One response was added for grading.'
        : 'No unscored responses were available.')
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Grading could not be started.')
    } finally { setStarting(false) }
  }

  const selectRubric = async (templateVersionId: string): Promise<void> => {
    try {
      setSwitchingRubric(true); setError(''); setNotice('')
      const result = await api.selectGradingRubric(assignmentId, templateVersionId)
      if (result.createdNewRun) {
        await onAssignmentActivated(result.assignment.id)
        setNotice('New grading run opened with the same responses. Earlier scores remain available in the assignment switcher.')
      } else {
        await load()
        await onAssignmentActivated(assignmentId)
        setNotice(`Rubric selected: ${result.assignment.templateName} · v${result.assignment.templateVersion}.`)
      }
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'The rubric could not be changed.')
    } finally { setSwitchingRubric(false) }
  }

  const stopGrading = async (): Promise<void> => {
    try {
      setStarting(true); setError(''); setNotice('')
      const result = await api.cancelGrading(assignmentId)
      setQueue(result.summary)
      setNotice(result.cancelled
        ? `Stopped ${result.cancelled} queued request${result.cancelled === 1 ? '' : 's'}. The response already in progress will finish.`
        : 'No queued requests remained to stop.')
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Queued grading could not be stopped.')
    } finally { setStarting(false) }
  }

  if (loading) return <LoadingState />
  if (!assignment) return <div className="page"><div className="error-banner inline">{error || 'Assignment not found.'}</div></div>

  const gradingFinished = queue.draftScored + queue.approved > 0 && queue.queued + queue.running === 0
  return (
    <div className="page assignment-workspace">
      <header className="assignment-workspace-header">
        <div className="grade-badge large">G{assignment.grade}</div>
        <div><div className="workspace-title-line"><h1>{assignment.name}</h1><span className={`status-pill ${assignment.status}`}>{assignment.status}</span></div><p>{assignment.templateName} · Version {assignment.templateVersion}</p></div>
        <div className="privacy-chip"><span /> Identity stays local</div>
      </header>

      {notice && <div className="success-banner">{notice}</div>}
      {error && <div className="error-banner inline preline">{error}</div>}

      <div className="workflow-strip guided" aria-label="Assignment workflow">
        <button className="complete" onClick={() => setStage('prepare')}><strong>1</strong><span>Set up<div>Question and rubric</div></span></button>
        <button className={submissions.length ? 'complete' : 'current'} onClick={() => setStage('prepare')}><strong>2</strong><span>Add PDFs<div>{sourcePdfCount} source files</div></span></button>
        <button className={queue.ready || queue.queued || queue.running || queue.draftScored ? 'complete' : stage === 'prepare' ? 'current' : ''} onClick={() => setStage('prepare')}><strong>3</strong><span>Check text<div>{extractionProblems} set aside</div></span></button>
        <button className={queue.draftScored || queue.approved ? 'complete' : stage === 'grade' ? 'current' : ''} onClick={() => setStage('grade')} disabled={!submissions.length}><strong>4</strong><span>Grade<div>{queue.draftScored} scored</div></span></button>
        <button className={queue.approved ? 'complete' : stage === 'review' ? 'current' : ''} onClick={() => setStage('review')} disabled={!gradingFinished}><strong>5</strong><span>Review & export<div>{queue.approved} approved</div></span></button>
      </div>

      {stage === 'prepare' && (
        <>
          <details className="panel question-panel"><summary className="panel-heading compact"><div><h2>Assignment material</h2><p>The question and source text are saved. Expand to inspect them.</p></div><span>Show</span></summary>{assignmentQuestions(assignment).map(q => <QuestionContext key={q.key} question={q} grade={assignment.grade} />)}{assignment.sharedScoringNotes && <p className="preline">{assignment.sharedScoringNotes}</p>}</details>
          <section className="panel submissions-panel">
            <div className="panel-heading"><div><h2>Add and check student work</h2><p>{submissions.length ? `${submissions.length} student responses from ${sourcePdfCount} source PDFs.` : 'Source PDFs are copied locally and split into individual student responses.'}</p></div>{submissions.length > 0 && <div className="panel-actions">
              {cleanCount > 0 && <button className="primary-button" onClick={() => void acceptClean()} disabled={accepting}>{accepting ? 'Advancing…' : `Continue with ${cleanCount} clean`}</button>}
              {canReextract && <button className="secondary-button" onClick={() => void extractPending()} disabled={extracting}>{extracting ? 'Extracting…' : submissions.some((submission) => submission.status === 'imported') ? 'Extract text' : 'Re-extract unconfirmed'}</button>}
              <button className="secondary-button" onClick={() => void importPdfs()} disabled={importing}>Add source PDFs</button>
            </div>}</div>
            {submissions.length ? <SubmissionTable submissions={submissions} visibleCount={visibleCount} onMore={() => setVisibleCount((count) => count + 75)} onReview={setSelectedSubmission} /> : <div className="pdf-drop-empty"><div className="empty-icon"><Icon name="papers" /></div><h3>No source PDFs yet</h3><p>Select student response PDFs or teacher packets. Files are copied locally, split into student responses, and deduplicated safely.</p><button className="primary-button" onClick={() => void importPdfs()} disabled={importing}>Choose source PDFs</button></div>}
          </section>
        </>
      )}

      {stage === 'grade' && provider && (
        <GradingStage
          assignment={assignment}
          templates={templates}
          switchingRubric={switchingRubric}
          onSelectRubric={(id) => void selectRubric(id)}
          provider={provider}
          queue={queue}
          total={submissions.length}
          extractionProblems={extractionProblems}
          starting={starting}
          onProviderSaved={setProvider}
          onStart={() => void startGrading('one')}
          onStartAll={() => void startGrading('all')}
          onRetry={() => void startGrading('retry')}
          onStop={() => void stopGrading()}
          onReview={() => setStage('review')}
        />
      )}

      {stage === 'review' && (
        <ScoreReviewStage
          assignmentId={assignmentId}
          assignment={assignment}
          submissions={submissions}
          draftCount={queue.draftScored}
          approvedCount={queue.approved}
          scoredCount={queue.draftScored + queue.approved}
          onBack={() => setStage('grade')}
          onApproved={(summary) => { setQueue(summary); void api.assignment(assignmentId).then(data => setSubmissions(data.submissions)) }}
        />
      )}

      {selectedSubmission && <ExtractionReviewDialog key={selectedSubmission.id} assignment={assignment} siblings={submissions.filter(s => s.sourceDocumentHash === selectedSubmission.sourceDocumentHash && s.studentIndex === selectedSubmission.studentIndex)} onSelect={setSelectedSubmission} submission={selectedSubmission} onClose={() => setSelectedSubmission(null)} onSaved={(updated) => { void api.assignment(assignmentId).then(data => setSubmissions(data.submissions)); setSelectedSubmission(null); setNotice(updated.status === 'ready' ? `${updated.questionKey?.toUpperCase()} is ready for grading.` : `Response marked ${updated.responseDisposition}.`) }} />}
    </div>
  )
}

function SubmissionTable({ submissions, visibleCount, onMore, onReview }: { submissions: Submission[]; visibleCount: number; onMore: () => void; onReview: (submission: Submission) => void }): React.JSX.Element {
  return <div className="submission-table"><div className="submission-table-header"><span>File</span><span>Student identity</span><span>Grade</span><span>Status</span><span /></div>{submissions.slice(0, visibleCount).map((submission) => <div className="submission-table-row" key={submission.id}><div className="file-cell"><Icon name="papers" /><span><strong>{submission.sourceFileName}</strong><small>{submission.issueMessage ?? `${submissionPagesLabel(submission)} · Student ${submission.studentIndex}`}</small></span></div><span>{submission.studentName ?? 'Pending extraction'}<small className="question-label">{submission.questionKey?.toUpperCase() ?? 'Q1'}</small></span><span>{submission.grade ? `${submission.grade}th` : '—'}</span><span><span className={`status-pill ${submission.status}`}>{submission.status.replace('_', ' ')}</span></span><button className="review-button" disabled={!new Set(['imported', 'extracted', 'extraction_problem', 'ready']).has(submission.status)} onClick={() => onReview(submission)}>Review</button></div>)}{visibleCount < submissions.length && <div className="load-more-row"><span>Showing {visibleCount} of {submissions.length} submissions</span><button className="secondary-button" onClick={onMore}>Show 75 more</button></div>}</div>
}

function GradingStage({ assignment, templates, switchingRubric, onSelectRubric, provider, queue, total, extractionProblems, starting, onProviderSaved, onStart, onStartAll, onRetry, onStop, onReview }: { assignment: Assignment; templates: TemplateVersion[]; switchingRubric: boolean; onSelectRubric: (id: string) => void; provider: ProviderStatus; queue: GradingQueueSummary; total: number; extractionProblems: number; starting: boolean; onProviderSaved: (provider: ProviderStatus) => void; onStart: () => void; onStartAll: () => void; onRetry: () => void; onStop: () => void; onReview: () => void }): React.JSX.Element {
  const [confirmAll, setConfirmAll] = useState(false)
  const [rubricId, setRubricId] = useState(assignment.templateVersionId)
  useEffect(() => { setRubricId(assignment.templateVersionId); setConfirmAll(false) }, [assignment.id, assignment.templateVersionId])
  const pendingRubric = rubricId !== assignment.templateVersionId
  const gradingDisabled = starting || switchingRubric || pendingRubric
  const selectedRubric = templates.find((template) => template.id === rubricId)

  const active = queue.queued + queue.running
  const finished = queue.draftScored + queue.approved
  const paused = queue.queued > 0 && queue.running === 0 && queue.failed > 0
  return <div className="grading-layout">
    <section className="panel grading-hero"><div><p className="eyebrow">Step 4 · Sequential grading</p><h2>{paused ? 'The batch paused after a provider error' : active ? `${active} response${active === 1 ? ' is' : 's are'} processing or queued` : queue.draftScored ? `${queue.draftScored} draft scores are ready to examine` : `${queue.ready} responses remain unscored`}</h2><p>Grade one for calibration or queue the remaining stack. Batch mode still sends only one provider request at a time and stops on provider-level errors.</p></div>
      <div className="grading-rubric-selector">
        <label htmlFor="grading-rubric">Rubric for this grading run</label>
        <div className="grading-rubric-controls"><select id="grading-rubric" value={rubricId} disabled={Boolean(active) || starting || switchingRubric} onChange={(event) => { setRubricId(event.target.value); setConfirmAll(false) }}>
          {templates.filter((template) => template.status === 'published' || template.id === assignment.templateVersionId).map((template) => <option key={template.id} value={template.id}>{template.name} · v{template.version}</option>)}
        </select><button className="secondary-button" disabled={!pendingRubric || Boolean(active) || starting || switchingRubric} onClick={() => onSelectRubric(rubricId)}>{switchingRubric ? 'Applying…' : 'Use selected rubric'}</button></div>
        <p>{active ? 'Stop queued requests and wait for the current response to finish before switching.' : pendingRubric ? 'Apply this selection before grading. If grading history exists, a separate run will reuse these responses and preserve earlier scores.' : 'Published versions only. Switching after grading creates a separate run so earlier scores stay available.'}</p>
        {selectedRubric && <details><summary>View rubric · {selectedRubric.rubric.criteria.filter((criterion) => criterion.includedInTotal).reduce((sum, criterion) => sum + criterion.maxScore, 0)} points</summary>
          {selectedRubric.rubric.scoringNotes && <p style={{ whiteSpace: 'pre-wrap' }}>{selectedRubric.rubric.scoringNotes}</p>}
          {selectedRubric.rubric.criteria.map((criterion) => <div key={criterion.key}><strong>{criterion.name} · {criterion.minScore ?? 0}–{criterion.maxScore}{criterion.includedInTotal ? '' : ' · Not included in total'}</strong>{[...criterion.levels].sort((a, b) => b.score - a.score).map((level) => <p key={level.score}>{level.score}: {level.descriptor}</p>)}</div>)}
          {selectedRubric.rubric.rules.map((rule, index) => <p key={index}>{rule.explanation}</p>)}
        </details>}
      </div>
      <div className="queue-metrics"><QueueMetric value={queue.ready} label="Unscored" /><QueueMetric value={active} label="Processing" /><QueueMetric value={queue.draftScored} label="Awaiting review" /><QueueMetric value={queue.approved} label="Approved" /></div>
      {active > 0 && <div className="queue-progress"><span style={{ width: queue.running ? '65%' : '10%' }} /><p>Only one provider request is active; {queue.queued} waiting.</p></div>}
      {queue.lastError && <div className="queue-error"><strong>Why it paused</strong><p>{queue.lastError}</p></div>}
      {confirmAll && !active && <div className="batch-confirm"><div><strong>Queue all {queue.ready} unscored responses?</strong><p>This can create up to {queue.ready} local Ollama requests. They run sequentially, and you can stop the requests that have not started.</p></div><button className="quiet-button" onClick={() => setConfirmAll(false)}>Cancel</button><button className="primary-button" onClick={() => { setConfirmAll(false); onStartAll() }} disabled={gradingDisabled}>Start {queue.ready} requests</button></div>}
      <div className="grading-actions">
        {!provider.configured ? <span>Connect Ollama below to continue.</span> : paused ? <><button className="secondary-button" onClick={onRetry} disabled={gradingDisabled}>{starting ? 'Retrying…' : 'Retry one response'}</button><button className="quiet-button stop-button" onClick={onStop} disabled={starting}>Stop queued requests</button></> : queue.ready > 0 && !active ? <><button className="secondary-button" onClick={onStart} disabled={gradingDisabled}>{starting ? 'Sending one…' : 'Grade one response'}</button><button className="primary-button" onClick={() => setConfirmAll(true)} disabled={gradingDisabled || confirmAll}>Grade all {queue.ready}</button></> : null}
        {queue.failed > 0 && !active && !paused && <button className="secondary-button" onClick={onRetry} disabled={gradingDisabled}>Retry one failed response</button>}
        {active > 0 && queue.queued > 0 && <button className="quiet-button stop-button" onClick={onStop} disabled={starting}>{starting ? 'Stopping…' : 'Stop after current'}</button>}
        {queue.draftScored > 0 && !active && <button className="primary-button" onClick={onReview}>Examine next draft →</button>}
      </div>
      <div className="held-aside"><strong>{finished}</strong> scored so far <span>·</span> <strong>{extractionProblems}</strong> extraction exceptions held aside <span>·</span> sequential requests only</div>
    </section>
    <ProviderCard provider={provider} onSaved={onProviderSaved} />
  </div>
}

function QueueMetric({ value, label, tone = '' }: { value: number; label: string; tone?: string }): React.JSX.Element {
  return <div className={tone}><strong>{value}</strong><span>{label}</span></div>
}

function ProviderCard({ provider, onSaved }: { provider: ProviderStatus; onSaved: (provider: ProviderStatus) => void }): React.JSX.Element {
  const [model, setModel] = useState(provider.model)
  const [editing, setEditing] = useState(!provider.configured)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const save = async (event: FormEvent): Promise<void> => {
    event.preventDefault()
    try { setSaving(true); setError(''); const updated = await api.saveProvider({ model }); onSaved(updated); setEditing(false) }
    catch (cause) { setError(cause instanceof Error ? cause.message : 'Provider settings could not be saved.') }
    finally { setSaving(false) }
  }
  return <section className="panel provider-card"><div className="provider-heading"><div className="provider-logo">✦</div><div><span>Scoring provider</span><strong>Ollama · local</strong></div><span className={`connection-dot ${provider.configured ? 'connected' : ''}`}>{provider.configured ? 'Ready' : 'Not connected'}</span></div>
    {editing ? <form onSubmit={(event) => void save(event)}>
      {error && <div className="form-error">{error}</div>}
      <label>Installed model<input list="ollama-models" value={model} onChange={(event) => setModel(event.target.value)} placeholder="mistral:latest" /></label>
      <datalist id="ollama-models">{provider.models.map((name) => <option key={name} value={name} />)}</datalist>
      <p className="secure-note">Runs on this computer through Ollama. No API key is required. Open Ollama before grading; use “ollama list” to see installed model names.</p>
      <div className="dialog-actions">{provider.configured && <button type="button" className="secondary-button" onClick={() => setEditing(false)}>Cancel</button>}<button className="primary-button" type="submit" disabled={saving || !model.trim()}>{saving ? 'Checking…' : 'Connect model'}</button></div>
    </form> : <div className="provider-summary"><div><span>Model</span><strong>{provider.model}</strong></div><div><span>Connection</span><strong>Local Ollama</strong></div><button className="secondary-button" onClick={() => setEditing(true)}>Change</button></div>}

  </section>
}

function ScoreReviewStage({
  assignmentId,
  assignment,
  submissions,
  draftCount,
  approvedCount,
  scoredCount,
  onBack,
  onApproved
}: {
  assignmentId: string
  assignment: Assignment
  submissions: Submission[]
  draftCount: number
  approvedCount: number
  scoredCount: number
  onBack: () => void
  onApproved: (summary: GradingQueueSummary) => void
}): React.JSX.Element {
  const [draft, setDraft] = useState<DraftScoreReview | null>(null)
  const [result, setResult] = useState<DraftScoreReview['result'] | null>(null)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [exporting, setExporting] = useState<SpreadsheetExportScope | null>(null)
  const [exportNotice, setExportNotice] = useState('')
  const [error, setError] = useState('')

  const loadDraft = async (submissionId?: string): Promise<void> => {
    try {
      setLoading(true); setError('')
      const response = await api.nextDraftScore(assignmentId, submissionId)
      setDraft(response.draft)
      setResult(response.draft?.result ?? null)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'The draft score could not be loaded.')
    } finally { setLoading(false) }
  }

  useEffect(() => { void loadDraft() }, [assignmentId])

  const updateScore = (key: string, score: number): void => {
    setResult((current) => {
      if (!current) return current
      let criteria = current.criteria.map((criterion) => criterion.key === key ? { ...criterion, score } : criterion)
      if (!draft) return current
      const scores = new Map(criteria.map((criterion) => [criterion.key, criterion.score]))
      applyScoringRules(scores, draft.rubric)
      criteria = criteria.map((criterion) => ({ ...criterion, score: scores.get(criterion.key)! }))
      const totalScore = criteria.filter((criterion) => draft.rubric.criteria.find((item) => item.key === criterion.key)?.includedInTotal)
        .reduce((sum, criterion) => sum + criterion.score, 0)
      return { ...current, criteria, totalScore }
    })
  }

  const updateComment = (key: string, comment: string): void => {
    setResult((current) => current ? { ...current, criteria: current.criteria.map((criterion) => criterion.key === key ? { ...criterion, comment } : criterion) } : current)
  }

  const approve = async (): Promise<void> => {
    if (!draft || !result) return
    try {
      setSaving(true); setError('')
      const response = await api.approveScore(draft.submission.id, { criteria: result.criteria, overallComment: result.overallComment })
      onApproved(response.summary)
      await loadDraft()
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'The score could not be approved.')
    } finally { setSaving(false) }
  }

  const exportScores = async (scope: SpreadsheetExportScope): Promise<void> => {
    try {
      setExporting(scope); setError(''); setExportNotice('')
      const exported = await window.autoGrader.exportScores(assignmentId, scope)
      if (!exported.cancelled) {
        setExportNotice(`Saved ${exported.rowCount} scored response${exported.rowCount === 1 ? '' : 's'} to ${exported.filePath}.`)
      }
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'The spreadsheet could not be exported.')
    } finally { setExporting(null) }
  }

  const exportActions = <div className="export-actions">
    <div><strong>Excel spreadsheet</strong><span>Approved results are the safe default. “All scored” labels AI drafts.</span></div>
    <button className="secondary-button" onClick={() => void exportScores('approved')} disabled={!approvedCount || exporting !== null}>{exporting === 'approved' ? 'Exporting…' : `Export approved (${approvedCount})`}</button>
    <button className="secondary-button draft-export" onClick={() => void exportScores('all_scored')} disabled={!scoredCount || exporting !== null}>{exporting === 'all_scored' ? 'Exporting…' : `Export all scored (${scoredCount})`}</button>
  </div>

  if (loading) return <section className="panel review-loading"><span /><p>Opening the next scored response…</p></section>
  if (!draft || !result) return <section className="panel next-stage-panel"><p className="eyebrow">Review complete</p><h2>No draft scores are waiting</h2><p>Your spreadsheet can be exported now, or return to grading when you want to score another response.</p>{error && <div className="error-banner inline">{error}</div>}{exportNotice && <div className="success-banner compact">{exportNotice}</div>}{exportActions}<button className="back-button" onClick={onBack}>← Back to grading</button></section>

  return <section className="score-review-stage">
    <div className="score-review-toolbar"><div><button className="back-button" onClick={onBack}>← Back to grading</button><p><strong>{draft.submission.studentName}</strong> · {submissionPagesLabel(draft.submission)} · {draftCount} drafts awaiting review</p></div><div className="review-toolbar-actions">{exportActions}<div className="score-total"><span>Reviewed total</span><strong>{result.totalScore} / {result.maxTotalScore}</strong></div></div></div>
    {error && <div className="error-banner inline">{error}</div>}
    {exportNotice && <div className="success-banner compact">{exportNotice}</div>}
    <nav className="question-tabs" aria-label="Student questions">{submissions.filter(s => s.sourceDocumentHash === draft.submission.sourceDocumentHash && s.studentIndex === draft.submission.studentIndex).map(s => <button key={s.id} className={s.id === draft.submission.id ? 'primary-button' : 'secondary-button'} disabled={s.status !== 'draft_scored' || JSON.stringify(result) !== JSON.stringify(draft.result)} onClick={() => void loadDraft(s.id)}>{s.questionKey?.toUpperCase() ?? 'Q1'} · {s.status === 'extraction_problem' ? s.responseDisposition === 'response' ? 'Needs text review' : s.responseDisposition : s.status.replace('_', ' ')}</button>)}</nav>
    {assignmentQuestions(assignment).filter(q => q.key === (draft.submission.questionKey ?? 'q1')).map(q => <QuestionContext key={q.key} question={q} grade={draft.submission.grade} />)}
    <div className="score-review-grid">
      <StudentPdfPreview key={draft.submission.id} submission={draft.submission} />
      <div className="panel score-editor"><div className="score-editor-heading"><div><p className="eyebrow">AI draft · {draft.modelName}</p><h2>Examine every score</h2></div><span>Nothing exports until approved</span></div>
        <div className="score-response">{draft.rubric.scoringNotes && <details><summary>Scoring notes</summary><p style={{ whiteSpace: 'pre-wrap' }}>{draft.rubric.scoringNotes}</p></details>}{draft.rubric.rules.map((rule, index) => <p key={index}>{rule.explanation}</p>)}<details><summary>Read extracted response text</summary><p>{draft.submission.reviewedText}</p></details></div>
        {result.criteria.map((criterion) => <div className="score-criterion" key={criterion.key}><div><label>{criterion.name}<select aria-label={`${criterion.name} score`} value={criterion.score} onChange={(event) => updateScore(criterion.key, Number(event.target.value))}>{(draft.rubric.criteria.find((item) => item.key === criterion.key)?.levels ?? []).map(({ score }) => <option key={score} value={score}>{score} / {criterion.maxScore}</option>)}</select></label></div><textarea value={criterion.comment} onChange={(event) => updateComment(criterion.key, event.target.value)} rows={3} aria-label={`${criterion.name} comment`} /></div>)}
        <label className="overall-comment">Overall feedback<textarea value={result.overallComment} onChange={(event) => setResult({ ...result, overallComment: event.target.value })} rows={4} /></label>
        <div className="score-approval"><p>Approval saves this exact reviewed version. AI drafts remain auditable.</p><button className="primary-button" onClick={() => void approve()} disabled={saving}>{saving ? 'Approving…' : 'Approve score and open next →'}</button></div>
      </div>
    </div>
  </section>
}

function ExtractionReviewDialog({ submission, assignment, siblings, onSelect, onClose, onSaved }: {
  submission: Submission
  assignment: Assignment
  siblings: Submission[]
  onSelect: (submission: Submission) => void
  onClose: () => void
  onSaved: (submission: Submission) => void
}): React.JSX.Element {
  const [responseDisposition, setResponseDisposition] = useState<'response' | 'missing' | 'unreadable'>(submission.responseDisposition ?? 'response')
  const [studentName, setStudentName] = useState(submission.studentName ?? '')
  const [studentId, setStudentId] = useState(submission.studentId ?? '')
  const [grade, setGrade] = useState<6 | 7 | 8>(submission.grade ?? 8)
  const [reviewedText, setReviewedText] = useState(submission.reviewedText ?? '')
  const extractionDirty = reviewedText !== (submission.reviewedText ?? '') || studentName !== (submission.studentName ?? '') || studentId !== (submission.studentId ?? '') || grade !== (submission.grade ?? 8) || responseDisposition !== (submission.responseDisposition ?? 'response')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const submit = async (event: FormEvent): Promise<void> => {
    event.preventDefault()
    const input: ReviewExtractionInput = { studentName, studentId, grade, reviewedText, responseDisposition }
    try {
      setSaving(true)
      setError('')
      onSaved(await api.approveExtraction(submission.id, input))
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'The extraction review could not be saved.')
      setSaving(false)
    }
  }

  return (
    <div className="dialog-backdrop" role="presentation" onMouseDown={(event) => {
      if (event.currentTarget === event.target) onClose()
    }}>
      <section className="dialog extraction-dialog" role="dialog" aria-modal="true" aria-labelledby="extraction-review-title">
        <div className="dialog-header">
          <div>
            <p className="eyebrow">Extraction review</p>
            <h2 id="extraction-review-title">{submission.questionKey?.toUpperCase() ?? 'Q1'} · {submission.sourceFileName}</h2>
            <p>Confirm identity and response boundaries without correcting the student’s writing.</p>
          </div>
          <button className="close-button" onClick={onClose} aria-label="Close">×</button>
        </div>

        <form onSubmit={(event) => void submit(event)}>
          <nav className="question-tabs" aria-label="Response questions">{siblings.map(s => <button type="button" key={s.id} className={s.id === submission.id ? 'primary-button' : 'secondary-button'} disabled={extractionDirty || !['imported','extracted','extraction_problem','ready'].includes(s.status)} onClick={() => onSelect(s)}>{s.questionKey?.toUpperCase() ?? 'Q1'} · {s.status.replace('_', ' ')}</button>)}</nav>
          <p>Save this answer before switching questions. Each question is confirmed separately.</p>
          {assignmentQuestions(assignment).filter(q => q.key === (submission.questionKey ?? 'q1')).map(q => <QuestionContext key={q.key} question={q} grade={grade} />)}
          {submission.issueMessage && <div className="warning-banner">{submission.issueMessage}</div>}
          {error && <div className="form-error">{error}</div>}
          <div className="extraction-review-grid">
            <StudentPdfPreview key={submission.id} submission={submission} />
            <div className="extraction-fields">
              <div className="identity-grid">
                <label>Student name<input value={studentName} onChange={(event) => setStudentName(event.target.value)} required /></label>
                <label>Student ID<input value={studentId} onChange={(event) => setStudentId(event.target.value)} required /></label>
                <label>Grade<select aria-label="Grade" value={grade} onChange={(event) => setGrade(Number(event.target.value) as 6 | 7 | 8)}><option value={6}>6</option><option value={7}>7</option><option value={8}>8</option></select></label>
              </div>
              <label>Response availability<select aria-label="Response availability" value={responseDisposition} onChange={e => setResponseDisposition(e.target.value as typeof responseDisposition)}><option value="response">Response available</option><option value="missing">Missing response — no score</option><option value="unreadable">Unreadable response — no score</option></select></label>
              <details><summary>Raw extracted text for boundary review</summary><pre className="preline">{submission.rawText}</pre></details>
              <label>
                Student response
                <textarea className="response-editor" value={reviewedText} onChange={(event) => setReviewedText(event.target.value)} rows={18} required={responseDisposition === 'response'} />
                <small>Edit only extraction mistakes or incorrect boundaries. Preserve the student’s spelling, grammar, and wording.</small>
              </label>
              <div className="dialog-actions">
                <button type="button" className="secondary-button" onClick={onClose}>Cancel</button>
                <button type="submit" className="primary-button" disabled={saving}>{saving ? 'Saving…' : 'Confirm extraction'}</button>
              </div>
            </div>
          </div>
        </form>
      </section>
    </div>
  )
}

function NewAssignmentDialog({
  templates,
  initial,
  onClose,
  onCreated
}: {
  templates: TemplateVersion[]
  initial?: Assignment
  onClose: () => void
  onCreated: (assignment: Assignment) => Promise<void>
}): React.JSX.Element {
  const [assessmentType, setAssessmentType] = useState((initial?.questions?.length ?? 0) > 1 ? 'october' : 'single')
  const [questions, setQuestions] = useState<AssessmentQuestion[]>(structuredClone(initial?.questions?.length ? initial.questions : octoberQuestions))
  const [sharedNotes, setSharedNotes] = useState(initial?.sharedScoringNotes ?? octoberSharedNotes)
  const [name, setName] = useState(initial ? `${initial.name.slice(0,150)} — copy` : '')
  const [grade, setGrade] = useState<6 | 7 | 8>(initial?.grade ?? 8)
  const [questionText, setQuestionText] = useState(initial?.questionText ?? '')
  const [templateVersionId, setTemplateVersionId] = useState(initial?.templateVersionId ?? templates[0]?.id ?? '')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  const submit = async (event: FormEvent): Promise<void> => {
    event.preventDefault()
    const input: CreateAssignmentInput = { name, grade, questionText: assessmentType === 'single' ? questionText : questions.map(q => q.prompt).join('\n\n'), templateVersionId, ...(assessmentType === 'october' ? { questions, sharedScoringNotes: sharedNotes } : {}) }
    try {
      setSaving(true)
      setError('')
      const assignment = await api.createAssignment(input)
      await onCreated(assignment)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Unable to create assignment.')
      setSaving(false)
    }
  }

  return (
    <div className="dialog-backdrop" role="presentation" onMouseDown={(event) => {
      if (event.currentTarget === event.target) onClose()
    }}>
      <section className="dialog" role="dialog" aria-modal="true" aria-labelledby="new-assignment-title">
        <div className="dialog-header">
          <div>
            <p className="eyebrow">Step 1 of 3</p>
            <h2 id="new-assignment-title">Create assignment</h2>
            <p>Connect an exact writing task to a published rubric version.</p>
          </div>
          <button className="close-button" onClick={onClose} aria-label="Close">×</button>
        </div>

        <form onSubmit={(event) => void submit(event)}>
          {error && <div className="form-error">{error}</div>}
          <label>Assessment format<select aria-label="Assessment format" value={assessmentType} onChange={e => { setAssessmentType(e.target.value); if (e.target.value === 'october') { setName(name || 'October TELPAS writing'); setTemplateVersionId(templates.find(t => t.templateKey === TELPAS_RUBRIC_KEY)?.id ?? templateVersionId) } }}><option value="single">Single question</option><option value="october">October TELPAS — two questions</option></select></label>
          <label>
            Assignment name
            <input value={name} onChange={(event) => setName(event.target.value)} placeholder="Grade 8 — Unit 1 Midcycle" required />
          </label>

          <div className="form-row">
            <label>
              Grade
              <select aria-label="Grade" value={grade} onChange={(event) => setGrade(Number(event.target.value) as 6 | 7 | 8)}>
                <option value={6}>6th grade</option>
                <option value={7}>7th grade</option>
                <option value={8}>8th grade</option>
              </select>
            </label>
            <label>
              Template version
              <select aria-label="Template version" value={templateVersionId} onChange={(event) => setTemplateVersionId(event.target.value)} required>
                {templates.map((template) => (
                  <option key={template.id} value={template.id}>{template.name} · v{template.version}</option>
                ))}
              </select>
            </label>
          </div>

          {assessmentType === 'single' ? <label>
            Exact writing question
            <textarea
              value={questionText}
              onChange={(event) => setQuestionText(event.target.value)}
              placeholder="Paste the exact question students were asked to answer."
              rows={5}
              required
            />
            <small>This will be reviewed alongside the source packet before grading begins.</small>
          </label> : <><p>Both prompts are shared across grades 6–8. The selected grade supplies the default; individual grades can be confirmed during extraction review. This assessment saves a fixed snapshot of the prompts and guidance.</p><QuestionEditor questions={questions} onChange={setQuestions} /><label>Shared scoring notes<textarea value={sharedNotes} maxLength={12000} rows={4} onChange={e => setSharedNotes(e.target.value)} /></label></>}

          <div className="dialog-actions">
            <button type="button" className="secondary-button" onClick={onClose}>Cancel</button>
            <button type="submit" className="primary-button" disabled={saving || !templateVersionId}>
              {saving ? 'Creating…' : 'Create assignment'}
            </button>
          </div>
        </form>
      </section>
    </div>
  )
}

function LoadingState(): React.JSX.Element {
  return <div className="loading-state"><span /><p>Opening local workspace…</p></div>
}

function Icon({ name }: { name: 'grid' | 'template' | 'papers' | 'rule' }): React.JSX.Element {
  const paths = {
    grid: <><rect x="3" y="3" width="7" height="7" rx="2"/><rect x="14" y="3" width="7" height="7" rx="2"/><rect x="3" y="14" width="7" height="7" rx="2"/><rect x="14" y="14" width="7" height="7" rx="2"/></>,
    template: <><path d="M5 3h14a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2Z"/><path d="M8 8h8M8 12h8M8 16h5"/></>,
    papers: <><path d="M6 2h9l4 4v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2Z"/><path d="M14 2v5h5M8 12h8M8 16h6"/></>,
    rule: <><path d="M12 2v4M12 18v4M4.93 4.93l2.83 2.83M16.24 16.24l2.83 2.83M2 12h4M18 12h4M4.93 19.07l2.83-2.83M16.24 7.76l2.83-2.83"/><circle cx="12" cy="12" r="3"/></>
  }
  return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{paths[name]}</svg>
}

function submissionPagesLabel(submission: Submission): string {
  const start = submission.pageNumber
  const end = submission.pageEndNumber ?? start
  return start === end ? `Page ${start ?? '—'}` : `Pages ${start}–${end}`
}

function StudentPdfPreview({ submission }: { submission: Submission }): React.JSX.Element {
  const start = submission.pageNumber ?? 1
  const end = submission.pageEndNumber ?? start
  const [page, setPage] = useState(start)
  const [preview, setPreview] = useState<{ dataUrl: string; pageNumber: number } | null>(null)
  const [error, setError] = useState('')
  useEffect(() => {
    let active = true
    setPreview(null); setError('')
    void api.pagePreview(submission.id, page)
      .then((result) => { if (active) setPreview(result) })
      .catch((cause) => { if (active) setError(cause instanceof Error ? cause.message : 'Page preview unavailable.') })
    return () => { active = false }
  }, [submission.id, page])
  return <div className="pdf-preview-pane score-pdf">
    <div className="preview-heading"><strong>Original PDF</strong><span>{submissionPagesLabel(submission)}</span></div>
    {end > start && <div className="preview-navigation">
      <button type="button" className="secondary-button" disabled={page <= start} onClick={() => setPage(page - 1)}>Previous page</button>
      <span>Page {page - start + 1} of {end - start + 1} student pages (PDF {start}–{end})</span>
      <button type="button" className="secondary-button" disabled={page >= end} onClick={() => setPage(page + 1)}>Next page</button>
    </div>}
    {preview ? <div className="page-image-scroll"><img src={preview.dataUrl} alt={`Original PDF page ${preview.pageNumber}`} /></div>
      : error ? <div className="preview-error">{error}</div> : <div className="preview-loading"><span /> Rendering page…</div>}
  </div>
}
