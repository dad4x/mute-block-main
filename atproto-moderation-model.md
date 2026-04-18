# atproto Moderation Model Notes for `mute-block-main`

This note captures the parts of the atproto / Bluesky moderation model that are directly relevant to shared mute/block lists in `mute-block-main`.

The goal is to avoid inventing a parallel system when the protocol has already worked through many of the important design questions.

Sources reviewed:

- `bsky-docs/blog/2024-03-15-blueskys-moderation-architecture/index.md`
- `bsky-docs/docs/advanced-guides/moderation.md`
- `bsky-docs/docs/tutorials/user-lists.mdx`
- `app.bsky.graph.*` list lexicons
- `app.bsky.labeler.service` lexicon

## Current Status

This note is still design/reference material, not a description of shipped protocol support.

Current repo reality:

- the extension currently acts as a local Quora action tool with local settings and queued tab execution
- there is no implemented atproto labeler intake, modlist import, DID management, or remote moderation sync in the codebase today
- this document remains useful as a model for how to separate published judgments from local enforcement if shared moderation features are added later
- Firefox distribution is temporarily behind the source tree and remains stuck on `1.2`

## Executive Summary

The important atproto insight is that "shared moderation" is not one thing.

It is at least two separate systems:

1. **Labelers**
   publish judgments or annotations about accounts/content
2. **Modlists**
   publish concrete sets of actors for aggregate mute/block action

Those should remain separate in `mute-block-main`.

Do not collapse these into a single "blocklist import" concept.

If we copy the atproto model faithfully enough, `mute-block-main` should have:

- trusted sources
- source-published lists
- source-published labels/tags/reasons
- local user policy deciding how each source/list/label is acted on

## What atproto Actually Does

### 1. Stackable moderation

Bluesky moderation is explicitly stackable:

- network takedowns
- labels from moderation services
- user controls such as mutes and blocks

For `mute-block-main`, the equivalent would be:

- hard local safety rules
- imported judgments from trusted publishers
- user-specific mute/block choices

### 2. Separation of roles

The architecture document emphasizes separation of:

- hosting
- identity
- moderation
- client behavior

That matters here because a shared source should not directly force a Quora action.

The source should publish information.
The local extension should decide what to do with that information.

That is the critical design principle to borrow.

### 3. Labelers

A labeler publishes labels on accounts or records.

A label has a shape like:

```json
{
  "src": "did:example:publisher",
  "uri": "at://did:example:user/app.bsky.feed.post/123",
  "val": "spam",
  "cts": "2026-04-14T00:00:00Z"
}
```

Important concepts:

- `src`: who is asserting the label
- `uri`: what the label applies to
- `val`: the short machine-readable judgment
- user policy controls whether that label is hidden, warned, or ignored

The client does not have to treat labels as automatic blocks.

That is exactly the right pattern for `mute-block-main`.

### 4. Label definitions

atproto labelers define semantics for their labels, including:

- severity
- blur behavior
- default setting
- localized name and description

The important reusable idea is:

- publishers define machine-readable labels
- publishers also define human-readable meaning
- users still control policy

For Quora, that would map well to labels like:

- `ai-spam`
- `harassment`
- `drive-by-abuse`
- `sockpuppet-cluster`
- `bad-pattern`
- `watch`

But the extension should map those to local actions, not the publisher.

### 5. Modlists

This is the piece most directly relevant to shared block lists.

atproto lists have an explicit `purpose`.

Known purposes include:

- `app.bsky.graph.defs#modlist`
- `app.bsky.graph.defs#curatelist`
- `app.bsky.graph.defs#referencelist`

The important one is:

- `modlist`: "A list of actors to apply an aggregate moderation action (mute/block) on."

This is better than a generic "shared JSON list" because the type tells the client how the list is intended to be used.

### 6. User controls remain local

Bluesky lets users:

- subscribe to labelers
- mute or block lists
- configure how labels are interpreted

The key principle is:

- publisher intent is not the same as local enforcement

That is the part we should not lose.

If `mute-block-main` imports a source, it should still let the user choose:

- ignore
- flag only
- warn only
- queue for review
- mute
- block
- mute+block

## What Not To Copy Literally

We do not need to copy all of atproto.

Specifically, `mute-block-main` does not need:

- DIDs
- AT URIs
- PDS/AppView/Relay architecture
- label firehose subscriptions
- federation

Those solve network-wide interoperability problems that this extension does not have.

What we want is the **moderation model**, not the entire transport and identity stack.

## What To Reuse Directly

These ideas should be reused almost verbatim.

### 1. Separate judgments from actions

Two different data types:

- **labels**: descriptive judgments
- **modlists**: actor collections intended for moderation action

### 2. Source identity matters

Every imported datum should carry:

- who published it
- when
- why

Equivalent of atproto `src`.

