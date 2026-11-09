# Shared Moderation Publication Design, 2026-05-18

> **Status: ROADMAP** (24 Oct 2026). Core design of shared-moderation publication (18 May). Runtime integration deferred. The pure module exists and no runtime file imports it. Not scheduled. Check planning.md before acting on it. Register: [notes register](docs/notes-register.md).

Status: active supporting design, runtime integration deferred.

## 27 Oct 2026 decisions and open questions

Folded in from a 27 Oct planning pass. Each item is marked **owner** (stated by the owner on 27 Oct), **proposed** (a suggestion not yet confirmed), or **open** (no decision). Owner items override older text in this note where they conflict. Proposed items override older text only once the owner confirms them.

### Phases

1. Reasons on queue and history rows (owner).
2. Export tracking in history (owner).
3. Manual export, on the public and private channels (owner for the channels; manual-first proposed).
4. Review-only import (proposed). Dead Hand is out of 2.0 (owner).

No version numbers are assigned to these phases (owner).

### Channels

- **Public**: the shared moderation journal. Other people read it. Posts are moderate in size (owner).
- **Private**: roaming configuration and the user's own cross-browser record. Posts can be large, so import is simple (owner).
- **One preference Space per channel**, set in Preferences, with a default for each (owner). The default value is open.
- **Scripted creation** of a Space, with the right permissions, when needed (owner). Whether the extension can do it is open. It must be an explicit user action, never automatic (proposed).
- **Followers-only**: a private Space is readable only by followers who are explicitly accepted (owner). This corrects the earlier statement that Quora has no private posts.

### Reasons

- A reason is a label the user chooses on a block action. The Asset, Target and must-block buttons each get a dropdown with checkmarks. Several may be checked (owner).
- Space reasons are persistent: a Space's checked reasons are remembered and shown as its default (owner).
- Each operation (Space, search, or individual) copies the checked reasons into its queue rows, and they are kept on the history rows (proposed).
- The field is `reason`. It is not "classification", which means Asset, Target and Neutral (owner, 25 Oct).
- CSAM is selectable as the user's own label. It records what that user believes, not a judgment of ours. It is never set automatically (owner, 27 Oct). The Blockzooka note flags this area as legally sensitive, because that project published a list of specific criteria in a public repository. The owner's position covers the local field. It does not settle publication (see open questions).
- Narrower reasons count as broader in reports: store exact checks and expand at report time (proposed).
- Published repo text carries the reason name only, not the criteria wording (proposed).

### Export tracking in history

- A history row carries a shared mark: channel, Space, post id, time, and sequence. A row with no mark is pending (proposed). This replaces a separate outbox, because it overlaps history (owner).
- The mark is written only after a read-back of the posted entry (proposed). This confirms the post exists and prevents double posting. It is not a trust check.
- Pending rows may age out before export. This is accepted (owner).
- Space classification changes are not history rows today. They need the same mark, as dated events (proposed).

### Trust and pairs

