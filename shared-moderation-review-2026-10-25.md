# Shared Moderation: Review Of The Notional Ideas (25 Oct 2026)

> **Status: ROADMAP** (25 Oct 2026). Review of the 18 to 20 May shared-moderation notes against the code, the test scripts, the owner decisions, and [planning.md](planning.md). It changes no code and no existing note. The owner updates the notes; this is the input. Not scheduled. Check planning.md before acting on it. Register: [notes register](docs/notes-register.md).

## Bottom line

The pure model is sound and tested. The runtime design is not ready to build. The riskiest gap is Dead Hand: it lets imported journals create automatic queue work, and nothing yet defines who is trusted, what the caps are, or what each event does. Nothing needs to change in code now. Items 1 to 9 need owner decisions. Items 10 to 16 can be fixed in the notes or in unwired code.

## What was read

The publication design, the implementation plan, the integration steps, the runtime boundary handoff, the test plan, the two live test plans, the live operation outline, the development-post draft, and the shared-moderation section of the 2.0 release summary. Checked against `shared/js/sharedModeration.js`, the `npm test` script, the parallel test runner, the identity code, [architecture.md](architecture.md), [docs/dead-ends.md](docs/dead-ends.md), and [planning.md](planning.md).

## The ideas, in brief

- **Principle.** A shared post is evidence and a recommendation, never a command. Local policy and the user decide.
- **Publication.** A readable Quora Space post with a JSON appendix. It lists only changes this browser made: profile block and mute, added or removed, and Space classification.
- **Export.** Once a day, if the count is at or above a threshold (the design says about 10 events). Manual Publish Now overrides. An event counts as exported only after the post is re-read and checked.
- **Import.** External journals go to a review inbox. Imported Space classifications go to a recommendation inbox. A journal from the same Quora account is never acted on.
- **Modes per Space.** Manual (the user starts action), Reviewed (candidates go to review), Dead Hand (trusted signals create queue work automatically, under caps).
- **Roaming profile.** Browser-agnostic, same-account settings in a public post, found through a pinned pointer post.
- **Portability.** The schema is meant to map later onto ATproto labels and lists. ATproto privacy is deferred.

## Where it stands (checked 25 Oct)

- **Built, not wired.** The pure model in `shared/js/sharedModeration.js`: parsing, validation, the two inbox reducers, the export threshold and posted-proof checks, and a label-policy resolver. No extension file imports it. The Firefox dev tool and the tests do.
- **Tested.** `test/sharedModeration.test.js`: 27 ok, 0 failing. `test/sharedModerationFuzz.test.js`: 2 ok, 0 failing. Both are in the `npm test` script and the parallel runner.
- **Fixtures.** The validator checks 18 fixtures: 11 expected valid, 7 expected invalid. All match. Some are described as "Quora-rendered"; the notes do not say where they came from.
- **Not built.** Everything at runtime: the mode UI, the registry change, the mutation outbox, the scheduler, the composer export, the import review screen, and the roaming profile.

## Decisions needed before any runtime build

1. **Dead Hand is undefined.** It lets "trusted" imported or local signals create queue work automatically, "under caps". Neither term is defined, in the notes or in the code. No table says what each imported event does in each mode. This is the one path where another user's journal can start an automatic block in your browser. Needed: what makes a source trusted; numeric caps; an event-by-mode action table. The owner's whitelist decision applies here too: every automatic block checks the whitelist (owner, 25 Oct; see [planning.md](planning.md), Roadmap).

