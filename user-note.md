# User Note

> **Status: ROADMAP** (24 Oct 2026). Intent: profile search stays usable while work for the same search is pending. Parked UI item, not started. Dated sections; the newest wins. Not scheduled. Check planning.md before acting on it. Register: [notes register](docs/notes-register.md).

Status: local explanatory note.

Canonical planning now starts at [planning.md](planning.md). Canonical
architecture starts at [architecture.md](architecture.md). Move any planning
implication from this note into `planning.md` before treating it as active work.

Sections are dated where it matters. Older sections record intent at the time
they were written and are not gospel. Where sections conflict, the newest one
wins.

## Profile Search While Work Is Pending (2026-10-10)

Status: current intent. Not implemented. Supersedes the search-page parts of
the older notes below.

On a profile search page, work already queued for that search must not lock the
page's own controls.

- `Collect 100 More` stays visible and enabled while earlier profiles from the
  same search are still pending. Its label does not change to
  `Nuking N left`.
- `Nuke 'Em N` stays enabled whenever there are new queueable profiles on the
  page. It queues only profiles that are not already pending, so it never
  double-queues.
- Work already running is still shown, as a separate status such as
  `67 working for "elon musk"`. It is not shown as the collect button's label
  or as a disabled state.
- Per-row Mute-Block buttons keep working alongside all of this, as they
  already do.
- Queueing more while earlier work runs is intended. A new batch joins the
  same run. It does not replace or restart the run.

**Why:** The pending gate treated "some work is running for this search" as
"the toolbar is unsafe". The per-profile checks already prevent duplicates, so
the gate blocked useful work without adding safety. Showing `Nuking N left` on
the collect button kept progress visible but took the action away.

**Decided (2026-10-11):** no Stop control on search pages. The pause behavior
in the next section was written for the working Nuking button on other pages
and does not apply here.

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
