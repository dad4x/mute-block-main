# De novo review 4: readiness for a live run — 15 Oct 2026

> **Status: HISTORICAL** (24 Oct 2026). De novo review 4 (15 Oct), readiness for a live run. Open items are carried in planning.md. Kept as a record. Do not implement from it. planning.md is the front door. Register: [notes register](../docs/notes-register.md).

Scope: the changes since review 3, read against the working tree. These are the settings type check, the dashboard timer, the removal in the clear, the no-strip suffix rule, the suffix shadow counter, the identity pins, and the test changes listed in [14-oct-review-3-reply.md](14-oct-review-3-reply.md). I also checked the code paths those changes sit on, where they decide which profile is blocked. The goal is a point where a live run gives useful evidence, so the review asks what has to be true before one.

No repo files were changed by this review. No build, version bump, commit, reload or live run was done.

## Verification

- `npm test`: 1,165 `ok`, 0 `not ok`, exit 0. This matches the reply.
- Settings type check: `isExtensionSettingValueValid` and `setExtensionSettingsRequested` ([sw.js:21743](../shared/js/sw.js:21743)) match the reply's description.
- Dashboard timer: `syncDebugRunStatusTimer` is the only place the poll starts or stops ([coordinator.js:592-598](../shared/js/coordinator.js:592)). The reply is right that the toggle no longer starts a timer on its own.
- Clear removal: `buildStoredWorkClearPlan(state = {})` takes no exclusion, and the last re-read pass rebuilds from the fresh read ([sw.js:26016](../shared/js/sw.js:26016), [sw.js:26065](../shared/js/sw.js:26065)).
- No-strip rule: `sanitizeProfileHrefSlug` now applies NFKC, drops the query and fragment, and trims trailing separators ([subject.js:20-25](../shared/js/subject.js:20)).

## Summary, highest priority first

1. **R4-1 (confirmed by a node run, high). The identity key folds fullwidth lookalikes onto the real profile.** NFKC runs inside the identity key. The fullwidth link `Ｃｅｓｃ-Fabregas-56` gives the key `Cesc-Fabregas-56`, which is the real profile's key. It is the same class as the case issue in R3-1, and the no-strip rule does not close it.
2. **R4-2 (confirmed in code, high for a live run). Name association can queue and nuke a different profile.** A post with no profile link takes a name from its title and matches nearby profile links by case-insensitive substring, at medium confidence. The nuke path accepts medium candidates without a further check.
3. **R4-3 (confirmed by a node run, low to medium). Trailing separators are trimmed from the identity key.** `Cesc-Fabregas-56-` and `Cesc-Fabregas-56` become the same key.
4. **R4-4 (likely, high for a live run). Past runs may have acted on cut-derived targets.** Under the old rule, a link such as `Jane-Type-Smith-7` was keyed and opened as `Jane`. The live run should not be the first time anyone checks what those runs did.
5. **R4-5 (confirmed, readiness). Nothing on the dashboard shows the new live signals.** The suffix shadow and the redirect mismatches are not on a card.
6. **R4-6 (likely, medium). Lookalike tests need a mode that does not click.** Without one, the first live test of a lookalike can block a real account.
7. **R4-7 (low). The page-data scan is exact, so a casing change makes a blocked profile look unblocked.** The consequence is a second click on a profile that is already blocked.

## Findings

### R4-1. NFKC in the identity key folds compatibility characters (confirmed, high)

**Evidence.** `sanitizeProfileHrefSlug` calls `normalize('NFKC')` on the slug ([subject.js:24](../shared/js/subject.js:24)). `normalizeQuoraProfileHref` then uses the result as the key. Run on the current code:

| Queued link | Key | Equal to the real profile's key? |
|---|---|---|
| `…/profile/Cesc-Fabregas-56` | `Cesc-Fabregas-56` | (the real profile) |
| `…/profile/Ｃｅｓｃ-Fabregas-56` (fullwidth C, e, s, c) | `Cesc-Fabregas-56` | yes |

