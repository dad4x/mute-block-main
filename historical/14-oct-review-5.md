# De novo review 5: are we ready for a live run? — 15 Oct 2026

> **Status: HISTORICAL** (24 Oct 2026). De novo review 5 (15 Oct), readiness for a live run. Answered by the two response files. Kept as a record. Do not implement from it. planning.md is the front door. Register: [notes register](../docs/notes-register.md).

Scope: whether the review-4 changes, as they now stand in the working tree, leave a live run safe and useful. I read the code those changes sit on and the new test cases. The reply to review 4 is section 7 of [14-oct-review-3-reply.md](14-oct-review-3-reply.md).

Nothing was built, bumped, committed, reloaded or run live. I ran `npm test`, the lints and the review-2 filter. Those are tests, not builds.

## Verdict

Not ready for the full test matrix. Ready for one narrow live run, once the changes are built and the conditions under "Before any live run" hold.

- Canonical links only, for profiles the owner is willing to block. One link at a time, the queue paused between links, and the landed href read before each click.
- No profile search, and no lookalike links (fullwidth, case variant, suffixed, trailing hyphen), until R5-1 is decided and a dry run reads the page's own identity (R5-2).

The review-4 code changes are done and tested. Two gaps remain that the reply does not name. Profile search folds fullwidth lookalikes onto the real name. The landing check compares only the URL. Both matter for profile-search and lookalike tests.

## Verification

- `npm test`: 1,171 `ok`, 0 `not ok`, exit 0. A fresh run; the log is in the session scratchpad. This matches the reply.
- Lints `correctness`, `queue-boundary`, `block-classification`, `queue-storage-layering` and `no-outside-writes`: exit 0 each.
- `node test/swSynthetic.test.js "--filter=review-2"`: 15 `ok`, 0 `not ok`.
- No remaining reference under `shared/` to `getNearbyProfileUrlsForName`, `getProfileSlugText`, `getTrailingTitleNameCandidate` or `isLikelyTruncatedProfileIdentityKey`. The collector explains the name-branch removal at [content.js:7503-7504](../shared/js/content.js:7503).
- Identity is exact. NFC at [subject.js:26](../shared/js/subject.js:26) and [content.js:5547](../shared/js/content.js:5547). No trailing or whitespace trim in the sanitiser. The identity key is the decoded, NFC slug with no lower-casing ([content.js:5561-5567](../shared/js/content.js:5561)). The dedupe keeps every case variant and drops no prefix ([content.js:5569-5587](../shared/js/content.js:5569)).
- No dry-run code and no live-checks card exist yet. A grep for `dry-run` found only classification comments in `sw.js`.

## Findings

### R5-1. Profile search folds lookalikes onto the real name (high for any profile-search run)

**Evidence.** `normalizeProfileSearchMatchTokens` ([content.js:10425-10436](../shared/js/content.js:10425)) runs NFKD, strips accents, lower-cases, and splits on non-alphanumerics. `isProfileSearchHrefMatchForCurrentQuery` ([content.js:10455-10462](../shared/js/content.js:10455)) requires every query token to appear in the link's tokens. Run in node: the fullwidth link `Ｃｅｓｃ-Fabregas-56`, the ASCII `Cesc-Fabregas-56` and the query `Cesc Fabregas` each give the tokens `cesc` and `fabregas`. A lower-case `cesc-fabregas-share-56` also matches.

**Why it matters.** The batch nuke blocks every staged match, and the reply says that includes the real profile when it is in the results. This is the R4-1 class, in a path the reply leaves alone. The owner's decision, as recorded, is to leave the folded match as it is. The record does not say the fold covers fullwidth characters, so the owner should confirm that before the test.

**Suggested.** Keep profile search out of the first live run. If it is tested, collect only, read each staged href, and block one row at a time. Switching to exact, case-exact matching is a small code change, and the owner should decide it before a later run.

### R5-2. The landing check reads only the URL (high for lookalike tests)

**Evidence.** `getQueuedProfileRemapTarget` ([content.js:9158-9169](../shared/js/content.js:9158)) compares the normalised queued href with the normalised `location.href`. The worker's `complete` check ([swBootstrap.js:563-569](../shared/js/swBootstrap.js:563)) reads the tab's URL. Neither reads what the page says about its own profile.

**Why it matters.** NFC stops the tool from treating a fullwidth link as the real profile's key. It does not stop Quora from serving the real profile's page at a lookalike URL without redirecting. If that happens, both checks pass and the block acts on the real account. I could not check what Quora serves from here.

**Suggested.** Before any lookalike link is queued, the dry run must read the page's own profile identity and compare it with the queued key. The reply's design says the dry run reads "the landed profile's key", which could be read as the URL. The design should say the page. The first step is to find what one real profile page exposes: a canonical link, `og:url`, or page data.

### R5-3. Medium-confidence candidates are still queued and nuked (medium; owner awareness)

