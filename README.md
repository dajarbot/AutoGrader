# AutoGrader Desktop

AutoGrader is a local-first assessment workspace for importing student writing, scoring it against versioned rubrics, reviewing AI drafts, and exporting approved results.

## Current milestone

The first vertical slice includes:

- An Electron and React desktop shell.
- A loopback-only Fastify service protected by an ephemeral token.
- A persistent SQLite workspace with WAL mode and foreign-key enforcement.
- Versioned templates, assignments, submissions, grading attempts, and approved-result records.
- The initial published STAAR ECR five-point template.
- A guided assignment workflow that reopens the latest work instead of routing through a dashboard.
- Assignment workspaces with native multi-PDF selection.
- PDF signature validation, SHA-256 duplicate detection, and durable managed copies.
- A per-file import list with explicit processing status.
- Local embedded-text extraction with no temporary Google Docs.
- Packet-aware splitting: one multi-page source PDF becomes one submission per student page.
- Editable identity and response-boundary review before a submission becomes grading-ready.
- Cached, on-demand rendering of the exact original PDF page beside extracted text.
- One-click advancement of all clean extractions while flagged outliers remain queued for later review.
- Initial table rendering is capped with incremental “show more” controls.
- Gemini provider setup with OS-backed encrypted API-key storage.
- A durable SQLite grading queue that excludes student identity from provider requests.
- Structured score validation, application-computed totals, and enforced cross-criterion rubric rules.
- Queue progress, explicit retries, restart recovery, and fail-fast pausing for provider-level errors.
- Calibration-first grading plus an explicit “Grade all” batch action; batches remain sequential, stop on provider-level errors, and can be stopped after the current request.
- Editable criterion scores and comments with explicit approval before export.
- Native Excel export with one row per student, full response text, criterion scores/comments, totals, feedback, source PDF, model, and review status.
- Separate “approved only” and clearly labeled “all scored” exports so AI drafts cannot be confused with finalized grades.

Large-stack workflow cleanup and batch-oriented navigation are the next milestones.

## Development

Requirements: Node.js 20.19 or newer.

```bash
npm install
npm run dev
```

Quality checks:

```bash
npm run typecheck
npm test
npm run build
```

The development database is stored in Electron's per-user application-data directory, not in the repository.

## Security boundaries

- Renderer processes have no Node.js access.
- Context isolation and Chromium sandboxing are enabled.
- The local service binds only to `127.0.0.1` on an ephemeral port.
- Every local request requires a random token created at application startup.
- API keys are encrypted through Electron's OS-backed secure storage and are not stored in the database, templates, or renderer bundle.
- Student name and ID remain local; grading requests contain only assignment material, the rubric, and reviewed response text.
