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
- Packet-aware splitting: student headers start submissions, and following response/continuation pages stay with that student.
- Editable identity and response-boundary review before a submission becomes grading-ready.
- Cached, on-demand rendering with page navigation across each student’s original PDF pages.
- One-click advancement of all clean extractions while flagged outliers remain queued for later review.
- Initial table rendering is capped with incremental “show more” controls.
- Local Ollama model selection with no API key or cloud grading requests.
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

## Local grading with Ollama

1. Open Ollama (or run `ollama serve` if it is not already running).
2. Run `ollama list` to see installed models. The default is `mistral:latest`.
3. Run `npm run dev`. Create an assignment and import/review a PDF.
4. In the grading step, select an installed model under **Ollama · local**.
5. Use **Grade one response** to calibrate, review the draft, then grade the batch.

To install another model, use `ollama pull <model-name>`, then enter its exact name in the provider settings. Grading uses structured JSON, an 8,192-token context, and a 2,048-token output limit. Keep assignment material and responses within the model's context; long inputs may be truncated by Ollama. Each request has a ten-minute timeout. Missing models, connection failures, and server errors pause the batch for retry. Local model speed and scoring quality depend on your hardware and model; review calibration results before a full batch.

This checkout replaces Gemini grading. Existing Gemini score history is retained, but old queued Gemini attempts are not executed through Ollama. Stop old queued requests and requeue them with a local model when reusing an existing workspace.

## Security boundaries

- Renderer processes have no Node.js access.
- Context isolation and Chromium sandboxing are enabled.
- The local service binds only to `127.0.0.1` on an ephemeral port.
- Every local request requires a random token created at application startup.
- Grading connects only to Ollama at `http://127.0.0.1:11434`; no cloud provider is used.
- Student name and ID remain local; grading requests contain only assignment material, the rubric, and reviewed response text.

## Multi-page PDF packets

Student identity headers define boundaries, not page breaks. A name-only page, item heading page, and following response pages form one submission until the next student identity. Report footers are removed on each page before the response is combined. Both extraction and score review show the full source page range with Previous/Next controls.

For packets imported before this fix, use **Re-extract unconfirmed** while all records from that PDF are still unreviewed. Documents with accepted, queued, or scored submissions are skipped to preserve reviewed work; import into a new assignment to rebuild those packets. Re-importing the same PDF into the same assignment is treated as a duplicate.

## Rubric editing

Open **Rubric** to create a rubric for another test or **Make a copy** of an existing rubric. Drafts support criterion names, minimum and maximum scores (within 0–20), rubric-specific scoring notes, descriptors for every score, total-score inclusion, and optional conditional scoring rules. Save incomplete work with **Save draft**. **Publish version** validates the rubric and makes it available in **New assignment**.

Published versions cannot be edited in place. **Edit new version** starts a draft in the same rubric family; **Make a copy** starts an independent family. Existing assignments and scores retain their exact published version. To compare rubric variants, create separate assignments with the same task and PDFs and select a different published rubric for each.

**Original ECR rubric — verbatim** preserves the supplied descriptors exactly, with Development & Organization scored 0–3 and Conventions scored 0–2. It has no conditional scoring rules because none were supplied in that table. The earlier shortened rubric and its forced-zero rule remain available as **Legacy wording** for existing assignments. Copy either baseline to experiment.

Electron SQLite regression tests can be run with `ELECTRON_RUN_AS_NODE=1` using `node_modules/electron/dist/electron.exe node_modules/vitest/vitest.mjs run` on Windows.

### Choose a rubric at grading time

The **Grade** stage has a published-rubric selector and a descriptor preview. Choose a version and click **Use selected rubric** before grading. If the assignment has no grading history, its rubric changes in place. Otherwise, AutoGrader opens a separate assignment run with the same task, reviewed responses, identities, and source pages; earlier scores and approvals remain in the original assignment. Use the assignment switcher to return to those results. Switching is blocked while requests are queued or running. No model requests are sent merely by selecting a rubric.


### TELPAS constructed-response scoring

**Original TELPAS writing rubric — 2025** preserves the descriptors from page 9 of the supplied 2025 grades 8–9 scoring guide, with line wrapping normalized. Vocabulary, Usage, and Completeness each allow 1–4, totaling 3–12. The baseline is protected; use **Make a copy** to change descriptors or scoring notes. Notes are application guidance, separate from the official wording, and are included in each model request and visible during teacher review. Existing rubrics without a minimum still start at zero.

Provide the full prompt and stimulus (including a text transcription of graph data). Keep each question in a separate assignment. This rubric is for constructed responses, not the guide's 0/1 sentence rewrites. Scores are item scores, not proficiency classifications.

The initial local calibration covers all 62 constructed-response examples, with the official labels withheld from Mistral. Read `output/telpas/calibration-report.html` for per-trait metrics and every response/result. This anchor-based diagnostic is not a classroom accuracy estimate. Reproduce it with Node 24+ and running Ollama:

```powershell
node scripts/run-telpas-evaluation.mjs mistral:latest
node scripts/summarize-telpas-evaluation.mjs
```

The first command overwrites that model's calibration results, and the second regenerates the report. The checked-in `output/telpas/examples.json` contains the extracted reference responses and labels; the runner sends only the response and task to the model. The graph transcription was visually checked against guide page 42. The app's current request builder, rubric, notes, and result validator are used directly.


## Two-question October writing assessment

Choose **New assignment → Assessment format → October TELPAS — two questions**. The preset contains Community Garden (descriptive/expository) and A Surprise at the Park (narrative), the original picture pages, verified text descriptions for the local model, question-specific notes, and editable grade 6/7/8 guidance. Both questions use the same published rubric. Each assessment saves a fixed setup snapshot; **Copy setup** starts a new editable setup while earlier work stays intact.

Grades 6 and 7 use the common 6–7 reference band; grade 8 uses 8–9. There are no invented age bonuses, word-count thresholds, or automatic proficiency conversions. Confirming a student's grade or identity also updates their unscored sibling answer in the same source packet. Scored answers require a new run before changing identity or grade.

Import recognizes explicit `Question 1`, `Q1`, `CR Item # 1`, or exact question-title boundaries, and keeps continuation pages with that answer. Unlabeled/unknown boundaries go to review with separate Q1/Q2 slots and retained source text; page position alone never assigns an answer. Review each question, or mark it **Missing** / **Unreadable** without assigning a zero. Embedded PDF text is supported; handwriting/OCR is not added by this change. A marked missing/unreadable answer is protected from automatic re-extraction.

The review screen has independent question tabs and approval states. Multi-question exports contain a **Student summary** sheet with each question's traits, status and total, plus the detailed **Scores** sheet. The combined classroom total is blank unless every question has a score in the selected export scope. Duplicate answers are flagged instead of silently selecting one. AI draft totals are labeled explicitly.

**Include official reference examples in scoring** is experimental and off by default. It uses separate 6–7 expository/narrative and 8–9 expository demonstrations, saved into the assessment snapshot. No 8–9 narrative demonstrations were supplied. The paired evaluation script excludes all demonstration IDs from both test modes:

```powershell
node scripts/evaluate-assessment.mjs mistral:latest
node scripts/summarize-assessment-evaluation.mjs
```

The paired report is saved under `output/telpas/assessment-calibration.html`. Grade-band labels come from the guides; individual source grades are unavailable, so grade 6 represents band 6–7 and grade 8 represents 8–9. Validation on teacher-scored responses to the actual October prompts remains a separate step once those responses are available.