**Evidence.** `getQueueableSpaceFeedEntryUrls` ([content.js:7939-7948](../shared/js/content.js:7939)) has no confidence check. Two medium sources remain. Profile URLs in the post's text come from `text-profile-url` ([content.js:7482](../shared/js/content.js:7482), via `getProfileUrlsFromText` at [content.js:5607-5626](../shared/js/content.js:5607)). Slugs from the post's own URL come from `space-post-url-artifact` ([content.js:5700-5750](../shared/js/content.js:5700) and [content.js:7492-7499](../shared/js/content.js:7492)), medium when the slug has two or more tokens.

**Why it matters.** These are explicit profile links, not name guesses, and their identity is now exact, so R4-2 does not cover them. But "medium" still means queued and nuked. The owner should know that before the first candidate lists are read.

**Suggested.** No change is needed for a canonical-link run. Check the first candidate lists. Decide later whether medium explicit links need a confirmation step.

### R5-4. Name-less posts now go to the page resolver (medium; not traced here)

**Evidence.** A post with no profile link goes to the page resolver when it has a source page (`isQueueableSpaceFeedResolverEntry`, [content.js:7950-7959](../shared/js/content.js:7950)). The reply describes this in section 7, R4-2.

**Why it matters.** This path now runs in live use. I did not trace where the resolver's candidates come from. The question is whether they come from the post's own page or from a name match.

**Suggested.** Trace the resolver's candidate sources before a live run that includes name-less posts. If that is not done, check the first such posts by hand.

### R5-5. Two smaller points on the identity path (low)

- `getProfileUrlsFromText` strips trailing `[),.;:!?]` from a text URL before identity ([content.js:5616](../shared/js/content.js:5616)). This is prose punctuation, outside the R4-3 rule. It is harmless if slugs never end in those characters, which I have not checked.
- `getQuoraProfileSlugData` returns null when `decodeURIComponent` throws ([content.js:5556-5557](../shared/js/content.js:5556)), so a malformed link is dropped with no counter. That is the safe direction, but it leaves no trace.

### R5-6. The new signals are still not on a card (medium; open from R4-5)

`noteSuffixShadow` writes `suffixShadow.changed` and `suffixShadow.token.*` ([sw.js:24221-24234](../shared/js/sw.js:24221)). The dashboard has no card for them. A grep for `mismatch` or `redirect` in the coordinator files finds nothing, so redirect-mismatch rows are not counted on the dashboard either. The generic counter helpers show at most three non-zero keys ([coordinator.js:2533](../shared/js/coordinator.js:2533)). I did not confirm whether the metrics view lists every key.

**Suggested.** Build the small live-checks card with the first build. Until then, read the counters by hand before the run and confirm they appear.

### R5-7. The dry run is not built (open from R4-6; blocks lookalike tests)

The dry run exists as a design only. Until it does, do not queue lookalike links. R5-2 is the reason. The first step in the reply, tracing every path that starts a tab from `claimPendingTabAction`, is still ahead.

### R5-8. Other items still open

- **R4-4, the owner's past-block audit.** Not done. It is a precondition for any live run.
- **The build.** The review-4 changes are uncommitted and unbuilt. A live run needs a version bump and a build first.
- **Whitespace trim (reply, section 7).** I would leave it out. The owner's rule is "as written", and a trailing space changes the URL.

## Owner decisions

1. **Profile search.** Keep it out of the first live run (recommended), or make its match exact first.
2. **Dry run.** Read the page's own identity, not the URL (recommended).
3. **Medium explicit links.** Keep them queued and check the first lists (recommended for now).
4. **Whitespace.** Keep it untrimmed (recommended).
5. **When to build.** The owner's call.

## Before any live run

- The build, with a bumped version and the review-4 changes in it.
- The owner's past-block audit (R4-4).
- Profile search excluded (decision 1).
- Canonical links only, for profiles the owner is willing to block. One link at a time, the queue paused between links, and the landed href read before each click.
- The first candidate lists read, including name-less posts (R5-4) and any `Jane` / `Jane-7` pair.
- The counters read by hand, or the live-checks card in place (R5-6).

## Before any lookalike link

- The dry-run mode built, comparing the page's own identity with the queued key (R5-2, R5-7).
- One real profile page checked for what it exposes.
- R4-7, the page-data scan, checked on one real page.

## Verified sound

- Name association and its helpers are gone, with no references under `shared/`.
- The identity key and dedupe are case-exact, and a prefix does not drop a candidate. `Jane` and `Jane-7` both stay ([acceptedReviewChanges.test.js:475-524](../test/acceptedReviewChanges.test.js:475)).
- Fullwidth, composed and decomposed accents, and trailing separators are pinned in [subject.test.js:94-116](../test/subject.test.js:94).
- The remap check is exact on the URL ([content.js:9158-9169](../shared/js/content.js:9158)) and tested ([acceptedReviewChanges.test.js:401-406](../test/acceptedReviewChanges.test.js:401)).
- The text-URL check drops a link with an ellipsis ([content.js:5691-5693](../shared/js/content.js:5691)). That drops a link rather than renaming it, so it errs on the safe side.

## Not verified

- What Quora serves for fullwidth, trailing-hyphen, suffixed, lower-case or query links.
- Whether a profile page exposes the profile's own identity, and where.
- The resolver's candidate sources for name-less posts (R5-4).
- Anything live. The tests show that the code does what they say. They do not show what Quora does.