**Why it matters.** The remap check, the worker's `complete` check and the queue keys all compare or key on this output. A fullwidth lookalike therefore compares equal to the real profile. If the page lands on the real profile, the check passes, and the tool acts on the real account. This is the case-shifting attack the owner named, through a different character class. The no-strip rule does not stop it, because NFKC still runs.

**Suggested fix.** Identity uses the decoded slug as written, with no NFKC. NFKC is for display only. Percent-decoding is an equivalence the server also applies, so it can stay. Add the table's fullwidth row as a test, asserting that its key differs from the real profile's.

### R4-2. Name association can queue and nuke a different profile (confirmed in code, high for a live run)

**Evidence.**
- When a post has no profile link, `getNearbyProfileUrlsForName` ([content.js:5893-5925](../shared/js/content.js:5893)) lowercases the name and keeps any nearby profile link whose link text or slug contains it. The match is a substring match, not an equality.
- The caller adds those links at medium confidence ([content.js:7599-7600](../shared/js/content.js:7599)).
- `getQueueableSpaceFeedEntryUrls` ([content.js:8038-8046](../shared/js/content.js:8038)) checks dedupe, pending, retry and remembered state, but not confidence. `nukeSpaceFeedEntries` uses it, so a medium candidate is queued and then nuked when the entry is nuked.

**Why it matters.** A title such as `Cesc Fabregas` can pull in `cesc-fabregas-share-56`, or any other profile whose slug or link text contains that name. The reply lists name association under "heuristics, leave as they are". This path decides which profile is blocked, so it is not a heuristic in that sense.

**Suggested fix (before a live run).** Use exact equality on the name, or require a per-candidate confirmation before the nuke, or keep medium name matches out of the nuke entirely. I have not checked whether the space-feed UI shows the evidence source for each candidate, so the confirmation option needs that check first.

### R4-3. Trailing separators are trimmed from the identity key (confirmed by a node run, low to medium)

`sanitizeProfileHrefSlug` ends with `value.replace(/[-_\s]+$/g, '')` ([subject.js:25](../shared/js/subject.js:25)). The run shows `Cesc-Fabregas-56-` and `Cesc-Fabregas-56` as the same key. Under the identity rule, a trailing separator is part of the slug as written. Remove the trim from identity; keep it for display if needed.

### R4-4. Past runs may have acted on cut-derived targets (likely, high for a live run)

**Evidence.** Under the old rule a link such as `Jane-Type-Smith-7` was keyed `Jane`. The reply's own section 4.7 says a queued tab opens the URL that its key normalises to, and that a run for `Jane-Type-Smith-7` opened and acted on `Jane`. That is from code reading, not a live check. The completed log stores the same cut keys, so the history cannot be re-read to recover the raw link.

**Why it matters.** Any block made under the old rule may have hit a different profile. The live run should not be the first time that is checked.

**Suggested action (owner).** Before the live run, compare the owner's Quora block list with the names of profiles blocked through the tool. Any blocked profile whose name is a cut prefix of a longer slug is a candidate for a wrong block. Unblock path: the worker's `unblock-unmute-profile` action and the content script's `unblockUnmuteProfile` ([content.js:13291](../shared/js/content.js:13291)) exist and can undo a block.

### R4-5. The new signals are not on any card (confirmed, readiness)

- `suffixShadow.*` is written only in `sw.js` ([sw.js:24232-24234](../shared/js/sw.js:24232)).
- The dashboard reads the queue wakeup metrics through generic helpers (`sumMetricCounters`, `formatMetricCounterDelta`, [coordinator.js:2439](../shared/js/coordinator.js:2439), [coordinator.js:2533](../shared/js/coordinator.js:2533)). The delta helper shows the first three non-zero keys only, and no card names the shadow or mismatch counters.
- The redirect mismatch ends a row through `ACTIVE_PROFILE_REDIRECT_MISMATCH` ([sw.js:35413](../shared/js/sw.js:35413)). I did not find a count of these on the dashboard.