### 3. Typed lists

Do not just have "a list".

Have at least:

- `modlist`
- `curatelist`
- `referencelist`

Suggested meanings in `mute-block-main`:

- `modlist`
  candidate for mute/block workflows
- `curatelist`
  accounts to surface, inspect, or track
- `referencelist`
  inert reference material, no action

### 4. User policy overlays

For each source/list/label, local user policy should decide:

- enabled or disabled
- default action
- review required or not

### 5. Stackability

Multiple sources should be usable together.

Conflicts should be resolved locally, not by the source.

Example:

- one source says `watch`
- another source puts same account on a `modlist`
- local policy decides whether that means queue, mute, or mute+block

### 6. Human-readable policy declarations

Like `app.bsky.labeler.service`, each source should publish metadata describing:

- what it publishes
- intended meaning
- who it is for
- what evidence standard it uses
- contact / appeals / correction path

This is more important than signatures alone.

## Proposed `mute-block-main` Translation

### Data model

The closest useful translation is:

#### Source

Publisher identity and policy declaration.

```json
{
  "id": "trusted-source-example",
  "name": "Trusted Source Example",
  "url": "https://example.org/quora/source.json",
  "description": "Publishes Quora moderation labels and modlists.",
  "contact": "ops@example.org",
  "public_key": "base64...",
  "kinds": ["labels", "lists"]
}
```

#### Labels document

Judgments about Quora profiles.

```json
{
  "source": "trusted-source-example",
  "updated_at": "2026-04-14T00:00:00Z",
  "definitions": [
    {
      "identifier": "ai-spam",
      "severity": "alert",
      "default_setting": "warn",
      "name": "AI Spam",
      "description": "Repeated low-value AI-generated posting."
    }
  ],
  "labels": [
    {
      "subject": "https://www.quora.com/profile/Example-User",
      "val": "ai-spam",
      "reason": "Repeated AI-generated answer spam",
      "created_at": "2026-04-14T00:00:00Z"
    }
  ],
  "signature": "..."
}
```

#### Lists document

Typed profile collections.

```json
{
  "source": "trusted-source-example",
  "updated_at": "2026-04-14T00:00:00Z",
  "lists": [
    {
      "id": "quora-ai-spam-modlist",
      "purpose": "modlist",
      "name": "Quora AI Spam",
      "description": "Profiles identified for aggregate moderation action.",
      "profiles": [
        "https://www.quora.com/profile/Example-User"
      ]
    }
  ],
  "signature": "..."
}
```

### Local policy model

The local extension should maintain a separate policy layer:

```json
{
  "sources": {
    "trusted-source-example": {
      "enabled": true,
      "require_review": true
    }
  },
  "labels": {
    "trusted-source-example:ai-spam": "warn"
  },
  "list_purposes": {
    "modlist": "queue",
    "curatelist": "ignore",
    "referencelist": "ignore"
  },
  "lists": {
    "trusted-source-example:quora-ai-spam-modlist": "mute_block"
  }
}
```

This is very close in spirit to atproto moderation preferences.

## Recommended Product Behavior

### On profile page

When visiting a profile, `mute-block-main` should be able to show:

- matched sources
- matched labels
- matching lists
- local configured action

Example:

- Source: `Trusted Source Example`
- Labels: `ai-spam`, `bad-pattern`
- Lists: `Quora AI Spam (modlist)`
- Local policy: `review before mute+block`

Then the user can choose:

- `Mute Block`
- `Mute Only`
- `Ignore`
- `Never act automatically on this source`

### On popup/list pages

For follower/following/contributor popups:

- visually annotate matched profiles
- show source/list badges
- allow filtering by source or label
- allow `Open Matched Profiles`
- allow `Nuke Matched Profiles`

This would be the strongest synthesis of Blockzooka-style discovery with `mute-block-main` action.

## Security / Trust

atproto relies heavily on explicit publisher identity.

For `mute-block-main`, minimum trust requirements should be:

- fetch over `https`
- pin a source identity
- verify a digital signature
- show diffs on update
- allow full source disable/removal

Blindly importing unsigned "trusted" lists would miss the point of the model.

## Suggested MVP

The smallest version that still respects the atproto model would be:

1. support local import/export of typed source documents
2. support `modlist` and `labels` as separate document types
3. add local policy mapping from source/list/label to action
4. annotate profiles when matched
5. require explicit user action before mute/block

That would already be meaningfully aligned with atproto moderation design.

## Recommended Direction

Do not build:

- one monolithic "shared blocklist" feature

Build:

- source declarations
- typed lists
- descriptive labels
- local user policy
- extension-side action

The wheel worth reusing from atproto is not federation.

It is the moderation architecture:

- stackable
- typed
- source-attributed
- user-controlled
- composable

That is the right model for trusted shared moderation in `mute-block-main`.
