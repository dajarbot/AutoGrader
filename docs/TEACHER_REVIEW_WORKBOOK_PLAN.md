# Teacher review workbook and calibration plan

## Goal

Create a spreadsheet-first review workflow for teachers who will not use the AutoGrader interface. AutoGrader exports filterable review workbooks, teachers record decisions and corrections in Excel or Google Sheets, and completed workbooks can later be imported without losing the original AI score.

The immediate priority is a dependable teacher field and a workbook that can be filtered or divided by teacher. The scoring model will be recalibrated only after teacher corrections provide a defensible comparison set.

## Working decisions

- Keep the original AI result immutable.
- Identify records by internal assignment, submission, and grading-attempt IDs. Never match returned rows by student name or row position.
- Store one normalized teacher name per submission.
- For the current TELPAS files, derive the initial teacher name from the source PDF filename segment before `_42_F-`. Normalize underscores and repeated whitespace so variants such as `Duncan_Melanie` and `Duncan Melanie` group together.
- A later roster import or explicit teacher override will take precedence over the filename-derived value.
- Keep the workbook macro-free and compatible with ordinary `.xlsx` editing.
- Use an explicit review decision so an untouched row cannot be mistaken for an approval.
- Treat `Unscorable` as a workflow state, not as a zero on a 1–4 rubric.

## Phase 1 — Teacher-filterable export

Status: in progress

### Data and export

- [x] Add a normalized `teacherName` field to exported score rows.
- [x] Derive the field from supported source PDF filenames when no stored teacher value exists.
- [x] Add `Teacher` near the student identity columns on the existing `Scores` sheet.
- [x] Keep the header filter across the full table so coordinators can filter by teacher immediately.
- [x] Add an autofilter-ready `Teacher Review` sheet with one row per scored response.
- [x] Preserve the existing `Scores` sheet as the detailed, read-only grading record.
- [x] Include hidden assignment/submission/attempt identifiers required for safe round-trip import. Cell locking will be enforced before Phase 2 import ships.

### Teacher Review columns

Locked reference columns:

- Teacher
- Student ID and student name
- Grade and question
- Source PDF and page range
- Extracted response
- AI score, rubric-level descriptor, and justification for each criterion
- AI total, model, rubric version, and current review status

Editable columns:

- Review decision: `Accept AI`, `Corrected`, `Needs follow-up`, `Unscorable`, or `Extraction problem`
- Teacher score for each rubric criterion
- Correction reason for each changed criterion
- Optional teacher note
- Reviewer initials

### Workbook behavior

- [x] Prefill teacher scores from the AI result while leaving the review decision blank.
- [x] Apply score and decision dropdown validation.
- [x] Visually distinguish editable cells from reference cells.
- [x] Highlight changed scores and incomplete corrected rows.
- [x] Calculate the teacher total from the teacher criterion scores.
- [x] Freeze identity columns and the header row.
- [x] Keep identifiers on the same filtered row so sorting does not break record matching.
- [x] Keep all teachers in one filterable worksheet instead of creating one worksheet per teacher.

### Phase 1 verification

- [x] Filename variants resolve to the same normalized teacher.
- [x] Unknown filename formats export with a blank teacher instead of a guessed value.
- [ ] Teacher, student, score, and rationale fields remain aligned after sorting.
- [x] Score dropdowns use each rubric criterion's configured levels, including TELPAS 1–4.
- [x] Existing approved-only and all-scored exports continue to work.
- [x] Workbook opens without repair warnings in an Excel-compatible reader.

## Phase 2 — Safe workbook import

- Add an `Import teacher review` action.
- Validate workbook type and format version before reading teacher inputs.
- Match records by the hidden IDs and reject missing, duplicate, or conflicting identifiers.
- Import only the documented editable fields.
- Show a preview with accepted, corrected, incomplete, invalid, duplicate, and conflicting row counts.
- Allow partial workbooks and repeated imports without duplicating approvals.
- Preserve each imported review as an auditable revision linked to the original AI attempt.
- Record AI score, teacher score, delta, reason code, optional note, reviewer, and timestamp for every criterion.

## Phase 3 — Calibration report

- Report AI and teacher score distributions by criterion, grade, question, teacher, rubric version, and model.
- Calculate exact agreement, within-one agreement, average score delta, over-score rate, and under-score rate.
- Show score transitions such as AI `3` to teacher `2`.
- Summarize the most common correction reasons.
- Keep classroom results separate from model-calibration metrics.

## Phase 4 — Model recalibration

- Build a versioned calibration set from teacher-reviewed responses.
- Use a stratified development sample across grades, questions, and AI score bands.
- Reserve a held-out validation sample that is not used to edit the prompt.
- Tighten adjacent-level comparisons, especially the 2/3 and 3/4 boundaries.
- Require affirmative evidence for higher scores and a concise explanation of what prevents the next level.
- Add de-identified teacher-approved boundary examples to the rubric guidance.
- Compare the revised model with teacher scores before making it the default.
- Do not apply a blanket score deduction or force a predetermined distribution.

## Completion criteria

The workflow is complete when a coordinator can export a large batch, filter or distribute rows by teacher, receive partially completed workbooks, import them safely, and produce a reproducible calibration report without overwriting AI evidence or relying on student names for matching.
