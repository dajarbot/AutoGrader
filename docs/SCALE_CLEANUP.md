# Large-batch cleanup pass

Today's workflow is intentionally optimized for a small stack of student PDFs. Before normal production batches reach hundreds or thousands of documents, complete this cleanup pass.

## Processing

- Move import and extraction into durable database-backed jobs. Grading now uses a durable queue.
- Add provider-aware rate limiting beyond the current single-request sequential worker.
- Claim jobs atomically so restarting the app never loses or duplicates work.
- Save each file's outcome immediately; never hold an entire batch in memory.
- Support directory import and incremental discovery instead of one enormous file-picker result.
- Keep hashing and PDF reads streaming.

## Interface

- Paginate or virtualize submission rows.
- Load aggregate status counts separately from file records.
- Add search and filters for filename, student, status, grade, and issue type.
- Add throughput and estimated-time metrics beyond the current queued/running/retry counts.
- Provide bulk retry and bulk review actions without selecting every row in the renderer.

## Data and operations

- Batch SQLite writes in short transactions and monitor WAL growth.
- Add retention and archive controls for original PDFs and old grading attempts.
- Add backup, restore, and workspace-integrity checks.
- Load-test 1,000, 5,000, and 10,000-document workspaces before shared-host mode.
- Verify memory remains bounded when PDFs are unusually large or malformed.
