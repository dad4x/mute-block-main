# Mute Block 2.0 Release Summary Draft

> **Status: ROADMAP** (24 Oct 2026). Draft public release narrative for 2.0, based on 1.6.246. Not an engineering plan. Not scheduled. Check planning.md before acting on it. Register: [notes register](docs/notes-register.md).

Status: release narrative draft.

Canonical planning now starts at [planning.md](planning.md). Canonical
architecture starts at [architecture.md](architecture.md). This file is for
public release framing, not engineering priority or architecture authority.

Development series: `1.6`

Public release name: `2.0`

Current draft source version: `1.6.246`

## One-Line Summary

Mute Block 2.0 is the major release that turns Mute Block from a page-by-page
cleanup helper into a background, collaborative, high-volume way to keep up with
Quora sludge.

## Short Public Summary

Mute Block 2.0 is a major release for people who need the extension to keep up
with the amount of low-value, repetitive, or abusive Quora activity they see.
The 1.4 line added `Nuke 'Em` options for Spaces. 2.0 turns that into a
background workflow: start cleanup from one Space, move to another, keep going,
and let Mute Block process the work without making you wait on every page.

The release also expands the cleanup surface. Mute Block can queue profile work
from profile searches and related profile contexts, so an operator can search
for a target topic or public figure, such as profiles associated with "Elon
Musk", queue the relevant profiles, and let the Dashboard track the background
work, failures, retries, and history.

2.0 is also the collaboration release path. The release line is adding a way to
export blocks to a Quora Space you choose and import public shared blocks from
other people's Spaces so those reports can become local, reviewable mute/block
work. Some of this is implemented now and some remains release-candidate work;
public copy should keep that distinction clear while still making the 2.0
direction explicit.

The theme is not just reliability. The theme is easier cleanup at volume:
background `Nuke 'Em`, broader target discovery, a Dashboard for recovery, and
the first practical path for shared mute/block work.

## What Changed Since 1.4

1.4 made Spaces easier to clean up by adding `Nuke 'Em` actions. The operator
still had to stay close to the page-local workflow.

2.0 changes the operating model:

- launch cleanup from many Spaces without waiting for each Space page to finish;
- let queued work continue in the background;
- use the Dashboard to see current work, ready work, failures, retries, and
  recent history;
- queue profiles discovered through searches and related-profile surfaces, not
  only obvious follower/following/list pages;
- resolve author profiles from Space posts when the feed does not expose a
  direct profile URL up front;
- retry failed work without losing the intended action;
- prepare shared Space posts so one person's block work can be exported,
  imported, reviewed, and executed locally by another person's extension.

## What Users Should Notice

- Background `Nuke 'Em` runs that do not require waiting on one Space, search,
  or list page before moving to the next.
- Easier cleanup across many spaces, with work continuing through the
  service-worker queue and visible in the Dashboard.
- `Nuke 'Em` support for more discovery contexts, including profile searches
  and related people/list surfaces.
- A clearer Dashboard for current work, ready-to-run work, recent history,
  retries, and failures.
- Better recovery after closing the Dashboard, reloading pages, restarting the
  service worker, or losing worker tabs.
- Safer retry behavior: failed rows can be requeued without accidentally
  changing the intended action.
- Better handling of resolver-only space posts where the author profile has to
  be resolved from the source page before mute/block can run.
- Space-feed buttons more accurately reflect durable pending work instead of
  only the current page's transient view.
- Planned or release-candidate collaboration features: export blocks to a
  chosen Quora Space and import shared blocks from public Spaces, with
  provenance and local review controls before execution.

## Feature Status Language

Use this distinction when writing public copy:

| Status | Public framing |
| --- | --- |
| Implemented/current 1.6 work | Durable background queue, Dashboard recovery, multi-context queueing, space-feed queueing, resolver-only author resolution, profile/modal/list queueing, retry/requeue controls, and deterministic test coverage. |
| Release-candidate work if it lands before public 2.0 | Shared-post parser, export to a chosen Space, import from other public Spaces, imported provenance storage, and local review/execute controls. |
| Future 2.x work | Deeper ATproto integration beyond the local shared moderation model. |

Do not flatten those statuses in public release copy. It is fine to say 2.0 is
the collaboration release path; say "available" only for the export/import
pieces that have actually landed and passed release validation.

## Major Feature Areas

### Durable Job Queue