2. **The publisher is a claim inside the post.** Whether an import is self or external, and the record it creates, both come from the `publisher` field in the journal text. Anyone can write that field. Neither the design nor the code checks it against the author Quora shows for the post. Needed: decide the trust anchor (the Space subscription, the post's author on the page, or both). Check how Quora shows post authors in Spaces; that has not been checked here.

3. **The pointer post breaks the append-only rule.** The core principles say posts are append-only, with no edits or updates "required or desired". The roaming section makes the pointer post an edited post, on purpose. The transport section asks to avoid edit and update churn, to reduce Quora terms risk. Needed: accept an edited pointer as a named exception, and check that Quora allows pinning and editing a post; or find another way to locate the current profile.

4. **An imported removal has no defined meaning.** A remove (pardon) event from another journal enters the review inbox in the same shape as an add. The design does not say what a subscriber does with it. Needed: a rule, with no action as the default.

5. **Composer automation is undecided.** The export worker drives Quora's post composer. That is a new kind of automated write to a third-party site. The dead-ends list covers only the private block-and-mute API (entry I5). Needed: an explicit owner call on composer automation, with its own setting and kill switch, before the export worker is built.

6. **The daily timer may not survive.** [planning.md](planning.md), loose end 37, records that a service-worker timer did not survive a restart in the 21 Oct probe. The design says a failed day waits for the next scheduled day. It says nothing about a missed day. Needed: a missed-day rule, and the dedicated-Worker decision (loose end 37) before the scheduler is built.

7. **Settled in the design, open in the draft.** The design states as settled: transparent publication, the "Dead Hand" name, and manual approval of imported recommendations. The public draft asks for comment on the mode levels, the approval rule, and the transparency choice. Needed: the owner decides each, and the draft and the design match.

8. **Three first steps, three gates.** The implementation plan says start with Package B: the registry and content-page UI, which names `content.js` and `spaceRegistry.js`. The integration steps say Step 5 (the registry), after source ownership clears, and list those two files as off-limits. The live outline says start with Phase 1, a runtime parser that only observes. The gates named are "the active debug cycle is done", "source ownership is clear", and "queue authority is stable" ([planning.md](planning.md)). Needed: one gate and one first step.

9. **Dead Hand and 2.0.** The MVP definition in the implementation plan leaves Dead Hand out. The 2.0 summary says users should be able to export and import blocks, and gives fallback wording if the UI is not finished. It does not say Dead Hand is out. Needed: say so in the summary, or decide otherwise.

## Fixes that need no decision

10. **The subject normalizer trims.** It trims the subject and the slug (`normalizeProfileTransportSubject`). The identity rule in [architecture.md](architecture.md) says no trims. Nothing calls the module at runtime, so nothing changes today. It must not be wired as it is.

11. **The export threshold defaults to 1 in code** (`shouldExportPendingEvents`). The design says about 10. Match them before wiring.

12. **The boundary handoff names the service worker as the runtime authority.** The 20 Oct decision moves the write door to a dedicated Worker (unmerged; [planning.md](planning.md), loose end 37). Reword to "the write authority" and name both options.

13. **The integration steps are stale on tests.** They say the shared-moderation tests are not in `npm test`. They are, in the package script and the parallel runner. Step 4's wiring item is done.

14. **Two words for one thing.** The design calls local storage "a cache". Architecture calls queue storage the durable authority. Use one.

15. **A label policy with no design.** `resolveLabelPolicyAction` maps imported labels to actions. The design has no label policy, and the labeler notes say "No decision". Keep it unwired, and call it ATproto groundwork.

16. **An observation with no record.** The design says Quora's transport constraints were "already observed". No capture is recorded. The fixtures described as "Quora-rendered" have no recorded source. The 2.0 summary states the same facts as design direction. Record the source, or mark them as assumed until the live check.

## Check live before the notes claim these

- Quora pins a post in a Space, and lets the owner edit it (item 3).
- Quora shows the post author for Space posts (item 2).
- Quora keeps parseable JSON between the markers, with the blank-line and link rewriting the design describes (item 16).
- Any live step waits for the owner's go. The live plans include one controlled publish and one controlled queue action.

## Suggested next nibble

- **A. Doc-only, safe lane.** Fix items 8, 12, 13 and 14, and record one gate and one first step. No code, no build.
- **B. Unwired code, decided rules only.** Remove the subject trims and match the threshold default to the design (items 10 and 11), with tests. Nothing shipped changes, so no build.
- **C. Not yet.** Anything at runtime: the registry, the UI, the scheduler, the composer. Wait for items 1 to 7.

Recommendation: A, then B. C waits for the owner's decisions.

## Sources

- [shared-moderation-publication-design-2026-05-18.md](shared-moderation-publication-design-2026-05-18.md)
- [shared-moderation-publication-implementation-plan-2026-05-18.md](shared-moderation-publication-implementation-plan-2026-05-18.md)
- [shared-moderation-integration-steps-2026-05-19.md](shared-moderation-integration-steps-2026-05-19.md)
- [shared-moderation-runtime-boundary-handoff-2026-05-20.md](shared-moderation-runtime-boundary-handoff-2026-05-20.md)
- [shared-moderation-test-plan-2026-05-20.md](shared-moderation-test-plan-2026-05-20.md)
- [shared-moderation-live-operation-test-outline-2026-05-20.md](shared-moderation-live-operation-test-outline-2026-05-20.md)
- [shared-moderation-live-quora-test-plan-2026-05-20.md](shared-moderation-live-quora-test-plan-2026-05-20.md)
- [shared-moderation-design-mb-development-post-2026-05-18.txt](shared-moderation-design-mb-development-post-2026-05-18.txt)
- [release-summary-1.6-aka-2.0.md](release-summary-1.6-aka-2.0.md)
