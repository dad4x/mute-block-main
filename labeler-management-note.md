# Labeler Management Note

This note is for design review only.

Its purpose is to examine the practical management questions around using atproto labelers with `mute-block-main`, especially:

- where a labeler would be hosted
- what it would likely cost
- how it would be protected from abuse or DDoS
- how credentials would be managed
- whether to run one labeler or several
- how this interacts with Quora spaces we control ourselves

This note is intentionally more operational than [quora-labeler-bridge.md](/scratch/dbrower/home/src/mute-block-main/quora-labeler-bridge.md).

## Current Status

This note is still planning material only.

Current repo reality:

- there is no labeler service in this repository
- there is no current operational need to host one for the extension's shipped feature set
- the extension now has persistent local memory of remembered space-post `Nuke 'Em` results, with manual clearing plus local auto-pruning by age and entry cap
- if shared moderation or collaboration features are pursued later, this note is the operational checklist
- Firefox release status is currently lagging because store updates are stuck on `1.2`

## UI Planning Note

For later UI cleanup, keep these extension-management options in mind:

- keep the popup focused on quick controls and move `Categorized Spaces` to a dedicated extension page
- use a dedicated extension page with tabs such as `Settings`, `Spaces`, and `Remembered Nukes`
- keep the popup minimal and replace the inline spaces list with a `Manage Spaces` button that opens the full page

This does not need to be implemented now, but it is the current direction for separating quick actions from larger management lists.

## Scope

There are really three separate things here:

1. the local extension
2. one or more external labelers
3. optional Quora spaces we operate ourselves

These should not be collapsed into one system.

The extension is the local action engine.
The labeler is the shared publication and subscription service.
Owned Quora spaces are a possible Quora-native workflow surface for human review, categorization, and reporting.

One practical consequence of the current extension design:

- the persistent remembered-nuke list is already a plausible precursor to a reviewed export workflow
- that means a future labeler pipeline does not need to start from raw page scraping alone
- it could also start from locally accumulated candidate/result lists that are reviewed before publication

## First Practical Question: Do We Actually Need To Host A Labeler?

Before discussing infrastructure, it is worth being explicit:

- if all we want is local policy and local caching, no labeler hosting is needed
- if we want to share judgments across users, collaborate, or subscribe to third-party judgments, then labeler hosting becomes relevant

The labeler should therefore be treated as optional but important infrastructure, not as something the extension must contain internally.

## How And Where Would A Labeler Be Hosted?

Conceptually, a labeler is just a service with:

- a stable identity
- metadata
- a way to publish or serve labels
- operational controls

In practice, there are several plausible hosting shapes.

### Option 1: Small VPS

Host the labeler on a small virtual server from a commodity provider.

Pros:

- cheap
- simple
- full control
- easy to add reverse proxy, logs, and automation

Cons:

- operator is responsible for hardening
- weak default DDoS posture unless fronted by another service
- key handling is your problem

This is probably the most realistic starting point if the expected traffic is low to moderate.

### Option 2: Managed Container Or App Platform

Run the labeler behind a managed container/app service.

Pros:

- easier deploys
- easier rollback
- better secret management in many platforms
- less server maintenance

Cons:

- somewhat higher cost
- still may need external CDN/WAF in front
- platform lock-in risk

This may be a better medium-term shape than a bare VPS if the service becomes collaborative rather than personal.

### Option 3: Static Metadata + Separate API

If the labeler stack permits, split:

- stable metadata and definitions
- dynamic label query/update service

Pros:

- easier caching
- easier CDN protection
- cleaner separation between public docs and mutable data

Cons:

- more moving pieces
- more operational design work

### Recommendation

The likely best path is:

- start with one small service
- put it behind a reverse proxy and edge protection
- keep the architecture boring

Avoid designing for a giant moderation network before there is proof of real usage.

## What Will It Cost?

The honest answer is: probably not much at first, unless it is attacked.

Cost drivers:

- compute
- storage
- bandwidth
- logging/monitoring
- DDoS/WAF/CDN layer
- backup and secret-management tooling

Rough order-of-magnitude thinking:

- very small personal or collaborative service:
  - likely low tens of dollars per month
- somewhat more serious shared service with edge protection and monitoring:
  - likely tens to low hundreds per month
- heavily targeted public service:
  - cost becomes dominated by abuse resistance rather than label serving itself

The label payloads themselves are probably not the expensive part.
The expensive part is keeping the service available and safe.

### Practical Cost Recommendation

Budget planning should distinguish:

- normal operating cost
- abuse-event cost

That distinction matters because a service that is cheap under benign traffic can become annoying or fragile under hostile attention.

## How Will The Labeler Be Protected From DDoS Attack?

This is one of the most important operational questions.

If the labeler becomes visible enough to matter, it may attract nuisance traffic even if its legitimate usage is modest.

### Baseline Protections

At minimum:

- put the service behind a reverse proxy or CDN/WAF layer
- rate-limit query endpoints
- cache metadata and cacheable label responses where possible
- separate read paths from write paths
- keep write/admin endpoints off the public surface where possible

### Strong Recommendation

Do not expose admin or write endpoints on the same public path and trust boundary as public label queries.

Better:

- public read API
- protected admin API
- private or tightly controlled ingestion path

### Abuse Posture

Plan for three classes of hostile activity:

1. volumetric traffic
2. scraping or repeated expensive queries
3. credential-oriented attacks on admin surfaces

Each needs a different control:

- volumetric:
  - edge/CDN/WAF
- expensive repeated queries:
  - rate limits
  - caching
  - query normalization
- admin attacks:
  - separate endpoints
  - strong auth
  - no unnecessary exposure

### Caching Matters