**Suggested fix.** A small "live checks" card with: the number of redirect mismatch rows, the shadow counter by token, the supersession counters, and the claim-retry hits. Dev mode's "save flight recorder" button already downloads the in-memory journal, so the run can be captured as well.

### R4-6. Lookalike tests need a mode that does not click (likely, medium)

Testing a lookalike today means queuing it and letting the tab act. If the lookalike resolves to a real profile, the tool can block that profile. A dry-run mode would avoid that: the tab opens the link, reads the landed profile's key, records the verdict (match or mismatch), and stops before any block, mute or unblock click. The synergy note's assessment-only mode is the same idea. It needs a build, so it is the first build, and the first live run.

### R4-7. A casing change makes a blocked profile look unblocked (low)

The page-data scan now searches exactly ([content.js:4865](../shared/js/content.js:4865)). If Quora writes the profile path in a different casing from the URL, the scan misses the blocked marker and reports the profile as not blocked. The likely result is a second block click on a profile that is already blocked. Quora should answer that with "already blocked", so the consequence is small. Check it on one real page during the live run.

## Carried forward from the reply

- **R3-6, the completed-log read.** Measure first, as the reply says.
- **R3-3, sender roles.** Not a live-run blocker. The content script is our own code. Choose option C (document) for now, and option B after the eleven unknown senders are traced.
- **R3-5, the clear's removals.** The reply asks whether a late write from a moved attempt re-creates a removed row. On the milestone path it does not: a missing row is rejected as `missing-coordinator-item` ([sw.js:32769](../shared/js/sw.js:32769)). I have not checked the other writers.
- **Query.** Parked with Brett, as you asked.

## Live-run readiness

These are what I would want true before you say "live run".

**Decisions and changes**
1. R4-1: identity without NFKC. A code change, so a build.
2. R4-2: name association exact, or confirmed per candidate, or kept out of the nuke. A decision first.
3. R4-3: no trailing-separator trim in identity. A code change.
4. R4-4: the owner's check of past blocks against the cut prefixes. No build needed.
5. R4-6: the dry-run mode. A code change, and the first build.

**Instrumentation**
6. R4-5: the live-checks card, or the owner reads the counters from the metrics view by hand.

**Test matrix (dry run first, no clicks)**

Use profiles the owner chooses. Record each row before any block is allowed.

| Link | What to record | What it tests |
|---|---|---|
| Canonical profile link | landed key equals queued key; verdict match | the baseline |
| Lower-case link with a suffix, such as `…-share-56` | queued key, landed key, verdict | R3-1: the cut is gone, and a different landed profile is a mismatch |
| Fullwidth link to a real profile | queued key, landed key, verdict | R4-1: the key must differ from the real profile's |
| Link with a trailing hyphen | queued key, verdict | R4-3 |
| Post with a name in the title and no profile link | the candidates and the evidence for each | R4-2 |
| A link with a query | queued key (query dropped), verdict | the query decision |

**Capture after the run.** The metrics view, the flight recorder (dev mode's save button), and the mismatch rows.

**Safety.** Keep the queue paused until the dry run has been recorded. Run one link at a time. The unblock path is the rollback for a wrong block.

## Verified sound in the changes

- The settings type check rejects a value of the wrong type and keeps the rest, and `NaN` is rejected ([sw.js:21743](../shared/js/sw.js:21743)).
- The dashboard timer starts once and stops once ([coordinator.js:592-598](../shared/js/coordinator.js:592)).
- The clear's last pass rebuilds from the fresh read, with no exclusion, and the tab ids of removed rows go into `ownedTabIds` ([sw.js:26065](../shared/js/sw.js:26065)).
- The exact check on the landed href is in place on both sides (content and worker). Its limit is R4-1 and R4-3, not the comparison operator.

## Not verified

- Anything live: Quora's own handling of fullwidth, trailing-hyphen and suffixed links.
- Whether the space-feed UI shows the evidence for a name-association candidate (R4-2).
- Whether the suffix shadow counter keeps its key unchanged. The reply says so, and I did not re-read the whole function.
- The sender roles, the completed-log cost, and the late-write question in the clear, as above.
