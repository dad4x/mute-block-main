# Blockzooka Synergy Note (2026-10-12)

> **Status: ROADMAP** (24 Oct 2026). Design context and cautions for working with Blockzooka. Not an active runtime plan. Not scheduled. Check planning.md before acting on it. Register: [notes register](docs/notes-register.md).

Status: design context and cautions. Not an active runtime plan.

Canonical planning starts at [planning.md](planning.md). Canonical architecture
starts at [architecture.md](architecture.md). This note extends
[blockzooka-writeup.md](blockzooka-writeup.md) (earlier functional summary) and
feeds the future shared-moderation work in
[quora-labeler-bridge.md](quora-labeler-bridge.md) and
[shared-moderation-design-mb-development-post-2026-05-18.txt](shared-moderation-design-mb-development-post-2026-05-18.txt).

Source reviewed: a shallow clone of the public `brettlwilliams/QuoraBlockzooka`
repo (commit `c00acbc`), read only. Files: `README.md`, `bookmarklet/`
(install page and six bookmarklets), `agent/quora_watch.md`,
`agent/quora_guys.md`, `agent/scan_settings.json`, and two GitHub Pages
workflows. The red, yellow, and green lists and the `hidden_files/` records are
not in the repo.

## What Blockzooka is

Two layers:

1. **Bookmarklets** (`bookmarklet/bookmarklet.html`): batch blocker, single
   Block, Followers List, Contributors List, Extract Space Reports, and Space
   Mute. These are DOM-scripted collection and action tools. They overlap with
   mute-block's existing Open Profiles and Nuke 'Em flows.
2. **Agent rules** (`agent/`): a classification rubric for an AI browser agent
   with Red / Yellow / Green verdicts, Space categories, sweep waves, caps,
   and reporting. This is the part with design value.

## Mapping onto mute-block

| Blockzooka concept | mute-block counterpart | Notes |
| --- | --- | --- |
| Red Space (farm; muted; roster blocked; never revisited) | `target` space category (`shared/js/spaceRegistry.js`; "Consider this space hostile" in `shared/js/content.js:6711`) | Closest fit. Check whether `target` should also mean "never revisit". |
| Green Space (never swept) | `neutral` (to be confirmed) | Blockzooka's Green is an explicit exclusion from sweeps. |
| Source Space (swept for leads) | none | A lead-source concept mute-block does not model. Could be a future category, not a reuse of `asset`. Check `asset` semantics first. |
| Red / Yellow / Green profile verdict | shared-moderation journal evidence (`shared/js/sharedModeration.js`) | Map Red to block recommendation, Yellow to warn or queue, Green to never act. Add confidence and a reason code. |
| Green profile, never re-checked | local protective list | Imports must not override a vetted profile. Matches the design draft's "evidence, not command authority" rule. |
| Pre-existing block, leave untouched | "already-blocked observations are not changes we made" (design draft) | Same rule, same implementation. |
| Canonical identity; never act on search-only URLs | `quora-profile:<name>` canonical IDs (design draft) | Importers should key on the canonical ID only. Unconfirmed matches become Yellow. |
| Assessment-only mode (global switch) | none | Worth adding for shared-list imports: classify and file without blocking. |
| Per-session block cap (100 in the rules, 50 in settings) | none | Mute-block has no session cap. Consider one, tunable in `shared/js/tunables.js`. |
| Waves: collect, assess, file, block, repeat | Profiles Per Batch and the queue | Existing batch design already does this. The explicit "never more than N ahead of blocking" bound is the useful part. |
| Farm fingerprint (Space-level heuristics) | none | Heuristics are prose today. Could become structured signals for a future classifier. |
| Guy archetypes (trait lists, "match most of") | none | Same: structure them as signal lists if a classifier is ever built. |

## What not to port

- **Named individuals.** The rules cite specific real Quora users as examples.
  Do not copy the examples into mute-block docs, fixtures, or shared journal
  posts. Use generic patterns instead.
- **CSAM example capture.** The rules store 1–3 snippets per profile in a
  local file until the owner is told. Do not replicate. Any handling of this
  material needs legal review first.
- **Automated Quora reporting.** Blockzooka reports spam and CSAM Reds after
  blocking, with a 12-hour pause on rate limits. Mute-block has no report flow.
  Adding one is an owner decision, not a port.
- **Bookmarklet DOM selectors.** They depend on `puppeteer_test_*` attributes
  that Quora can change without notice. Mute-block already has the more durable
  implementation of these flows.

## Cautions from the source

- **Config drift.** `agent/scan_settings.json` has a `note` field that
  contradicts its own values. `block_cap_suspended` is `true` while the note
  says the cap was lifted. `max_blocks_per_scan` is 50, while the rules text
  says 100 and the note mentions 200. Treat the numbers in that repo as
  unreliable until the author confirms them.
- **Public repo.** The rules and examples are published, including named
  individuals. Mute-block should not depend on that repo's lists as a data
  source.

## Recommended follow-ups (none started)

1. Confirm `target` and `neutral` semantics against Blockzooka's Red and Green
   Space rules before mapping them.
2. Add an assessment-only mode and a per-session block cap to the shared-import
   design, not to shipped code yet.
3. Use the Red / Yellow / Green evidence shape, with confidence and reason code,
   in the journal schema.
4. Keep the Green protective list rule in the import path.
5. Owner decisions needed: whether to add any reporting flow, and whether CSAM
   handling is in scope at all.
