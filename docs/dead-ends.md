# Dead ends

Status as of 28 Oct 2026 (checked against the code; the 28 Oct changes are in "Status changes (28 Oct)" at the end). Approaches that were tried, proposed, rejected, withdrawn, or declined.
Each entry says what was decided, the reason the notes give, where the detail is, and what would
have to change before it is reopened. Read this before proposing a change in one of these areas.
Reopening an entry needs an owner decision. Other notes: [notes-register.md](notes-register.md).
Priorities: [planning.md](../planning.md).

Entries marked **parked** are not dead. The owner has set them aside until a stated condition holds.

## Storage and persistence

| # | Tried or proposed | Outcome | Reason in the notes | Source | Reopen only if |
|---|---|---|---|---|---|
| S1 | Progress stored on disk, as a blob, shard set, or view | Removed. Progress lives in session storage only. | Decision 27: progress is not on disk. The cost is that progress is lost on browser restart (decision 28, accepted). | [coder-instructions-2026-10-20.md](../coder-instructions-2026-10-20.md) section 2; [progress-durability-design.md](../progress-durability-design.md) | The owner changes decision 27. |
| S2 | Full progress blob, progress repair, and repair-style compatibility writers | Deleted. Not deprecated. | Architecture: legacy surfaces must not return as live product surfaces. | [architecture.md](../architecture.md), "Deleted Legacy Surfaces" | An owner decision says so. |
| S3 | Run list in 32 hash buckets on disk (20 Oct) | Replaced on 24 Oct by run records in the shared log. The bucket write path is removed (commit `8d08054`; checked 27 Oct). | Log records proved the better layout (owner, 25 Oct). The excise is decided: no import of old run data, because the release starts from scratch. | [dead-ends-review-2026-10-24.md](../dead-ends-review-2026-10-24.md), decision 2 and "Runs excise plan" | Not applicable. The excise is built. Stored legacy run copies on existing profiles remain. |
| S4 | A separate completed-log store | Withdrawn on 25 Oct. Replaced by one engine for queue, runs, and history. | Withdrawn with the 25 Oct plan. | [completed-log-shards-plan-2026-10-25.md](../completed-log-shards-plan-2026-10-25.md), header | The owner reopens the storage design. |
| S5 | A byte ceiling that forces a checkpoint | Rejected. The switch counts appends: at 128, forced at 256. | Decision 6: count only. | [coder-instructions-2026-10-20.md](../coder-instructions-2026-10-20.md) section 2 | The owner changes decision 6. |
| S6 | Content index written to disk on every archive | Removed. The index is built in memory from the live queue. Old disk copies are removed once at startup. | The notes measured it: one archive saved about 3.8 MB, and 53 saves wrote 201 MB in 5.7 minutes (1.6.1433 run). | [projection-cost-design-note-2026-10-18.md](../projection-cost-design-note-2026-10-18.md); decisions 10 and 18 | A live run shows the in-memory build costs more than the old writes did. |
| S7 | Diagnostic events kept in a stored key | Removed. Events go to the in-memory flight recorder (v1.6.1442). | Decision 5: diagnostic events are memory-only, folded into the recorder. | [events-to-flight-recorder-design.md](../events-to-flight-recorder-design.md), section 0 | The owner changes decision 5. |
| S8 | Shadow write-ahead logs and shadow compares on the write path: the progress shadow (since 1.6.551), the coordinator-authority shadow, and the deep-pending compare (22 Oct) | Removed (commit `8e146cc`, 26 Oct; checked 27 Oct). The runs gap watch and the store-size sampler went with them. | No decision reads them. The progress shadow was a stage before WAL-first, and progress is not heading that way. | [dead-ends-review-2026-10-24.md](../dead-ends-review-2026-10-24.md), section 3 and decision 3 | Not applicable. The suffix counter for the 15 Oct identity rule is a separate measurement and stays. |
| S9 | Summary-view drop for progress (1.6.1436) | Reverted, not shipped. | It broke 27 tests, mostly tests that read the session view directly. It needs its own pass. | [clear-history-2026-10-18.md](../historical/clear-history-2026-10-18.md), section 19 | A dedicated pass is scheduled. |
| S10 | One-time import of old run history on the new release | Not taken. | Option b was chosen: excise without import, because the release starts from scratch. | [dead-ends-review-2026-10-24.md](../dead-ends-review-2026-10-24.md), "Runs excise plan" | The owner asks for an import. |
| S11 | Queue bar summary kept in session storage, or using the access-level call for it | Rejected. | Decision 9: the bar is read by message. Decision 33: the worker pushes changes to tabs that asked. | [coder-instructions-2026-10-20.md](../coder-instructions-2026-10-20.md) section 2 | The owner changes decision 9 or 33. |
| S12 | An erase keep-list: keys kept during Clear History | Changed 27 Oct. The keep set (`ERASE_BLOCK_HISTORY_KEEP_KEYS`) now holds one key: the one-time space import marker, so a restart after Erase does not import the 1.5 spaces again. The in-flight refusal stays. | The owner asked for no keep list (22 Oct), then kept one key (27 Oct). | [dead-ends-review-2026-10-24.md](../dead-ends-review-2026-10-24.md), section 7 | The owner changes the 27 Oct decision or asks for more keys. |
| S13 | Run statistics kept as running totals: read, add a delta, write back | Rule: derive from authority on demand. | A lost-update race was found on 25 Sep: concurrent writes lose each other's contributions. | [architecture.md](../architecture.md), "Derived Stats Must Not Be A Mutated Running Total" | Not applicable. Runs now have their own storage, which was not re-checked against this rule. |
| S14 | A timer in the service worker for long-running cadence | Set aside after a probe. | A service-worker timer did not survive 35 minutes. A dedicated Worker on a hidden extension page kept a 1 s timer. | [experiments/findings-2026-10-21.md](../experiments/findings-2026-10-21.md), section 1 | The worker-window design is revisited. |

