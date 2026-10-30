# Index write cost (18 Oct 2026)

> **Status: ROADMAP** (24 Oct 2026). Open: whether finished rows belong in the content index, and what it costs after a live run. Not scheduled. Check planning.md before acting on it. Register: [notes register](docs/notes-register.md).

Status: open. The working copy no longer writes the content index on archive. The build in the repo still does. Nothing is decided. The next step is to measure after the change is built and run, which needs David's go.

## Baseline: the last build (1.6.1433, five-minute run, concurrency 1)

- Each archive saved the whole copy: about 3.8 MB. There were 53 archive saves in 5.7 minutes, 201 MB for those saves alone. About 460 MB was written in total across all paths in that run.
- A save wrote every piece of the copy, even when one row changed. The copy has 32 pieces for the queue and 32 for sources, plus the whole copy. Each piece was stamped with a new time.

## The working copy

- The index is built in memory from the live queue, on the first lookup after a change. Nothing writes it on archive. This is the 18 Oct change kept in the coder instructions (decision 10).
- In the current code, only the content-page lookup reads the index.

## Open

1. **Whether finished rows belong in the index.** This sets the memory size, and the time the first lookup after a change takes to rebuild the index. David's question.
2. **Measure after the change is built and run.** Bytes written per archive for the index (should be near zero). Time of the first page lookup after a change. Time of the first lookup after the worker has slept.
3. **If the lookup wait is not acceptable.** The alternative is a stored copy written only in changed pieces, which means small writes. Not decided.
