# Historical notes

Status as of 24 Oct 2026. This folder holds notes that were true when they were written and are now superseded, finished, or dated records: handoffs, review cycles, plans whose work is done or replaced, and working notes. Nothing here is a plan to follow. Start with [planning.md](../planning.md).

## Rules for reading this folder

- Do not implement from a note in this folder. Check [planning.md](../planning.md) and [architecture.md](../architecture.md) first, and the dated owner decisions they cite.
- Every note has a status banner at the top. The register, [notes-register.md](../docs/notes-register.md), gives each note's status and what replaced it.
- A note's text is kept as it was written. Its links were updated so they still open the right file. Plain-text paths are repo-relative, as they were when the note was written: `shared/js/sw.js` means the file at the repo root, not the file next to the note.
- Dead ends are indexed in [dead-ends.md](../docs/dead-ends.md). Most of them are not in this folder.

## What is here

95 notes, moved from the repo root on 24 Oct 2026 at the owner's request, under decision 7 of the [dead-ends review](../dead-ends-review-2026-10-24.md). Nine of them were moved in a second batch, because code comments cite them (see below). They fall into these groups:

- **Refactor and storage plans and handoffs (May 2026):** the 1.5 and 1.6 plans and handoffs, the storage authority and WAL design notes, and their baselines.
- **Review records:** the review-* notes from May, the 14 Oct review series, and the codex reviews from 8 to 10 Oct.
- **Handoffs and live-test lists (May to October 2026):** handoffs for each session, and the live-testing to-do lists.
- **Debugging logs and working notes:** the Firefox BiDi and space-nuke logs, the fight-to-flight log, the working notes, and the 1.5 notes.
- **Plans replaced by later designs:** the sw.js decomposition plan, the flight recorder plan, the coordinator page plan, the unified store build plan, the parallel test split plan, and the entropy audit sub-plan.
- **Decision records and investigations:** the clear-history record, the hunk map, the progress path review, the suffix discussion, the orphaned-tabs bug record, the consul investigation, and the June product review.

## Code comments

Nine of the notes here are cited by name in code comments: `LEGACY_QUEUE_VIEW_RETIREMENT.md`, `sw-state-machine-decomposition-plan-2026-09-01.md`, `queue-wal-segmented-record-followup-2026-05-27.md`, `14-oct-review-1.md`, `coder-instructions-2026-10-18.md`, `progress-path-review-2026-10-18.md`, `live-batch-fixes-worklist-2026-09-19.md`, `nits3.md`, and `nits6.md`. They were moved here on 24 Oct, and those comments now name `historical/<file>`. Thirty-one comment lines in 15 code files changed, and nothing else in the code was changed for this.

## Removed on 24 Oct

Scratch, junk, probe copies and 32 retired CDP helpers were removed on the same day. The list and the restore instructions are in removed-2026-10-24.md.

## How the move was made

Each note was moved with its banner. Only links and references to the moved names were changed; nothing else in the text was edited. Git shows the old paths as deleted and the new ones as untracked until the owner commits. No commit was made.
