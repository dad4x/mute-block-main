# Quora Labeler Bridge Design

This note describes a concrete design for using **atproto labelers** as the publication layer for `mute-block-main`.

The goal is:

- do not invent a separate publication ecosystem
- reuse labelers because people already know how to run them
- keep Quora-specific identity matching and action policy inside the extension

## Current Status

This remains a forward-looking bridge design.

Current repo reality:

- `mute-block-main` does not yet subscribe to labelers, fetch labels, resolve DIDs, or expose labeler-management UI
- the extension does already have the local execution pieces this design would eventually feed into, including page-local actions, batch profile opening, and queued `Nuke 'Em` execution
- the extension also now keeps a persistent local record of remembered space-post nuke results, with local clearing and pruning controls; that is still local-only, but it is a realistic seed for later reviewed export into shared labeling workflows
- the immediate release situation is uneven because Firefox store updates are stuck and the published Firefox add-on is still on `1.2`

## UI Planning Note

If shared moderation or labeler-management UI is added later, the current preferred layout options are:

- leave the popup as a quick-action surface and move larger lists such as `Categorized Spaces` to a dedicated extension page
- use a tabbed extension page for `Settings`, `Spaces`, and `Remembered Nukes`
- optionally keep only a launcher button in the popup for opening that management page

That matters because list-heavy management screens are already pushing beyond what the popup is good at, while an extension page can support wider layouts, tabs, and richer filtering.

## Summary

Use atproto labelers as the **source of moderation judgments**.

`mute-block-main` should:

- subscribe to trusted labelers
- fetch labels from those labelers
- match labels to canonical Quora subjects
- apply local user policy to decide what to do

The extension should **not** delegate direct action policy to the labeler.

The labeler says:

- "this Quora subject has these labels"

The extension decides:

- warn
- queue
- mute
- block
- mute+block

## Why This Design

This is the cleanest way to combine:

- atproto’s solved publication and trust model
- Quora’s unsolved, page-local action model

It avoids building:

- a second custom moderation publication stack
- a custom source identity system
- a separate shared-list ecosystem

And it avoids forcing:

- Quora profiles into native Bluesky actor-list semantics where they do not fit naturally

## Core Principle

Treat atproto labelers as **publishers of judgments about Quora subjects**.

Do not treat them as direct automation authorities.

That means the boundary is:

- labeler publishes metadata and labels
- extension performs identity normalization, matching, UI display, and action execution

## Subject Model

This is the most important design problem.

If we get subject identity wrong, everything else is unreliable.

### Recommended canonical subject

Use the canonical Quora profile URL as the primary subject identifier.

Example:

`https://www.quora.com/profile/Some-User`

Normalization rules should at minimum:

- force `https`
- force host to `www.quora.com`
- strip query string
- strip fragment
- remove trailing slash
- preserve `/profile/<slug>`

This gives a stable first-pass identity that labelers can publish against.

### Secondary subject keys

If available, the extension should also learn and cache secondary identifiers:

- Quora numeric user ID if exposed in page markup or structured data
- observed alternate profile URLs for the same subject
- log page URL

Why:

- profile slugs can change
- URL-only matching can break on rename

### Suggested local subject model

```json
{
  "canonical_url": "https://www.quora.com/profile/Some-User",
  "subject_type": "quora-profile",
  "aliases": [
    "https://www.quora.com/profile/Some-Old-Slug"
  ],
  "quora_uid": "123456789",
  "last_seen_at": "2026-04-14T00:00:00Z"
}
```

### Recommendation

MVP:

- support canonical Quora profile URL only

Later:

- add alias and UID reconciliation

## Labeler Data Model

### What the labeler publishes

Labelers should publish labels on Quora profile URLs as URIs.

Conceptually:

```json
{
  "src": "did:web:publisher.example",
  "uri": "https://www.quora.com/profile/Some-User",
  "val": "quora-ai-spam",
  "cts": "2026-04-14T00:00:00Z"
}
```

This is compatible with the atproto label concept:

- `src` identifies the labeler
- `uri` identifies the subject
- `val` identifies the judgment

### Label definitions

Each labeler should publish definitions for the labels it uses.

Recommended Quora-oriented labels:

- `quora-watch`
- `quora-ai-spam`
- `quora-harassment`
- `quora-bad-pattern`
- `quora-sockpuppet`
- `quora-mute-recommended`
- `quora-block-recommended`
- `quora-mute-block-recommended`

The labeler is declaring meaning, not forcing action.

### Strong recommendation

Prefer **descriptive** labels over imperative labels.

Better:

- `quora-ai-spam`
- `quora-harassment`

Worse:

- `block-now`

Reason:

- descriptive labels are more reusable
- local users can map them differently
- they are more faithful to the labeler model

If imperative-style labels are used at all, they should be treated only as recommendations.

## Trust and Subscription Model

The extension should store a list of trusted labelers.

Example local config:

```json
{
  "labelers": [
    {
      "did": "did:web:publisher.example",
      "enabled": true,
      "require_review": true
    }
  ]
}
```

### Trust requirements

At minimum, a labeler should only be accepted if:

- its DID resolves
- its service declaration is valid
- it publishes label definitions
- the user explicitly enables it

### UX model

The extension should expose:

- Add labeler by DID
- View labeler metadata
- Enable / disable labeler
- Choose default action policy for this labeler

