# Space Classification And Nuclear Workflow Note

This note is for design review only.

It does not propose immediate implementation. The goal is to clarify how `mute-block-main` could evolve from its current direct-action `Nuke 'Em` behavior into a stateful workflow for classified Quora spaces and related feeds.

## Current Status

This note describes a possible next layer on top of the current extension, not a shipped feature.

Current repo reality:

- `Nuke 'Em` already exists for supported page-local contexts and uses the background queued-tab executor
- `Open Profiles` and related modal/page actions already exist
- there is no persisted space-classification registry, no `asset` / `target` UI, and no labeler-backed space workflow yet
- Firefox distribution is still stuck on `1.2`, so current cross-browser rollout is not fully aligned

## Current State In `mute-block-main`

Today the extension already has a `Nuke 'Em` action, but it is narrower than a full space-classification model.

Current behavior:

- `Nuke 'Em` exists on certain page-local contexts, especially:
  - `space-post` pages
  - follower/following-style people modals
- the content script collects profile URLs from the current DOM
- those URLs are queued into background-managed tabs with `tabAction: 'nuke'`
- each profile tab then runs the existing mute+block flow and closes when the blocked state is confirmed

Important characteristics of the current implementation:

- the queueing and tab ownership model already exists and is reusable
- the final action target is a profile page
- the current source model is mostly "page exposes profile URLs directly"
- the current space-post collector has a hardcoded minimum threshold before the button appears

Relevant code areas:

- page typing in [shared/js/content.js](/scratch/dbrower/home/src/mute-block-main/shared/js/content.js#L587)
- space-post `Nuke 'Em` injection in [shared/js/content.js](/scratch/dbrower/home/src/mute-block-main/shared/js/content.js#L2621)
- modal `Nuke 'Em` flow in [shared/js/content.js](/scratch/dbrower/home/src/mute-block-main/shared/js/content.js#L2915)
- queued tab execution in [shared/js/content.js](/scratch/dbrower/home/src/mute-block-main/shared/js/content.js#L2994)
- persistent extension state in [shared/js/popup.js](/scratch/dbrower/home/src/mute-block-main/shared/js/popup.js) and [shared/js/sw.js](/scratch/dbrower/home/src/mute-block-main/shared/js/sw.js)

## Main Design Shift

The suggested shift is:

- do not rely on recognition alone to decide whether a page gets a `Nuke 'Em` button
- classify each space as `asset`, `neutral`, or `target`
- default every space to `neutral`
- allow the user to explicitly convert a trusted space to `asset`
- remember space classification across sessions
- offer different workflows depending on classification

This changes the mental model from:

- "I found enough profile links on this page, so maybe bulk action is allowed"

to:

- "The user has already declared what kind of space this is; now I only need to safely derive targets or trusted listings from the current page"

That is a better fit for the existing durable local state in `browser.storage.local`.

## Space Classification Model

Each space has one of three classes:

- `asset`
- `neutral`
- `target`

Default:

- `neutral`

Meaning:

- `asset`
  - a trusted space whose listings will be used to identify targets
- `neutral`
  - no special trust or hostility by default
- `target`
  - a hostile or untrusted space whose associated actors may be candidates for action

This directional distinction matters.

For an `asset` space:

- consume listings from it
- use it for discovery
- derive targets from profile links, reported rows, post authors, or similar structures

For a `target` space:

- derive actors from the space itself
- contributors, moderators, authors, or similar associated actors may be candidates for `Nuke 'Em`

For `neutral`:

- no special bulk workflow by default

## Corrected Meaning Of Enrollment

The earlier note used the word `enrollment` too loosely.

The corrected meaning should be:

- `enrollment` means converting a space to `asset`

That is not the same as generally marking a space "nuke-eligible."

There are also spaces that are not trusted and should instead be marked `target`.

So the important first action is classification, not generic enrollment.

## Proposed Conceptual Model

A classified space would have:

- a stable space identity
- a classification
- one or more collector modes
- a target resolver

Suggested collector modes:

- `profile-links`
- `reported-items`
- `post-authors`

These are intentionally different.

### `profile-links`

This is closest to the current implementation.

Examples:

- contributor lists
- followers/following modals
- space post bodies that directly link to target profiles

### `reported-items`

This is for pages that show reported questions, answers, or posts, where the row itself is the unit of moderation interest and the actor may have to be derived from row structure.

### `post-authors`

This is the `InstantBlock`-style case:

- the page is a feed of posts
- the actor to nuke is the author of each feed item
- the page does not need to expose a clean bulk list of `/profile/` URLs up front

## Why `InstantBlock.html` Matters

The saved page [InstantBlock.html](/home/dbrower/InstantBlock.html) is more informative than the `_files` directory because it contains the actual page snapshot and embedded app state.

Useful observations from that file:

- it is a Quora tribe page saved from `https://instantblock.quora.com/`
- it clearly contains `TribeMainPageLoadable` markers, so it is a space main page
- it contains embedded feed-story data for the tribe
- it contains author objects and post objects in bootstrapped state
- it contains author moderation state such as `isBlockedByViewer`

This supports an important conclusion:

- some useful spaces are not fundamentally "lists of profile links"
- some are feed pages where rows imply an actor, and the actor can be derived from row DOM or embedded state

That means the extension should not overfit its design to direct profile-link harvesters.

## Recognition And Classification Are Separate

The extension should probably distinguish three states:

1. not recognized as a candidate
2. recognized as a candidate but still `neutral`
3. classified as `asset` or `target`

Expected behavior:

- state 1:
  - no bulk-action button
  - possibly no UI at all
- state 2:
  - offer classification actions
  - optionally show lightweight hints that the page appears actionable
- state 3:
  - try the configured collector
  - if at least one actionable target resolves, show `Nuke 'Em (N)`

Recognition should answer:

- "Is this page tied to a classified space?"
- "Can I derive actionable targets here?"

It should not have to answer:

- "Should I trust or condemn this space for the first time?"

That is a classification decision.

## Persistence

The extension already persists settings and tab state in `browser.storage.local`, so a space registry fits naturally.

Possible stored structure:

```js
{
  spaces: {
    "<spaceKey>": {
      spaceKey: "quora:space:4442071",
      label: "Instant Block",
      classification: "target",
      collectorModes: ["post-authors"],
      addedAt: 1713312000000
    }
  }
}
```

The key point is that the space should be identified by a stable space identity, not by one specific URL instance.

For Quora spaces, the best key is probably based on tribe identity if available, rather than pathname text alone.

## No Minimum Target Count

The reviewed preference is that there should be no minimum count for classified spaces that currently yield actionable targets.

One actionable target is enough.

That means the current threshold-oriented logic for space-post pages should not define the future model.

A better rule is:

- if a space is classified as `asset` or `target` and its collector resolves `>= 1` actionable targets, offer `Nuke 'Em`

This matters especially for report-like or feed-like pages where only one visible row may currently be actionable.

## Safety Model

The right safety model is not "recognize perfectly."

The right safety model is:

- explicit classification
- source-specific collectors
- conservative target resolution
- bounded execution

### Explicit classification

Bulk action should only become easy on spaces the user has previously classified.

### Source-specific collectors

Do not use one giant generic scraper for every page type.

Instead, use collectors matched to source type:

- direct profile-link collector
- report-row collector
- post-author collector

### Conservative target resolution

If a row does not resolve cleanly to an actor, skip it.

This is especially important for `reported-items` and `post-authors`.

The extension should not guess the target from weak signals.

### Bounded execution

Even on classified spaces, collection should not run forever.

Reasonable bounds:

- cap total resolved targets per click
- cap auto-scroll or expansion passes
- stop if no new targets are found
- stop after elapsed time budget
- require another click to continue after a bounded batch

## Target Descriptor Abstraction

The current code often treats a target as a profile URL string.

For classified spaces, the better abstraction is a target descriptor:

```js
{
  kind: "profile" | "post" | "question",
  profileUrl: "https://www.quora.com/profile/...",
  sourceUrl: "https://instantblock.quora.com/",
  sourceType: "space",
  resolverMode: "post-authors",
  spaceClassification: "target"
}
```

Even if the final queue still consumes profile URLs, an intermediate descriptor layer is useful because:

- not every source yields direct profile links
- some sources yield rows that must be resolved to actors
- descriptors make it clearer what was collected and why

## Interaction With atproto Labelers

The repo already contains two useful moderation notes:

- [quora-labeler-bridge.md](/scratch/dbrower/home/src/mute-block-main/quora-labeler-bridge.md)
- [atproto-moderation-model.md](/scratch/dbrower/home/src/mute-block-main/atproto-moderation-model.md)

Those notes mostly examine labelers as an inbound publication source.

The present review suggests a broader framing:

- every local mute/block action is a potential outbound moderation signal
- classified spaces are a potential discovery and execution layer
- labelers are a potential publication and subscription layer around that local activity

This matters because the classified-space model should not become an isolated local-only workflow if we already expect labeler interaction later.

### Core Principle

Keep three concepts separate:

1. local observation and collection
2. local action
3. shared publication and shared intake

The extension can perform all three, but they should not be collapsed into one step.

In particular:

- collecting a target from a classified space is not the same as publishing a label
- muting or blocking a target is not the same as asserting a global truth
- consuming a label from a trusted labeler is not the same as automatically blocking

That is consistent with the atproto moderation model already described in the repo.

## Outbound View: Local Action As Potential Labeler Report

One useful thought experiment is:

- every successful local `mute`
- every successful local `block`
- every successful local `mute+block`

could become a candidate moderation event for later publication to a labeler.

That does not mean every action should be published automatically.

It means the local system should be shaped so that publication is possible.

### Why This Is Valuable

If the extension already knows:

- which space page produced the target
- which collector mode resolved it
- what the space classification was
- which local action was taken
- whether the action actually succeeded
- when the action happened

then it has enough information to produce a structured moderation observation for later review or publication.

### Recommended Event Model

Treat each completed local action as a moderation event candidate.

Conceptually:

```json
{
  "subject": {
    "canonical_url": "https://www.quora.com/profile/Some-User",
    "subject_type": "quora-profile"
  },
  "action": "mute_block",
  "source": {
    "space_key": "quora:space:4442071",
    "space_classification": "target",
    "collector_mode": "post-authors",
    "source_url": "https://instantblock.quora.com/"
  },
  "observed_at": "2026-04-17T00:00:00Z",
  "succeeded": true
}
```

This is intentionally not yet a label record.

It is a local event from which label publication may later be derived.

### Why Not Publish Every Action Immediately

Automatic publication of every local mute/block is risky.

Reasons:

- local actions can be tactical and temporary
- local actions may reflect personal thresholds, not shared evidence standards
- some actions are done under uncertainty
- repeated local blocks do not necessarily imply the right shared label semantics

So the extension should distinguish:

- local enforcement event
- candidate publication event
- published label

These are different states.

### Better Publication Model

The better model is likely:

1. local action occurs
2. extension records a publishable moderation event candidate
3. user reviews or policy filters those candidates
4. selected candidates are transformed into labeler submissions or local export material

This preserves reversibility and judgment.

## Inbound View: Consuming Labeler Information

The other half of the design is how classified-space workflows should consume labeler data.

If a page yields targets from an `asset` or `target` space, labeler data could affect:

- whether a row is visually emphasized
- which rows sort first
- whether `Nuke 'Em` shows count or count by severity
- whether rows are skipped as already well-covered
- whether the extension suggests `watch`, `mute`, or `mute+block`

For each resolved target from a classified space:

- check local cache for labels from trusted labelers
- annotate the row or button UI
- optionally prioritize targets with stronger consensus
- optionally de-prioritize or skip subjects already locally blocked

The extension should still decide:

- ignore
- surface
- queue
- mute
- block
- mute+block

## How Space Classification And Labelers Fit Together

The classified-space model and the labeler model should not be built as separate systems that happen to coexist.

They should meet at a common subject and event model.

### Shared Subject Model

Both systems need the same normalized subject identity:

- canonical Quora profile URL
- later alias and UID support if available

That means target resolution for classified spaces should already produce subject records that are labeler-ready.

### Shared Local Cache

The extension should eventually want one local cache for:

- observed subjects
- local actions
- labeler assertions
- space classification and source provenance

In conceptual terms:

```json
{
  "subject": "https://www.quora.com/profile/Some-User",
  "seen_from_spaces": ["quora:space:4442071"],
  "local_actions": [
    {"action": "mute_block", "at": "2026-04-17T00:00:00Z"}
  ],
  "labels": [
    {"src": "did:web:publisher.example", "val": "quora-ai-spam"}
  ]
}
```

### Classified Spaces As Discovery, Labelers As Publication

The cleanest relationship may be:

- classified spaces are primarily discovery and execution sources
- labelers are primarily publication and subscription sources

But there is overlap:

- classified-space activity can generate candidate publication events
- labelers can enrich or prioritize classified-space targets

That overlap should be explicit in the design.

## What To Borrow From Blockzooka

This section should be read in a collaborative spirit.

The intent is not to dismiss Blockzooka or to treat it as something to be replaced. The more useful framing is:

- Blockzooka has explored real moderation workflows on Quora
- `mute-block-main` has grown a more persistent extension-based execution layer
- the two efforts may be able to inform each other well

### Strongest Ideas To Reuse

The most valuable contributions from Blockzooka appear to be upstream of direct action.

These include:

- pattern-assisted discovery
- extracting targets from clustered contexts
- treating report pages, space feeds, contributor lists, and similar views as target sources
- keeping a distinction between finding targets and acting on targets
- embracing human-guided triage rather than pretending every workflow starts on a clean profile page

These ideas fit the classified-space model very well.

### What Blockzooka Seems Especially Good At

Blockzooka appears strongest in the discovery and collection layer.

That means:

- noticing operationally useful page types
- recognizing where nuisance accounts cluster
- extracting candidates from those contexts
- giving an operator practical leverage before the final action step

That is a meaningful contribution, and it is not something the current extension should ignore.

### What `mute-block-main` Seems Especially Good At

`mute-block-main` appears strongest in the execution and persistence layer.

That means:

- continuous page integration
- SPA-aware button injection
- persistent settings and queue-like state
- tab ownership and bounded batch execution
- safer page-local action loops

So the two projects may be most complementary when:

- Blockzooka contributes source ideas and collection heuristics
- `mute-block-main` contributes durable, page-native execution and policy structure

### Recommended Reuse Strategy

The best reuse strategy is probably:

- borrow ideas first
- borrow heuristics second
- borrow code selectively and carefully

### Borrow Ideas First

The first thing to reuse is Blockzooka's workflow insight:

- moderation starts before the profile page

That insight should directly shape:

- classified space design
- collector-mode taxonomy
- target resolver design
- queue/provenance structure

### Borrow Heuristics Second

The next most useful thing to reuse is page-specific operational knowledge.

Examples:

- which Quora contexts are useful target sources
- what a "reported" or "clustered nuisance" context looks like in practice
- where contributor/follower/report-like extraction is operationally effective
- which false positives or dead ends operators have already learned to avoid

This kind of knowledge is often more valuable than literal code reuse.

### Borrow Code Selectively

Code reuse is still possible, but it should be selective.

Most likely candidates for adaptation:

- extraction logic
- page heuristics
- URL normalization ideas
- target de-duplication logic

Less likely candidates for direct reuse:

- monolithic bookmarklet flows that combine scrape, decide, and act in one pass
- tightly timed UI-driving scripts built for one DOM moment
- code paths that assume every source yields direct profile URLs immediately

The problem is not that such code is "bad." The problem is that the extension has different lifecycle and state-management needs.

### How To Be Respectful In Collaboration

If collaboration with the Blockzooka author happens, the best tone is probably:

- acknowledge that Blockzooka identified real operational patterns first
- be explicit that `mute-block-main` is not trying to erase or rebrand that work
- ask where the author thinks the strongest collection heuristics live
- ask which workflows still work reliably and which have gone stale
- ask which pieces are best understood as ideas, heuristics, or code worth porting

### Best Combined Mental Model

The cleanest combined model at the moment is:

- Blockzooka contributes discovery concepts, collection heuristics, and operator workflow insight
- labelers contribute shared publication and shared intake
- `mute-block-main` contributes durable local policy and execution

## UI Thoughts

Likely page-level UI states:

- `Mark As Asset`
- `Mark As Target`
- `Nuke 'Em (N)`
- `Return To Neutral`
- possibly `Pause` or `Disable`

The button should reflect the current collected count:

- `Nuke 'Em (1)`
- `Nuke 'Em (12)`

This helps the user understand what the current page would do before clicking.

## Open Questions For Review

These need review before implementation:

1. What is the canonical key for a Quora space?
2. Should classification be per space, per page subtype, or both?
3. Should collector mode be inferred or chosen explicitly when classifying?
4. Should an `asset` or `target` space be allowed to use multiple collectors?
5. Should the collector be DOM-first with embedded-state fallback, or should embedded-state parsing be a first-class strategy?
6. What is the right cap for one click:
   - resolved targets
   - scroll passes
   - elapsed time
7. How visible should space-classification metadata be in the popup configuration UI?
8. Should there be an export/import path for classified spaces?
9. What metadata from classified spaces is important enough to attach to a label candidate?
10. How should multiple trusted labelers influence row ranking on classified-space pages?

## Recommended Direction

Before implementing anything, the cleanest design direction appears to be:

1. define a durable space-classification registry in local storage
2. separate space classification from target recognition
3. support multiple collector modes
4. resolve all collected items into explicit actor targets before queueing
5. keep the existing queued profile mute+block path as the final executor
6. record local action events in a way that can later feed publication
7. consume trusted labeler information as triage and annotation input, not as automatic authority

That preserves the working part of `mute-block-main` while broadening the kinds of spaces it can safely use.

## Recommendation For The Next Review

The next review should focus on interface and data model, not DOM implementation details.

Specifically:

- agree on the space identity model
- agree on the classification model
- agree on the collector-mode taxonomy
- agree on storage shape
- agree on the user-facing classification workflow

Only after that should the DOM collection strategies be implemented page by page.
