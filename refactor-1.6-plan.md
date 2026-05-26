# Refactor 1.6 Plan

Status: supporting detail.

Canonical planning now starts at [planning.md](planning.md). Canonical
architecture starts at [architecture.md](architecture.md). This note remains the
series-specific `1.6`/`2.0` context and historical plan, but new priority
decisions should be folded into `planning.md` first.

`main` is the active `1.6` development lane. Treat `1.6` as the private
stabilization and architecture-reset series for the public `2.0` release.

This is the canonical planning note for the current line. Older `1.5` rethink
notes remain useful as design history and detailed checklists, but new work
should be described here as `1.6` or `2.0` precursor work.

## Series Policy

- `release/1.4` remains the maintenance lane for the `1.4.247` baseline.
- `refactor/1.5` is closed for new feature work. It is preserved only as the
  last `1.5.x` coordinator/debugging lane, with a local copy at
  `../mute-block-1.5`.
- `main` is the `1.6` lane. It absorbs the durable job/state-machine work from
  `top-level-rethink-1.5.md` and `top-level-rethink-1.5-execution-plan.md`.
- The intended public release for completed `1.6` work is `2.0`, not a public
  `1.6.x` release, unless that release strategy is deliberately changed later.

## 2.0 Precursor Scope

The `1.6` reset is about making the extension reliable enough to productize as
`2.0`:

- durable queue rows are the authority for queued work;
- service-worker-owned job state replaces duplicate progress writers;
- source-page pending/nuked state is derived from terminal job outcomes;
- Dashboard and Preferences are reporting/control surfaces, not state owners;
- retry, pause, requeue, resume, and source settlement are explicit state
  transitions;
- live browser validation uses direct Chrome DevTools Protocol, not Puppeteer.

Do not restart broad `1.5` exploration. If an idea came from the late `1.5`
rethink, carry it forward here under the `1.6`/`2.0` architecture.

## Execution Checklist

Use `top-level-rethink-1.5-execution-plan.md` as the detailed implementation
checklist despite its historical filename. That document now executes on
`main` as the `1.6` checklist.

Status update, 2026-05-19 cleanup:

- many queue/recovery/source-settlement defects from the 2026-05-19 reviews are
  now closed by `review-fix-checklist-2026-05-20.md`;
- `timeout-inventory-1.6.md` has been refreshed and should be preferred over
  older timeout comments in review notes;
- the immediate active order is captured in
  `other-codex-ordered-handoff-2026-05-19.md`: stabilize
  `close-if-blocked`, add Messages sender queueing, then resume collaborative
  moderation.

Current priority bands:

- finish source-page settlement and stale pending cleanup;
- keep routing runtime queue transitions through the reducer/model;
- retire compatibility paths that let `mbProfileNukeProgress` influence
  service-worker-owned queue rows;
- add deterministic regression coverage before relying on live Quora loops;
- keep handoff notes as snapshots, not as the canonical plan.

## Shared Post Format Work

Shared moderation posts belong to the `2.0` precursor roadmap, but they should
be designed now because they affect provenance and storage shape.

The live Quora experiment in `muteblockexperimental.quora.com` showed:

- Quora can preserve a marked JSON block well enough to extract text between
  `MBLOCK:BEGIN v=1` and `MBLOCK:END` and run `JSON.parse`.
- Quora adds extra blank lines between JSON lines; JSON tolerates this as
  whitespace.
- Raw Quora profile URLs are unsafe inside the JSON payload because Quora may
  linkify them and render the text back as a display name.
- Quora-safe subjects should use slug identifiers such as
  `quora-profile:David-Brower`, then the extension can map them locally to
  canonical profile URLs.

Initial shared-post requirements:

- define a `com.muteblock.sharedList` schema with `schema_version`;
- require `publisher`, `document_id`, `published_at`, `operation`, and `list`;
- support `snapshot`, `append`, `remove`, and `correction` operations;
- support typed list purposes: `modlist`, `curatelist`, and `referencelist`;
- represent targets as `quora-profile:<slug>`, not as raw
  `https://www.quora.com/profile/...` text;
- treat publisher `intent` as advisory only;
- default imported destructive actions to local review/queue, not automatic
  mute/block.

## ATproto Compatibility Additions

The useful ATproto lesson is the moderation model, not the full network stack:
typed judgments, source attribution, stackable sources, and local policy.

`1.6`/`2.0` storage needs room for imported report provenance that is separate
from local source-page evidence. Current queue `source`/`evidence` fields
mostly answer "where did the extension discover this profile locally?" They do
not fully answer "which imported report caused this action?"

Add or reserve fields shaped like:

```js
moderationInputs: [
  {
    kind: 'shared-post-entry',
    sourceId: 'quora-profile:David-Brower',
    sourceName: 'David Brower',
    sourcePostUrl: 'https://muteblockexperimental.quora.com/...',
    documentId: 'david-brower-shared-mute-blocks-2026-05-18',
    entryId: '...',
    rawEntryHash: 'sha256:...',
    fetchedAt: 0,
    publishedAt: '2026-05-18T00:00:00Z',
    purpose: 'modlist',
    intent: 'review',
    reason: 'publisher supplied reason',
    tags: ['spam'],
    confidence: 'high',
    rawSubject: 'quora-profile:Some-User'
  }
]
```

Record local policy decisions separately:

```js
localDecision: {
  policySource: 'shared-list-policy',
  policyVersion: 1,
  selectedAction: 'mute-block',
  reviewRequired: true,
  approvedBy: 'local-user',
  approvedAt: 0
}
```

Implementation requirements:

- update queue merge helpers so imported provenance is not dropped;
- carry `moderationInputs` from import to queue row, progress/history, and any
  remembered nuked-post record;
- keep publisher intent separate from local action policy;
- cache source documents and import logs for reconciliation;
- keep enough delta history to republish shared lists later;
- surface "why did we act on this profile?" in the Dashboard before enabling
  trusted shared actions.

## Validation Policy

Quora behavior still needs both deterministic tests and live browser probes:

- run `npm test` after pure-state changes;
- run syntax checks on changed JavaScript and CDP tools;
- before any release-oriented build, bump version first;
- for shipped behavior changes, rebuild Chrome and Firefox local outputs and
  regenerate zip artifacts;
- validate live browser behavior with direct CDP over the remote-debugging
  endpoint.

Live Quora checks are evidence, not the first line of defense. Build pure model,
storage-invariant, and fixture tests for regressions that can be represented
without a browser.

## Manual Probe Matrix

- Single profile `Mute Block`.
- Single profile `Mute Block Close`.
- Already-blocked profile.
- Profile unavailable or redirected profile.
- Followers/following modal `Open Profiles`.
- Followers/following modal `Nuke 'Em`.
- Contributor modal `Open Profiles` and `Nuke 'Em`.
- Asset space top-level and per-post `Nuke 'Em`.
- Target space top-level and per-post `Nuke 'Em`.
- Resolver-only space-post author resolution.
- Large nuke run with background tabs.
- Pause, coordinator-close, source-page-close, worker-tab-close behavior.
- Reload/restart during queued, opening, active, acting, and settling states.
- Browser error page or security verification page.
- Shared-post import parsing from a Quora-rendered post.