If label definitions and many label-query results are cacheable, that should be exploited aggressively.

The more work the edge can absorb, the less the labeler origin matters.

## How Will Credentials Be Managed?

Credential handling is the part most likely to be done badly if the system grows informally.

There are at least four separate credential domains:

1. labeler service identity
2. deployment/infrastructure credentials
3. admin or publishing credentials
4. extension-side subscription credentials, if any private feeds are ever used

These should not be conflated.

### Baseline Requirements

- no secrets in the extension bundle
- no secrets in git
- use environment or platform secret storage
- rotate credentials deliberately
- distinguish read/public identity from write/admin authority

### Write Access Should Be Rare

Publishing or editing labels should require stronger controls than reading labels.

That suggests:

- a limited set of admin principals
- short-lived operator sessions if possible
- explicit audit logging for mutations

### Extension Relationship

The extension should generally not hold high-value publishing credentials directly.

Prefer:

- extension performs local action and records events
- publication happens through a safer reviewed path

If direct extension-to-labeler publishing ever exists, it should likely use:

- scoped credentials
- low-privilege submission semantics
- server-side moderation/review before labels become public

rather than:

- full-power admin keys in the extension

## One Labeler Or Many?

This is a real design fork.

There are two main choices:

### Option A: One Labeler, Categories On Each Label

Example:

- one labeler identity
- labels carry category values such as:
  - `quora-ai-spam`
  - `quora-harassment`
  - `quora-bad-pattern`
  - `quora-sockpuppet`

Pros:

- simpler operations
- one trust relationship
- one subscription surface
- easier for the extension to consume

Cons:

- one labeler identity may end up carrying too many semantic roles
- less separation between policy domains
- more pressure to keep one service coherent for all audiences

### Option B: Multiple Labelers By Category Or Function

Examples:

- one labeler for spam
- one for harassment
- one for watchlists
- one for highly trusted auto-action signals

Pros:

- cleaner separation of policy domains
- easier selective trust
- easier to say "subscribe to this but not that"
- a compromise or quality problem in one labeler does not automatically taint all categories

Cons:

- more operational overhead
- more metadata to manage
- more subscription complexity in the extension

### Recommendation

The likely practical answer is:

- start with one labeler carrying categories on each label
- reserve the right to split later if trust boundaries diverge

Reason:

- early on, simplicity matters more than perfect taxonomy
- later, if some categories need stronger trust or different governance, they can be separated

Put differently:

- one labeler is probably the right operational default
- multiple labelers become attractive when governance or audience actually diverge

## Which Categories Should Live In Labels?

If using one labeler, categories should travel with each label.

That means the published label values should be descriptive and category-bearing.

Prefer:

- `quora-ai-spam`
- `quora-harassment`
- `quora-bad-pattern`
- `quora-watch`

Avoid a design where category lives only in some out-of-band UI state.

The label value should carry the category semantics plainly.

## Could We Use Our Own Quora Spaces As Workflow Surfaces?

Yes. This is a separate but potentially powerful idea.

We could create spaces of our own and use them as:

- review surfaces
- categorization surfaces
- reporting surfaces
- operator coordination surfaces

That does not replace a labeler, but it may complement one.

### Example Workflow

A button or dropdown in the extension could do something like:

- classify subject as:
  - spam
  - harassment
  - bad pattern
  - watch
- optionally submit a Quora report
- optionally create or queue a post into an owned space
- optionally create a local publishable moderation event

This would create a Quora-native workflow layer alongside the labeler layer.

### Why This Might Be Useful

Owned spaces are useful because they are:

- visible to human operators
- naturally organized around posts and discussion
- easy to use as operational inboxes
- already inside the Quora environment

That can be valuable for:

- team review
- categorization
- evidentiary discussion
- tracking whether a subject was reported or acted upon

### Why This Is Not The Same As A Labeler

An owned space is not a structured moderation publication service.

It is better understood as:

- workflow surface
- evidence board
- review queue
- operator coordination tool

A labeler is still better for:

- machine-readable subscription
- policy-driven intake
- subject-based moderation judgments
- sharing moderation signals outside one Quora UI workflow

### Best Combined Interpretation

The cleanest division may be:

- owned Quora spaces:
  - human workflow and categorization surface
- labeler:
  - structured publication and subscription surface
- extension:
  - local action, collection, and bridge between the two

## Extension Implications

If we take labeler management seriously, the extension will probably need separate controls for:

- labeler subscriptions
- labeler sync
- auto-action policy by labeler or label category
- export or review of local moderation events
- optional posting/reporting workflows to owned spaces

These should not all be jammed into one simple settings page forever.

## Recommended Initial Position

If this system moves forward, the least confused starting point is probably:

1. keep extension-side labeler consumption read-only at first
2. treat local actions as publishable event candidates, not immediate public labels
3. assume one labeler first, with categories carried by label values
4. host it behind edge protection from the beginning
5. keep admin/write credentials away from the extension
6. treat owned Quora spaces as optional workflow surfaces, not as the replacement for the labeler

That balances realism, cost, and safety.

## Open Questions For Review

1. Is the first labeler intended to be personal, small-group, or public?
2. What is the acceptable monthly operations budget?
3. What level of abuse resistance is required from day one?
4. Who is allowed to publish or edit labels?
5. Is there a review queue between local extension action and public label publication?
6. Is one labeler enough at the start, or do governance boundaries already require several?
7. Which categories are important enough to standardize first?
8. Should owned Quora spaces be used only for evidence/review, or also for operator-triggered categorization flows?
9. Should a category/report button in the extension create:
   - local event
   - Quora report
   - owned-space post
   - labeler submission
   - some combination of the above
10. What should be automatic versus explicitly reviewed?