- **Trust is the Space's classification, set by the user.** Marking a Space as Asset trusts every poster there until the Space is reclassified (owner). A single-author check is not required for that (owner).
- **Trust is set at the moment of the action.** An export does not re-check trust (owner).
- **Mute and block are one atomic action** for export, tied by one action run id (owner).
- A profile whose mute and block disagree is a bookkeeping problem in the state machine, not a sharing problem (owner).
- **A pardon cancels a pending block.** If the block was already shared, the pardon goes in a newer post. Old posts are never edited (owner).
- A subscriber who has already applied a block decides what to do with a pardon. That is outside the export.
- Dead Hand (automatic action from other people's journals) is out of 2.0 (owner).

### Edge: a Space changes hands

Example: "The Real Q Mods" was an Asset space, was taken over, and is now a Target.

- Each history row records the Space's classification as it was when the action happened. Actions taken while it was Asset stay valid under the trust-at-action rule (proposed).
- Reclassifying a Space as Target stops imports from it. Pending imported items from it are withdrawn, not applied (proposed).
- Classification changes are dated events, so history can show when trust changed (proposed).
- Returning a Space to Asset is a new user decision. Nothing restores trust automatically (proposed).
- **Open:** whether reports should flag blocks made during a takeover period.
- **Open:** what an export does if its destination is taken over.

### Roaming and takeover

- The same-account rule in this note applies `space.classification.set` from the roaming profile automatically. A takeover of the Space that holds the roaming profile would change classifications in every browser that follows it. This is an existing risk, widened by roaming.
- **Proposed:** roaming configuration never changes local trust without a local accept. A classification from another browser appears as an accept-or-ignore prompt. Not confirmed by the owner. If confirmed, this supersedes the automatic apply in the same-account rule.
- Signing the roaming document with a key stored in each browser is a later option. It is not decided.

### Export cadence

- The daily automatic post with a threshold of about 10 events, described earlier in this note, is the later step (proposed). The first step is manual export, through Publish Now.
- What an export lands on and does is open (owner).

### Toolbar

- Left click opens the Dashboard (unchanged).
- Right click gives a menu: Dashboard, Preferences, History, Export (owner). What Export does is open.
- The right-click menu needs the `contextMenus` permission, which is not declared today. Whether Chrome shows an install prompt for it is unchecked (proposed).

### Open questions for export

- **Contents of an export**: events since the last mark (proposed).
- **Post size**: the Quora limit is unknown and needs a live test at increasing sizes. Public posts are moderate; private posts can be large (owner).
- **Deletion**: whether a user can delete or hide their own posts is unknown. It decides how much public history is accepted.
- **Author visibility**: whether Quora shows the author of Space posts.
- **Reasons on public posts**: open. Publishing "this user thinks X" beside a named profile is not settled by the CSAM position above.
- **Composer**: manual posting, where the user clicks Post, is proposed. Automated composing is open.

### Live checks needed

- Read and post in a Space the user owns, using the logged-in session.
- Create a Space with the right permissions (scripted creation), and whether that is allowed at all.
- The followers-only flow: how followers are accepted, and whether the user's other browsers can be accepted without a manual step each time.
- Post size limit, post author display, whether the JSON markers survive, and whether a post can be deleted or hidden.

Canonical planning now starts at [planning.md](planning.md). Canonical
architecture starts at [architecture.md](architecture.md). This note remains the
shared-moderation design detail. Current priority is pure/model and mock work
until queue authority stabilizes.

This note captures the current design discussion for shared Mute-Block
publication, Space classification, scheduling, and ATproto-compatible transport
planning.

The design goal is to let Mute-Block users share useful moderation work without
turning any shared source into an automatic command authority. Local policy
always decides what to do.

## Core Principles

- Treat Quora shared posts as one publication transport, not as the canonical
  architecture.
- Keep the publication schema transport-neutral enough to project later onto
  ATproto labels, modlists, or another backend.
- Use append-only posts. Each post is atomic; no edits or updates are required
  or desired.
- Do not maintain a global index in every browser. Duplicate published facts
  are tolerable and should be handled by import logic.
- Export only state-changing events the local browser profile actually made.
- Local storage is a cache, queue, and local execution record. It is not global
  state.
- Quora is the current roaming/public transport for global user-visible
  records, but the implementation should be able to disable or replace that
  transport if Quora treats this use as a ToS problem.

## Space Classification UI

The existing flat `Asset / Neutral / Target` buttons should become one visible
dropdown at a time.

When a Space is neutral or unset, show:

`Mute-Block Category`

- `Asset`
- `Neutral`
- `Target`

When a Space is an asset, show:

`Mute-Block Asset`

- `Manual`
- `Reviewed`
- `Dead Hand`
- `Neutral`

When a Space is a target, show:

`Mute-Block Target`

- `Manual`
- `Reviewed`
- `Dead Hand`
- `Neutral`

`Neutral` remains available from the asset/target dropdowns so there is a way
back, but it is no longer one peer button in a three-button row. The single
dropdown reduces accidental category churn while keeping the state recoverable.

Suggested storage shape:

```js
{
  category: 'asset' | 'target' | 'neutral',
  mode: 'manual' | 'reviewed' | 'dead-hand' | ''
}
```

Back-compat mapping:

- old `asset` -> `asset/manual`
- old `target` -> `target/manual`
- old `neutral` -> `neutral`

### Mode Semantics

| Category | Manual | Reviewed | Dead Hand |
| --- | --- | --- | --- |
| `Asset` | Detect useful content and expose manual import/queue actions. | Import or detect entries into a review inbox before action. | Let trusted imported/local signals auto-create queue work under caps. |
| `Target` | Show target `Nuke 'Em` controls; user starts actions. | Detect candidates and queue them for review. | Proactively queue/run policy actions when candidates appear. |

The same aggression gradient applies to both asset ingestion and target
suppression.

Decision: keep `Dead Hand` as the current user-facing mode name unless later UI
review changes it. The name intentionally references doomsday nuclear alert
planning and conveys proactive action after a policy threshold is met.

## Identity Model

Distinguish these identities:

- publisher identity: the Quora or ATproto identity users trust;
- source instance identity: one browser profile's extension local storage;
- local account relationship: whether the importer is the same Quora account as
  the publisher.

The source instance id is a generated local storage profile id:

```js
storageProfileId: 'mb-profile-uuid'
```

It is not a machine id. Multiple browsers or browser profiles on one machine
will have different ids. If extension local storage is wiped, a new id is born.

Publication metadata should allow ATproto identity later:

```json
{
  "publisher": {
    "quora_profile": "quora-profile:David-Brower",
    "atproto_did": null,
    "display_name": "David Brower"
  },
  "source_instance": {
    "storage_profile_id": "mb-profile-uuid",
    "storage_profile_label": "Chrome profile: default"
  }
}
```

Subscribers should trust the publisher, not the storage profile id. The storage
profile id is for provenance and debugging.

## Roaming Profile

Decision: each local browser profile should have a `Use Roaming Profile` option.
When enabled, that browser profile reads same-account global configuration from
a public Mute-Block roaming profile document rather than relying only on its
own extension local storage.

The roaming profile is public in practice, even if Quora access controls limit
who casually sees it. Do not put browser-specific information in it. In
particular, the roaming profile should not contain:

- local storage profile ids;
- browser names;
- machine names;
- device labels;
- per-browser queue state;
- local execution history.

Decision: include as many browser-agnostic settings as practical in the roaming
profile, as long as the setting makes sense when treated as public
same-account configuration. A browser profile can use the roaming profile to
pick up the current configuration and later turn `Use Roaming Profile` off if
it should stop following shared changes.

Good roaming-profile candidates:

- Space category/mode;
- shared export Space URL;
- daily export enabled/disabled;
- minimum automatic export batch threshold;
- subscribed/shared source Space list;
- same-account import cadence;
- non-browser-specific policy defaults for Manual/Reviewed/Dead Hand behavior;
- future ATproto publisher or labeler preferences that are not browser-specific
  and are safe to publish.

Keep local-only:

- source instance id;
- browser/profile labels;
- queue state;
- execution history;
- transient leases and retry state;
- local UI layout preferences;
- anything that would reveal machine/browser identity.

To avoid making the user scroll through old posts to find the current roaming
profile document, keep a pinned pointer post in the shared Space. The pinned
post says, in effect:

```text
Current Mute-Block roaming profile: <url>
```

Unlike action journal posts, this pointer post is intentionally updated when a
new roaming profile document is posted. Action journals remain append-only and
atomic; the pinned pointer is the small mutable index that locates the current
profile.

## Event Journal

The shared publication stream should be a mutation journal, not an observation
journal.

Export these events:

- `profile.block.add`
- `profile.block.remove`
- `profile.mute.add`
- `profile.mute.remove`
- `space.classification.set`

Do not export these by default:

- already blocked / already muted observations;
- failed attempts;
- candidates merely found;
- local queue state.

Already-blocked state is useful local execution information, but it is not a
change this browser profile made to Quora.

Decision: unmute/unblock removal events are exportable by default. They reflect
a conscious user pardon and are part of the moderation history, not merely
transient execution noise.

## Privacy And Filtering

Decision: Quora shared-post publication is transparent for the MVP. The
existing reporting-Space action is public by nature, so the Quora transport
should not pretend to provide privacy that the posting surface does not really
have.

The Quora event journal can therefore publish exact profile mutation events,
exact Space classification changes, publisher identity, source instance id,
timestamps, and provenance.

That transparency is intentionally revealing. It can disclose:

- which profiles the user chose to mute, block, pardon, or reclassify;
- which Spaces the user treats as assets or targets;
- when a specific browser profile performed moderation work;
- which source Space or imported report led to an action.

The privacy/filtering question is deferred to the ATproto path. When publishing
reports to labelers or other ATproto-compatible moderation services, the user
may want one of several different postures:

- identified reports, where the publisher explicitly reveals itself;
- anonymous or pseudonymous reports, if the target labeler supports that model;
- redacted reports that omit local provenance or source-instance details;
- local-only actions that are never reported externally.

Importing and acting on ATproto-originated labels, reports, or lists may also
need different filtering than Quora shared posts. The local policy layer should
therefore remain separate from the publication transport and should not assume
that Quora transparency is the right policy for ATproto.

Example Quora-post payload:

```json
{
  "schema": "com.muteblock.eventJournal",
  "schema_version": 1,
  "document_id": "mbj:2026-05-18:mb-profile-uuid:001",
  "publisher": {
    "quora_profile": "quora-profile:David-Brower",
    "atproto_did": null,
    "display_name": "David Brower"
  },
  "source_instance": {
    "storage_profile_id": "mb-profile-uuid",
    "storage_profile_label": "Chrome profile: default"
  },
  "transport": {
    "kind": "quora-space-post",
    "space": "https://my-shared-blocks.quora.com/"
  },
  "published_at": "2026-05-18T00:00:00Z",
  "events": [
    {
      "event_id": "uuid",
      "type": "profile.block.add",
      "subject": "quora-profile:Some-User",
      "occurred_at": "2026-05-18T00:00:00Z",
      "action_run_id": "uuid",
      "provenance": {
        "kind": "space-post",
        "space": "https://example.quora.com/"
      }
    },
    {
      "event_id": "uuid",
      "type": "space.classification.set",
      "space": "https://muteblockexperimental.quora.com/",
      "classification": {
        "category": "asset",
        "mode": "reviewed"
      },
      "occurred_at": "2026-05-18T00:00:00Z"
    }
  ]
}
```

For composite actions such as mute+block, prefer recording the concrete state
changes as separate events tied together by the same `action_run_id`.

## Scheduling

Daily publication is enough for the initial design.

Automatic export:

- collect local unexported mutation events;
- publish at most one daily post if there are enough events;
- suppress automatic posts below a user preference threshold, initially around
  10 events, so low-volume local changes can wait for a larger batch;
- let manual `Publish Now` override the minimum batch threshold;
- mark event ids exported locally only after successful post creation and
  verification that the posted entry contains the expected document and event
  ids;
- provide manual `Publish Now` for testing or urgent sharing.

On automatic export failure, keep the events pending, release the export lease,
record the failure, and wait until the next scheduled day. Do not immediately
retry in a loop. The Dashboard can trigger the same service-worker export path
with `Publish Now` before the next scheduled attempt.

Automatic import:

- scan configured subscribed/trusted/shared Spaces on a daily cadence;
- parse `MBLOCK:BEGIN v=1` / `MBLOCK:END` blocks;
- validate schema and event fields;
- classify the source relationship as `self`, `external`, or `unknown`;
- apply local policy according to source relationship and Space mode.

Manual import controls should include:

- `Import Now`
- `Rebuild From Shared Spaces`
- `Show Last Scan`

No global index is required. Importers should tolerate duplicate event ids,
duplicate subjects, and multiple publishers making similar claims.

## Same-Account Versus External Import

There are two different import audiences.

### Same Quora Account, Different Browser Profile

These browsers already share actual Quora mute/block state through Quora. They
do not need to replay action events into local queue or execution state.

For `self` imports:

- apply `space.classification.set` as roaming configuration;
- possibly apply future explicit user configuration events;
- if `Use Roaming Profile` is enabled, refresh same-account configuration from
  the current roaming profile URL named by the pinned pointer post;
- treat profile mute/block events as audit/history only;
- do not queue profile actions from the user's own action journal.

### Other Users' Subscribing Browsers

For other users, the publisher's event journal is a moderation signal. It is
not already reflected in their Quora state.

For `external` imports:

- treat profile events as moderation inputs;
- preserve publisher, source post URL, document id, event id, and provenance;
- let local policy decide ignore/review/queue/dead-hand action;
- allow stronger behavior only for trusted sources and with caps;
- treat `space.classification.set` events as potentially useful subscriber
  recommendations, but never auto-apply them to the local Space registry.
  Imported Space classifications land in a recommendation inbox and need manual
  approval before they change local categorization.

### Space Classification Recommendation Review

Imported `space.classification.set` events should be stored separately from the
local Space registry until accepted.

The Dashboard or Preferences page should include a `Space Recommendations`
view. Each row should show:

- Space name and URL;
- current local classification, if any;
- recommended classification and mode;
- source publisher and source post URL;
- count of sources making the same recommendation;
- first seen and last seen timestamps;
- actions: `Apply`, `Dismiss`, and `Open Space`.

Applying a recommendation writes the local Space registry. Dismissing records a
local tombstone so the same recommendation does not keep reappearing on every
import.

When visiting a Space that has pending classification recommendations, the
Space classification dropdown should show a compact recommendation indicator.
Activating that indicator should open a new extension tab focused on the
recommendation(s) for that Space. The content-page dropdown should not try to
render the full approval UI inline.

For `unknown` imports:

- default to conservative review-only handling;
- do not auto-apply Space classification or destructive actions.

## Quora Shared-Post Transport

The Quora transport should produce human-readable posts with a machine-readable
appendix, not opaque storage blobs.

Suggested visible post framing:

```text
Mute-Block shared moderation journal for 2026-05-18.

This post lists Mute-Block profile and Space-classification changes I made
today so other Mute-Block users may review or import them.

MBLOCK:BEGIN v=1
{ ... JSON ... }
MBLOCK:END
```

Transport constraints already observed:

- Quora can preserve parseable JSON between `MBLOCK:BEGIN v=1` and
  `MBLOCK:END`.
- Quora may add blank lines; JSON parsing should tolerate whitespace.
- Raw Quora profile URLs are unsafe inside posted JSON because Quora may
  linkify or rewrite visible text.
- Use `quora-profile:<slug>` subjects in Quora posts and canonicalize locally.

To reduce ToS risk:

- keep the cadence low, initially daily;
- avoid edit/update churn;
- avoid hidden blobs or binary payloads;
- keep posts intelligible to humans;
- expose a global disable/kill switch for Quora publishing;
- keep the schema portable to another publisher backend.

## ATproto Compatibility

The publisher layer should anticipate ATproto even if the first transport is
Quora.

Design every event so it can later project to one of:

- a label: a publisher asserts a judgment about a Quora profile;
- a modlist membership change: a publisher adds/removes a subject from a list;
- source metadata: a publisher describes labels, list purpose, or trust model.

Avoid Quora-only names in the core schema. Prefer:

- `subject`
- `publisher`
- `source_instance`
- `event_id`
- `type`
- `provenance`
- `policy_hint`

Local policy remains separate from published assertions. A publisher can report
what it did or recommend intent; the subscriber decides what to do.

The ATproto design must revisit privacy explicitly. Unlike Quora shared posts,
ATproto reporting may support or require choices between identified,
pseudonymous, anonymous, and redacted reports. The extension should not hardwire
the transparent Quora publication model into ATproto labeler submission or
ATproto import policy.

Decision: do not require an ATproto DID for the Quora shared-post MVP. Quora
profile identity is enough for public shared import/export now. ATproto DIDs
become relevant later, after there is a server or labeler service to publish
through.

## Implementation Slices

1. Replace flat Space buttons with the single-dropdown state machine.
2. Extend Space registry records to store `category` and `mode`.
3. Add local storage profile id generation and display/editable label.
4. Add mutation-event recording for successful block/mute/unblock/unmute and
   Space classification changes.
5. Add a pure serializer/parser for `com.muteblock.eventJournal`.
6. Add Quora post transport behind an explicit setting and manual `Publish Now`.
7. Add import parsing into moderation inputs without auto-action.
8. Add source relationship classification: `self`, `external`, `unknown`.
9. Add policy application for `Manual`, `Reviewed`, and `Dead Hand`.
10. Add tests for schema validation, duplicate tolerance, source relationship,
    self-import behavior, and policy decisions.

## Deferred Questions

- ATproto labeler/report submission privacy is deferred until the project is
  ready to design the ATproto server/labeler path.
