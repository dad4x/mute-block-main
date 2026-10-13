# Other Codex Ordered Handoff, 2026-05-19

Status: point-in-time handoff.

Canonical planning now starts at [planning.md](planning.md). Canonical
architecture starts at [architecture.md](architecture.md). Preserve this note as
the May 19 ordering snapshot; refresh `planning.md` if that ordering changes.

This is the intended order of work:

1. Stabilize the current queue/cleanup behavior.
2. Add a Messages-thread sender `Mute Block` button.
3. Return to collaborative moderation integration.

Do not reorder these. The first step is meant to make the active queue work
boring before adding another entry point that queues profile work.

## Repo Rules

This repository is a normal Git repo, not an ADE view. Do not use ADE commands.

Use direct CDP helpers under `tools/cdp/` for live Chrome validation. Do not use
Puppeteer.

Preserve unrelated dirty work. If shipped extension behavior changes are made
and rebuilt, bump the version first in:

- `package.json`
- `package-lock.json`
- `manifests/chrome.json`
- `manifests/firefox.json`

Then rebuild with the repo's normal release steps before handing over build
artifacts.

## 1. Stabilize Queue Cleanup First

Focus on the background `close-if-blocked` path. It is not a user-directed
foreground action. It is a cleanup primitive used by the queue machinery.

Primary files:

- `shared/js/content.js`
- `shared/js/sw.js`
- relevant synthetic tests under `test/`

Primary concern:

`close-if-blocked` can currently be reached from owner-tab sweeps while queue
work is merely draining, being polled, or being filled. The content receiver
then records `already-blocked`, calls `notifyQueuedTabComplete()`, and closes
the tab based mostly on "this page is a blocked profile."

Audit these paths:

- `shared/js/content.js`: `onMessage()` handling of `close-if-blocked`
- `shared/js/content.js`: `sweepBlockedProfileTabs()`
- `shared/js/content.js`: `waitForOwnedNukeTabsToDrain()`
- `shared/js/sw.js`: `sweepOwnedBlockedProfileTabs(parentTabId)`
- `shared/js/sw.js`: calls around enqueue/fill/open that invoke owner sweeps
- `shared/js/sw.js`: terminal-settlement paths that also send
  `close-if-blocked`

Expected invariant:

`close-if-blocked` must not be able to turn an arbitrary blocked profile tab
into completed queued work. It should either be strictly terminal cleanup for
already-terminal coordinator state, or it should delegate terminal mutation,
release, and close authority back to the service worker after validating current
queue ownership and attempt identity.

Compare against the safer normal queued executor path:

- claim queued work with `claim-tab-action`
- record terminal progress through the job protocol
- check that the service worker accepted terminal progress
- release the slot
- close the tab

Good fixes should make owner sweeps conservative. They should not become a
second executor path.

Validation suggestions:

- Add or update synthetic tests proving `close-if-blocked` does not release or
  close without current queued ownership.
- Add a test for stale/mismatched attempt metadata if the path carries attempt
  ids.
- Keep the terminal-settlement cleanup path covered separately, because that
  path may remain valid when coordinator state is already terminal.
- Run `bash -lc 'npm test'` after source/test changes.

Exit criteria:

- The cleanup path is explicitly bounded by queue metadata or terminal
  coordinator state.
- Content code no longer independently decides terminal queued completion from
  page blockedness alone.
- Existing queue behavior still passes the focused synthetic tests and
  `npm test`.

## 2. Add Messages Sender Mute Block

After queue cleanup is stabilized, add a user-directed `Mute Block` affordance
to selected Quora Messages threads.

Live DOM facts from the tunneled Chrome Messages tab:

- selected URL shape: `https://www.quora.com/messages/thread/<id>`
- selected thread header is inside `#mainContent`
- header height is about `50px`
- sender profile appears twice in the header:
  - avatar link
  - text/name link
- the text/name sender link for the inspected thread was:
  `https://www.quora.com/profile/Sophia-Burse`
- the sender header row had visible text `Sophia Burse`
- there is horizontal space immediately after the sender name and before the
  far-right overflow menu

The temporary CDP inspector used for this reconnaissance is:

- `tools/cdp/inspect-messages-sender.js`

Design:

Place a compact red `Mute Block` pill immediately after the sender name in the
selected conversation header. Do not put it in the left inbox list or inside
the message body.

Suggested CSS shape:

```css
.mb-ext_message-sender-mute-block-btn {
    background-color: #b92b27;
    color: #fff;
    border: 0;
    border-radius: 999px;
    cursor: pointer;
    font-size: 12px;
    line-height: 1.2;
    padding: 4px 8px;
    margin-left: 8px;
    white-space: nowrap;
    flex-shrink: 0;
}
```

Behavior:

- This is user-directed, but it is not a foreground profile page action.
- Do not call profile primitives directly from the Messages page.
- Queue one coordinator item for the sender profile href.
- Use source metadata that makes the origin clear, for example:
  - `sourceType: "messages-thread"`
  - `threadUrl: location.href`
  - `senderName`
  - `sourcePageUrl: location.href`
- Button states should be simple:
  - `Mute Block`
  - `Queueing...`
  - `Queued` or `Already queued`
  - `Retry` on failure
- Do not close or navigate the Messages tab after queueing.

Implementation notes:

- Prefer the visible text/name profile link as the canonical sender target.
- Avoid using the avatar-only link if the text link is present.
- Reconcile on SPA navigation, because Messages changes threads without a full
  page load.
- Make insertion idempotent and remove/update the old button when the selected
  thread changes.
- Reuse the existing coordinator enqueue path rather than adding a new service
  worker primitive.

Validation suggestions:

- Add a deterministic DOM/unit test if the existing synthetic harness can cover
  a Messages header fixture.
- Use `tools/cdp/inspect-messages-sender.js` or a small successor helper to
  verify the live selected thread exposes the expected button next to the
  sender.
- Queue the sender and verify Current Work receives a row with
  `sourceType: messages-thread`.
- Run `bash -lc 'npm test'`.
- If this is rebuilt for use, follow the version bump and release build rules.

Exit criteria:

- Selected Messages thread shows one sender `Mute Block` button.
- Clicking it queues the sender profile through the coordinator.
- No direct mute/block primitive is invoked from the Messages page.
- SPA thread changes do not leave stale buttons on the wrong sender.

## 3. Collaborative Moderation After That

Only return to collaborative moderation after steps 1 and 2 are stable.

Start from the existing notes:

- `shared-moderation-integration-steps-2026-05-19.md`
- `shared-moderation-publication-design-2026-05-18.md`
- `shared-moderation-publication-implementation-plan-2026-05-18.md`

Respect the boundary in `shared-moderation-integration-steps-2026-05-19.md`.
That note intentionally kept the collaborative moderation lane separated while
runtime queue/debug work was active.

When resuming the moderation lane:

- re-check the current dirty tree first;
- keep docs/mock-harness work separate from shipped extension source work;
- do not mix moderation publication changes with queue cleanup or Messages
  sender button changes;
- keep source-owning patches small enough to review and roll back.

Exit criteria for resuming moderation:

- queue cleanup no longer has known unsafe direct-completion paths;
- Messages sender queueing has landed or has been explicitly deferred;
- the moderation lane can take source ownership without colliding with active
  queue/debug work.