2.0 moves queued work toward a single source of truth so background processing
can keep going after the page that started the work is no longer the center of
the workflow:

- service-worker-owned queue rows are authoritative;
- worker tabs report milestones and terminal results back to the service
  worker;
- legacy `mbProfileNukeProgress` records become compatibility/reporting data
  rather than a parallel state authority;
- queue rows carry canonical job envelope fields such as `jobKey`,
  `actionKind`, `canonicalSubject`, `scope`, and attempt identity.

This is the main reason the release is being treated as `2.0` instead of a
smaller `1.x` increment.

### Background Nuke-Em at Volume

The user-facing leap from 1.4 is that `Nuke 'Em` is no longer fundamentally a
page-local, wait-here workflow.

2.0 is designed for operators who need to keep up with a steady flow of junk:

- queue work from multiple Spaces without waiting for each Space page to finish;
- continue processing through background worker tabs;
- inspect active and failed work from the Dashboard;
- recover queued work after page reloads or service-worker restarts;
- use small batches to avoid turning every cleanup action into a browser-tab
  storm.

This should make daily cleanup feel more like starting reliable jobs and less
like babysitting individual Quora pages.

### Dashboard and Recovery

The old coordinator concept has been reframed as a Dashboard:

- `Current Work`, `Ready to Run`, and `Recent History` separate live work from
  retryable and completed rows;
- manual `Requeue Failed` controls support targeted recovery;
- `Idle Retry` can resume eligible failures without requiring the original
  page state;
- active/retry/terminal statuses are easier to distinguish;
- Dashboard and Preferences cross-link to each other.

The intended direction is that the Dashboard reports and controls durable work,
but does not own the queue state.

### Source-Page and Space-Feed Work

The 1.6 line substantially improves source-page accounting:

- space feeds can queue visible profile-backed posts and resolver-only posts;
- resolver-only rows use `resolve-profile:` work keys until a profile is found;
- unresolved resolver rows clear matching resolver-pending source records;
- aggregate space-feed actions preserve resolver-only entries instead of
  dropping them when profile-backed entries are also present;
- terminal job outcomes drive pending/nuked source-page settlement.

This area remains one of the key release-readiness surfaces because stale
source pending records are user-visible.

### Search and Related-Profile Workflows

2.0 should be presented as more than Space cleanup. The queue model can support
profile work discovered from profile searches and related people/list contexts.

Example public framing:

- search for a topic or public figure, such as profiles associated with
  "Elon Musk";
- queue the relevant discovered profiles;
- let Mute Block process them in the background;
- review progress and failures from the Dashboard.

Only include specific search surfaces in final public copy after the matching
UI path has been validated in the release candidate.

### Reverse Actions

The release line includes fixes for reverse workflows:

- `unblock-unmute` retry/requeue preserves the reverse action instead of
  falling back into a mute/block executor path;
- reverse action progress and terminal states are tracked through the same
  attempt-aware job model;
- profile action timeouts and security-verification states are classified more
  explicitly.

### Tests and Validation

The test strategy has moved beyond simple subject normalization:

- `test/subject.test.js` covers Quora profile canonicalization;
- `test/jobState.test.js` covers pure job-state transitions, retry identity,
  stale-attempt rejection, executor action selection, and reducer behavior;
- `test/p1-contract.test.js` guards current source-level contracts while the
  service worker is still monolithic.

Live validation still matters because Quora is a moving target, but the release
direction is to make deterministic model, contract, fixture, and storage
invariant tests the first line of defense.

### Live Browser Validation

Live browser work uses direct Chrome DevTools Protocol over the remote-debugging
endpoint. Puppeteer is intentionally not part of the validation workflow.

CDP helper scripts summarize queue state, inspect space tabs, reload the
extension, resume queues, requeue failures, close profile tabs, and inspect
storage-backed queue state.

## Shared Moderation Foundation

Shared moderation is part of the 2.0 story, but final release copy needs to
match what lands before tagging. The goal is collaboration without surrendering
local control.

The current design direction:

- Quora shared posts can publish parseable JSON between
  `MBLOCK:BEGIN v=1` and `MBLOCK:END`.
- Shared-post subjects should use `quora-profile:<slug>` because Quora may
  rewrite raw profile URL text when rendering posts.