## Queue and runtime

| # | Tried or proposed | Outcome | Reason in the notes | Source | Reopen only if |
|---|---|---|---|---|---|
| Q1 | Content scripts writing coordinator authority maps directly | Forbidden. | Content reports claims and milestones; the worker decides. Content-side failures must not write durable state. | [architecture.md](../architecture.md), "Content Scripts" | Never without an owner decision. |
| Q2 | A second terminal-state writer, such as fire-and-forget progress writes that decide a terminal state | Forbidden. | Progress is not a queue-authority input. The single decision core is the one place for terminal outcomes. | [architecture.md](../architecture.md), "Single Decision Core", point 2 | Never without an owner decision. |
| Q3 | Ordinary queue paths named with "repair" | Terminology rule: use reconcile, materialize, recover, resolve, or apply. | "Repair" is reserved for real corruption or bounded legacy cleanup. | [architecture.md](../architecture.md), "Scheduler / Reconciler" | Not applicable. |
| Q4 | Escalating wait for the menu | Replaced by a fixed 500 ms. | The measured value is recorded in the tunables file. | [dead-ends-review-2026-10-24.md](../dead-ends-review-2026-10-24.md), "Clean" | A measurement shows the fixed wait fails. |
| Q5 | Promise-hop helpers that wrap awaited calls inside the worker | Not used. Measure waits with a time check around the await. | An extra promise hop changes the order of concurrent work. | [coder-instructions-2026-10-20.md](../coder-instructions-2026-10-20.md) section 1; [architecture.md](../architecture.md), "Module Extraction" | Not applicable. |
| Q6 | Freeze and lock patterns for defensive isolation | Not used. Narrow the contract and fix the call sites instead. | Owner preference, recorded as a rule in the coder instructions. | [coder-instructions-2026-10-20.md](../coder-instructions-2026-10-20.md) section 1 | The owner asks for it. |
| Q7 | A Dashboard retry or requeue control for rolled-back rows (28 Oct) | Closed. Not added. Internal requeue of stale or lost rows stays. | Owner (28 Oct): not until a case merits it. The 1.6 build already removed requeue of failed and cancelled rows (25 Oct, `0209f52`). | [planning.md](../planning.md), "Decisions of 28 Oct, with status" | A case the owner judges merits a control. |

## Identity and resolution

| # | Tried or proposed | Outcome | Reason in the notes | Source | Reopen only if |
|---|---|---|---|---|---|
| I1 | A post's title chooses the profile (name association) | Removed. | The identity rule uses the slug exactly as written. | [architecture.md](../architecture.md), "Identity rule" | The owner decides otherwise. |
| I2 | Identity-prefix truncation filter, and lower-cased identity keys | Removed. | Example: `Jane` and `Jane-Type-Smith-7` are different profiles. | [architecture.md](../architecture.md), "Identity rule" | The owner decides otherwise. |
| I3 | Cutting a suffix (`-share-N`, `-log`, `-ch-N`, `-questions`, `-answers`, `-posts`) to form identity | Removed from identity. The cut is only counted. | Of 96 suffixed slugs checked, all returned Quora's 404 page after a redirect. Of 231 closed-set rows checked, 218 reached a profile equal to the stripped form. The owner chose exact identity (15 Oct). | [suffix-cutting-discussion-2026-10-14.md](../historical/suffix-cutting-discussion-2026-10-14.md) | The owner decides after the past-block audit. |
| I4 | Compatibility normalisation (NFKC) for slugs | Rejected in favour of NFC. | A fullwidth lookalike is a different profile, and NFKC would merge it with the plain form. | [architecture.md](../architecture.md), "Identity rule" | The owner decides otherwise. |
| I5 | Direct Quora API calls for block and mute, through the private endpoint | Declined. Reads parked. | Those calls would bypass Quora's anti-bot token check. Nothing was sent. | [direct-api-used.md](../direct-api-used.md); [experiments/quora-direct-api/README.md](../experiments/quora-direct-api/README.md) | A method that does not bypass the check is found, and the owner decides. |

