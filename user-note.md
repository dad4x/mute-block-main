# User Note

Status: local explanatory note.

Canonical planning now starts at [planning.md](planning.md). Canonical
architecture starts at [architecture.md](architecture.md). Move any planning
implication from this note into `planning.md` before treating it as active work.

## Pause And Canceled Work

In the Dashboard, `canceled` means the extension stopped queued work because
the operator paused it. It is not a Quora error, and it does not mean the
profile page itself canceled anything.

Canceled work is terminal. A canceled row should usually show:

- status: `canceled`
- outcome: `paused`
- error: `Paused by user`

Pause behaves like stop/cancel, not like suspend/resume.

When a working `Nuking...` button is clicked, the extension should:

- mark pending Dashboard work as `canceled` / `paused`
- remove queued actions that have not opened worker tabs yet
- close worker tabs owned by the paused job
- clear the source space page's pending `Nuking... N left` bookkeeping for the
  canceled profiles

Those canceled rows should not run again automatically. To act on them again,
the user should explicitly requeue them or queue the profiles again from the
source page.

Idle Retry does not process canceled rows. Idle Retry is for retryable `failed`
rows only.

After pause completes, a space page should not keep showing stale
`Nuking... N left` just because old canceled rows exist in Dashboard history.
If it does, that is stale source-page pending state, not active work.