- Users should be able to export blocks to a Quora Space they choose.
- Users should be able to import public shared blocks from other users' Spaces.
- Shared records should distinguish publisher intent from local action policy.
- Imported provenance should be stored separately from local discovery
  evidence, so the Dashboard can answer both:
  - where did the extension find this profile locally?
  - which imported report/list/label caused this queue action?
- ATproto compatibility should reuse the moderation model: typed lists,
  labels, source attribution, stackable sources, and local user control.

If import/export UI is not complete at release time, describe it as
"collaboration groundwork" or "coming in the 2.x line." If it is complete,
describe 2.0 as supporting Space-based shared block exchange.

## Compatibility and Upgrade Notes

- Chrome is the active release track.
- Firefox store updates are currently blocked; the published Firefox add-on is
  still older than the source tree.
- Local extension storage should survive normal browsing and page reloads
  within one installed extension copy.
- Manual local extension replacement can still lose storage if the browser
  treats the replacement as a different extension identity.
- Export/import of local state remains future work unless it is completed
  before the 2.0 release candidate.
- Shared block export/import is planned for the 2.0 line; final release copy
  should say "available" only after the parser, publisher, importer, and local
  review policy are implemented and validated.

## Known Risk Areas Before Release

- Stale `mbSpacePendingNukedPosts` records can still be confusing if durable
  pending state and user-intended current work diverge.
- The service worker remains large and still combines several responsibilities
  that should eventually be split.
- Static contract tests are useful guardrails, but they are not a substitute
  for a proper service-worker model harness.
- Quora DOM and composer behavior can change without notice, so live CDP smoke
  checks remain necessary before shipping.

## Draft Store Listing Copy

Mute Block 2.0 is a major update for people who need to keep up with the volume
of low-value, repetitive, or abusive Quora activity. It keeps the familiar
one-click profile actions and bulk `Nuke 'Em` tools, but turns them into a
background workflow built for sustained cleanup.

The 1.4 line added Space `Nuke 'Em` controls. 2.0 makes them much easier to use
at volume: queue work from many Spaces, move on, and let the Dashboard track
current work, retries, failures, and history.

2.0 also broadens where cleanup can start. It can queue profile work from
searches and related profile contexts, so searches for profiles associated with
a public figure or topic can become background mute/block work instead of a
manual page-by-page session.

Highlights:

- background `Nuke 'Em` processing for Spaces, searches, and profile discovery
  contexts;
- faster multi-space cleanup without waiting on each page;
- clearer Dashboard for active, queued, failed, and completed work;
- better recovery after reloads, closed tabs, and service-worker restarts;
- improved space-feed handling, including author-profile resolution;
- safer retry and requeue behavior;
- collaboration groundwork for exporting shared blocks to a Quora Space and
  importing public shared lists from other users.

If shared import/export lands before release, replace the last highlight with:

- export block lists to a chosen Quora Space and import public shared lists
  from other people's public Spaces, with provenance and local review controls
  before execution.

## Draft Internal Release Note

The `1.6` line is the private stabilization series for public `2.0`. It closes
the `1.5` coordinator/debugging lane and moves the product toward a
service-worker-owned durable queue.

Position this as a major release, not just a reliability patch. The user-facing
promise is easier high-volume cleanup: background `Nuke 'Em` from many Spaces,
profile-search-associated targets, Dashboard recovery, and a collaboration path
for exchanging block work through public Spaces.

Avoid release language that makes 2.0 sound like an internal queue rewrite. The
queue rewrite matters because it enables the product promise: the operator can
start cleanup from multiple sources, stop babysitting individual pages, recover
from failures, and begin sharing useful block work with others.

Ship criteria should focus on:

- no known path where queued jobs are mutated by stale progress mirrors;
- source-page pending state settles from terminal job outcomes;
- background jobs can be started from multiple source contexts without
  requiring the operator to wait on each page;
- retry/requeue preserves action kind and attempt identity;
- Dashboard closure/reload does not strand active work;
- any public shared import/export claim is backed by parser, provenance,
  publisher/importer, and local review policy validation;
- `npm test` and syntax checks pass;
- Chrome build/reload and a small live CDP smoke pass are clean.

## Open Release Questions

- What version number should be shown publicly: exactly `2.0.0`, or a mapped
  package version derived from the private `1.6.x` line?
- Should shared moderation be mentioned as "foundation only" or omitted from
  public release copy until import UI exists?
- What is the minimum live Quora smoke matrix required before tagging the 2.0
  release candidate?
- Do we need an explicit local-state backup/export warning in the release notes?