## Shared moderation and platform

| # | Tried or proposed | Outcome | Reason in the notes | Source | Reopen only if |
|---|---|---|---|---|---|
| M1 | Shared moderation data as a remote command channel | Rejected. Moderation data is advisory input. | Only local policy and local user action may turn it into queued work. | [architecture.md](../architecture.md), "Shared Moderation Boundary" | Never without an owner decision. |
| M2 | Reusing desktop queue, WAL, or executor designs in the iPhone plan | Rejected unless a future platform design shows the component fits. | The platform's storage, lifecycle, and foreground constraints differ. | [architecture.md](../architecture.md), "Platform Boundary" | A platform design shows the component fits. |

## Tooling and process

| # | Tried or proposed | Outcome | Reason in the notes | Source | Reopen only if |
|---|---|---|---|---|---|
| P1 | Puppeteer | Never used. Live work goes through the DevTools protocol. | AGENTS.md. The text matches found in the code are Quora's own `puppeteer_test_*` class names, not the library. | [AGENTS.md](../AGENTS.md) | Never. |
| P2 | A build or release without a version bump | Not allowed. | Every build starts with a bump in the four version fields. | [AGENTS.md](../AGENTS.md); [coder-instructions-2026-10-20.md](../coder-instructions-2026-10-20.md) section 6 | Never. |
| P3 | Migrating old stored queue data into the new storage layout | Not planned. Storage is cleared with the change. One exception: the 1.5 space classification registry is imported once (27 Oct; built). | Completed-log plan, rule 10. | [completed-log-shards-plan-2026-10-25.md](../completed-log-shards-plan-2026-10-25.md) | The owner decides otherwise. |

## Parked, not dead

- **Recovery B** (a worker-side copy used to recover a torn checkpoint). Parked on 25 Oct. Changed 27 Oct: not parked. The owner says Recovery B is Recovery A, which is built (session copy, used only when the disk checkpoint is torn; architecture.md section 4.8). The 25 Oct worker-side copy is not in the code. The history shows the earlier removal in commit bfbcee5, which the message does not mention.
- **Profile search toolbar staying usable while work is pending.** Parked UI item, not started. See [user-note.md](../user-note.md).
- **Direct API reads.** Parked. See I5.

## Status changes (27 Oct)

- **Recovery B**: not parked. It is Recovery A, built. See the parked section above.
- **Runs (S3, S10)**: the bucket layout is excised (commit `8d08054`), with no import. Built.
- **Clear**: completed rows and runs are not deleted from storage by Clear All Stats; the outlier rows are cleared on disk and in session. Decided (owner, 27 Oct): Clear All Stats resets the outlier baseline to zero for now (architecture.md section 8).
- **Soft-fail**: the retry line and the header counts are removed from the Dashboard (built). The stored flag, the worker side and the toggle plumbing stay.
- **Shadow removal (S8)**: built (commit `8e146cc`).
- **Keep mechanism (S12)**: the keep set holds one key, the 1.5 import marker (27 Oct).

## Status changes (28 Oct)

- **Retry and requeue for rolled-back rows (Q7)**: closed. Not added, and not until a case merits it (owner, 28 Oct).
- **Rollback of a failed active transition (27 Oct incident)**: a rollback does nothing when the row is missing or already terminal, so it cannot write a failure over a row another path has settled. The blocked-live-tab probe waits for the row's pending transition before it decides (architecture.md 3.1). Built; not confirmed live. Tests exist in `test/swSynthetic.test.js`; not run in the 28 Oct pass.
- **Outcome of an exhausted activation**: `action-error` for the single-row terminalizer, the batch terminalizer and the active-transition-failed path, unless the release reason names a timeout (architecture.md 6.1b). Built. The owner has not confirmed that `fast-executor-preflight` and the "runtime disappeared" case count as activation failures (planning.md, open item (a)).
- **Nuke error label**: the Dashboard shows "Nuke error" for `action-error` (it was "timeout"). The stored value is unchanged. Built. The label is recorded as accepted (planning.md, open item (d)).
- **Remove control on a failed row**: built. It removes one failed row through the guarded save. Nothing is sent to Quora, and the row is not requeued. Queued and active rows keep Cancel. Live check open.
- **Page-side refactor (space and search pages)**: steps 1 to 6 done; shared modules listed in architecture.md section 1.5. No approach is rejected by this; it is recorded so the duplicated code is not reintroduced on one page only.