This mirrors the user-chosen subscription concept from Bluesky.

## Fetch Model

### MVP fetch strategy

Use **periodic pull** against labeler query endpoints for the subjects we care about.

Practical model:

- when a Quora profile page loads, normalize the subject URL
- ask local cache for labels on this subject
- if stale or missing, fetch from subscribed labelers
- cache results locally

This is much simpler than live subscription and is probably enough.

### Later fetch strategy

If needed, add background refresh or selective synchronization for:

- recently seen subjects
- queued profiles
- popup modal profiles

### Do not start with

- global firehose consumption
- full network label sync
- relay subscription infrastructure

That would solve the wrong problem first.

## Local Policy Model

This is where `mute-block-main` keeps control.

### Per-label policy

The user should be able to map labels to local actions.

Example:

```json
{
  "policies": {
    "did:web:publisher.example": {
      "quora-watch": "warn",
      "quora-ai-spam": "queue",
      "quora-harassment": "mute_block"
    }
  }
}
```

### Allowed local actions

Recommended action values:

- `ignore`
- `warn`
- `queue`
- `mute`
- `block`
- `mute_block`

### Per-labeler defaults

Users should also be able to set defaults for a labeler:

- require review before destructive action
- never auto-block from this labeler
- treat this labeler as informational only

This is important because the same label may be used by labelers with different quality standards.

## Matching Model in the Extension

### Profile pages

When a profile page loads:

1. normalize the current profile into canonical subject URL
2. query local cache and subscribed labelers
3. display source matches in-page
4. apply local policy

Possible UI:

- badge near `Mute Block` button
- small panel showing:
  - matched labeler
  - labels
  - reasons / description
  - configured action

### Popup modal lists

For followers / following / contributors modals:

- inspect visible profile links
- normalize each profile URL
- match against cached labels
- annotate matching rows

That would support:

- `Open Labeled Profiles`
- `Nuke Labeled Profiles`
- filter to a specific label or source

This is probably the highest-value multi-profile integration.

## Recommended UI Flow

### On first source match

If a profile matches a trusted labeler:

- show a non-destructive notice first
- do not silently block on first implementation

Suggested notice:

- source name
- labels
- local configured action
- buttons:
  - `Mute Block`
  - `Mute`
  - `Ignore`
  - `Always do this for this label`

### Batch mode

For lists and popups:

- show counts of matched profiles by label
- let user review before bulk action

This is safer and aligns with the extension’s current interactive style.

## Data Storage in the Extension

Suggested local storage buckets:

### 1. `trustedLabelers`

```json
{
  "trustedLabelers": {
    "did:web:publisher.example": {
      "enabled": true,
      "addedAt": "2026-04-14T00:00:00Z",
      "requireReview": true
    }
  }
}
```

### 2. `labelDefs`

```json
{
  "labelDefs": {
    "did:web:publisher.example": {
      "quora-ai-spam": {
        "name": "Quora AI Spam",
        "description": "Repeated low-value AI-generated activity."
      }
    }
  }
}
```

### 3. `labelCache`

```json
{
  "labelCache": {
    "https://www.quora.com/profile/Some-User": [
      {
        "src": "did:web:publisher.example",
        "val": "quora-ai-spam",
        "cts": "2026-04-14T00:00:00Z",
        "fetchedAt": "2026-04-14T01:00:00Z"
      }
    ]
  }
}
```

### 4. `labelPolicies`

```json
{
  "labelPolicies": {
    "did:web:publisher.example": {
      "quora-ai-spam": "queue"
    }
  }
}
```

## Open Questions

These are the main unresolved design issues.

### 1. Can labelers label arbitrary external Quora profile URLs cleanly?

This appears feasible in spirit because labels target URIs, but we should confirm any practical constraints in the labeler pipeline and clients.

### 2. Do we need a custom URI scheme for Quora subjects?

Possibly something like:

`quora://profile/Some-User`

Current recommendation:

- no, start with canonical HTTPS URLs

Only introduce a custom scheme if URL instability becomes a major problem.

### 3. How should reasons/evidence be surfaced?

The base label shape is compact.
If publishers want richer explanations, we may need:

- label descriptions from definitions
- linked publisher pages
- or a sidecar record convention

### 4. Should destructive actions ever be automatic?

Current recommendation:

- no automatic block in MVP
- allow explicit user approval or reviewed batch action

### 5. How much atproto client code belongs in the extension?

Current recommendation:

- minimal client slice needed to resolve and query trusted labelers
- not a full Bluesky client stack

## Recommended MVP

The first version should do this:

1. add trusted labeler subscriptions by DID
2. fetch and cache label definitions
3. query labels for canonical Quora profile URLs
4. show matches on profile pages
5. map labels to local actions with review
6. annotate modal profile rows using cached matches

That would validate the model without committing to unnecessary infrastructure.

## Recommended Non-Goals

Do not start with:

- full firehose support
- federation features beyond labeler consumption
- automatic destructive action without review
- custom publication stack outside atproto
- trying to mirror Bluesky `modlist` records onto Quora profiles directly

## Bottom Line

The right split is:

- **atproto labelers** for publication, source identity, and stackable moderation inputs
- **`mute-block-main`** for Quora subject normalization, local policy, UI, and page actions

That uses the part of atproto that is already socially and operationally viable, without pretending Quora is itself part of the atproto network.
