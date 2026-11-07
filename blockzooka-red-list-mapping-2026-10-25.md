# Blockzooka Red List: Mapping To Our Reasons (25 Oct 2026)

> **Status: ROADMAP** (25 Oct 2026). Working list for the reason field, for owner decisions one row at a time. Planning only: no code, and nothing reads Blockzooka's list at runtime. The names come from two summaries of Blockzooka's public agent notes, which disagree (24 and 26 items; some wording differs). Check exact names against the raw file before any mapping is fixed. Register: [notes register](docs/notes-register.md).

## Rules agreed so far

- Our reason list is always a superset of Blockzooka's list (owner, 25 Oct). A Blockzooka name may map to one of ours by equivalence.
- One reason per Space, with a per-item override as a drop-down on the red mute-block button and on the mute-block-close button (owner, 25 Oct).
- The Asset button gets a dropdown for the Space's default reason, shown as Asset-<type> (owner, 25 Oct).
- The Target button gets the same default-reason dropdown as the Asset button (owner, 25 Oct).
- Some reasons are narrower than others. Plagiarist is a narrowing of Slop, and CatFish is narrower than Impersonation (owner, 25 Oct).
- The journal JSON may carry several categories per item, and a narrower category includes its broader one (owner, 25 Oct).
- RageBait is frequently political, as RWNJ and LWNJ are (owner, 25 Oct).
- Content farm is Bot, the owner thinks (tentative, 25 Oct).
- "Individual" means the author of the listing post, until we decide otherwise (owner, 25 Oct).
- Names are matched case-insensitively and spelled one consistent way. Human display may add spaces ("Rage bait"); constants do not ("RageBait") (owner, 25 Oct).
- We copy Blockzooka's names into our own list. We do not read its list at runtime (its note).
- Open: does the superset cover the red criteria and reports only, or the outcome labels too?

## Our reason list (owner, 25 Oct)

CSAM, Adult, Troll, Spam, CatFish, RWNJ, LWNJ, Scam, Impersonation, SockPuppet, Harassment, Hate (covers racist), Slop, Plagiarist, EngagementBait, RageBait, and Bot (tentative: content farm is Bot).

The owner's answers typed "Harrassment", then "harrassment". The name is recorded as "Harassment". Confirm the spelling before the name is fixed.

## Confirmed (owner, 25 Oct)

- "Sexual exploitation of minors" (a report category) is CSAM.
- "Troll account (zero-history provocateur)" is Troll.
- "Sexual abuse material" splits. Minors involved is CSAM. Adult material without minors is Adult (proposed; to confirm).
- Hate covers racist content.
- Threats and doxxing go to Harassment (spelling to confirm).
- Bot behaviour (clearly inauthentic) is SockPuppet.
- Extraction (off-platform contact solicitation) is Scam.
- Identity fraud is Impersonation. CatFish is narrower.
- Template-permutation question farm is Slop, with Plagiarist as a narrowing.
- CSAM stays in the list. Whether it is in scope for handling and publication is still open. The Blockzooka note asks for legal review.

## Rows

"In" shows which summary lists the name: A is the 26-item summary, B is the 24-item summary. Plagiarist has no Blockzooka name of its own; row 23 is its nearest source.

Content farm (tentative, owner): farm operators and farm nodes go to Bot; content quality goes to Slop; the engagement technique goes to EngagementBait. Rows 18 to 25 follow that split, with the alternatives shown.

| # | Blockzooka name | In | Proposed | Alternative | Status |
|---|---|---|---|---|---|
| 1 | Spam | A, B | Spam | — | Confirmed (exact) |
| 2 | Survey spam | A, B | Spam | — | Proposed |
| 3 | Bot-cadence question spam | A | Spam | — | Proposed |
| 4 | Extraction (off-platform contact solicitation) | A, B | Scam | — | Confirmed (owner, 25 Oct) |
| 5 | Clearly inauthentic / bot behavior | A, B | SockPuppet | — | Confirmed (owner, 25 Oct) |
| 6 | Identity fraud | A, B | Impersonation | CatFish is narrower, under Impersonation | Confirmed (owner, 25 Oct) |
| 7 | Romance-bait solicitation | A, B | CatFish | Scam | Proposed |
| 8 | Fabricated credentials + financial bait | A, B | Scam | CatFish | Proposed |
| 9 | Thin identity + bait content | A, B | CatFish | Scam | Proposed |
| 10 | Batch-created sock cluster | A, B | SockPuppet | — | Proposed |
| 11 | "Guys" sockpuppet-troll archetypes | A, B | SockPuppet | Troll | Proposed |
| 12 | Troll account (zero-history provocateur) | A, B | Troll | — | Confirmed |
| 13 | Clearly disruptive (harassment, hate, threats, doxxing) | A, B | Harassment for harassment, threats, and doxxing; Hate for hate | — | Confirmed (owner, 25 Oct; spelling to confirm) |
| 14 | Racist content | A, B | Hate | — | Confirmed (Hate covers racist) |
| 15 | Sexual exploitation of minors (report category) | B | CSAM | — | Confirmed |
| 16 | Sexual abuse material, minors involved | A, B | CSAM | — | Confirmed (split) |
| 17 | Sexual abuse material, adult violent, no minors | A, B | Adult | — | Proposed (to confirm) |
| 18 | AI-slop farming | A, B | Bot | Slop | Proposed |
| 19 | Formulaic engagement-bait farming | A, B | EngagementBait | Bot | Proposed |
| 20 | Content-farm operative | A, B | Bot | — | Proposed |
| 21 | Sentimental farm-slop | A, B | Slop | Bot | Proposed |
| 22 | Question-only farm node | A | Bot | Slop | Proposed |
| 23 | Template-permutation question farm | A | Slop, with Plagiarist as a narrowing | — | Confirmed (owner, 25 Oct) |
| 24 | Industrial engagement-bait question farm with self-owned Space sink | A, B | Bot | EngagementBait | Proposed |
| 25 | Sweet-persona engagement-farm node | A, B | EngagementBait | Bot | Proposed |
| 26 | Content-farm Space (a Space pattern) | B | The Space's default reason, not a profile reason | — | Owner decides which reason a farm Space carries |
| 27 | Red-Space association | A, B | A basis, not a reason | — | Owner decides |
| 28 | Formulaic admin/moderator (Red on participation) | A | A role basis, not a reason | — | Owner decides |
| 29 | Pre-existing block | A, B | An outcome (already blocked), not a reason | — | Proposed: exclude |
| 30 | Quora ban | B | An outcome, not a reason | — | Proposed: exclude |

## Political patterns (RWNJ, LWNJ)

No Blockzooka reason names RWNJ or LWNJ. The Space patterns that look political are "Political meme farm", "Conspiracy-recruitment hub", and "Racial-grievance recruitment Space" (first summary). Whether any of them maps to RWNJ or LWNJ is an owner decision. RageBait is frequently political too (owner), so RageBait and RWNJ or LWNJ may appear together. Our RWNJ, LWNJ, and RageBait names are our additions and need no Blockzooka mapping.

## Outcome and verdict labels (for discussion, 25 Oct)

Blockzooka uses labels besides reasons. Their exact names come from the same two summaries and need checking against the raw file. Our code already has outcomes: blocked, already blocked, profile unavailable, unresolved target, timeout, and failed.

- **Verdicts on a profile:** Red (blocked), Yellow (watch), and Green (known good). The Yellow indicators are thin identity, engagement bait, sockpuppet signals, and content-farm Space activity.
- **Space labels:** Red Spaces, Green Spaces (never swept), and Source Spaces (swept for leads). Our Space categories are asset, target, and neutral. The synergy note asks us to confirm target and neutral against these rules first.
- **Outcomes and states:** pre-existing blocked (a Red sub-category); Red (banned), with the Quora ban notice; Unverified URL (identity not confirmed); Unreportable (no content, a report outcome); Rate-limited report pause; Green from the owner following the profile (automatic Green); and Human-appearing admin or moderator (assessed on its own behaviour, never blocked on association alone).

Owner answers (25 Oct):

- Three separate fields (reason, verdict, outcome): undecided. The proposal stands: reason (why it was listed), verdict (Red, Yellow, Green), and outcome (what happened on Quora), kept apart. Reasons are the superset; verdicts and outcomes are not in the reason list.
- Green is the whitelist: probably (tentative). The code already reads whether the current user follows a profile, which is a possible Green signal.
- Verdicts and outcomes out of the journal: probably (tentative). The journal carries reasons and the mutation events we made.
- Quora ban notice: we don't track Quora bans, so there is nothing to publish or exclude. Revisit if we start tracking them.
- "Never blocked on association alone": not decided. The owner frequently blocks contributors to a space, which is association, so this rule does not match current practice.
- Space labels: confirmed. Red Spaces are target, Source Spaces are asset, and Green Spaces are neutral (owner, 25 Oct).

## Still open

- Harassment or Harrassment: which is the one consistent spelling? Recorded as Harassment for now.
- RageBait: frequently political (owner). Does it nest under EngagementBait?
- Bot: confirm rows 18, 20, 22, and 24 as Bot, and rows 19, 21, and 25 with their alternatives. Bot and SockPuppet need a boundary rule: bot behaviour is SockPuppet, and content farms are Bot.
- Does a narrower reason count as its parent in reports and publication, so that Plagiarist counts as Slop?
- Which reason a content-farm Space carries.
- RWNJ and LWNJ: do the political Space patterns map to either?
- Superset scope: reasons only (proposed), or the outcome labels too?
- CSAM: in scope for handling and publication?
- Three separate fields (reason, verdict, outcome): undecided.
- Association-based blocking (blocking contributors to a space, as the owner practises it): not decided. The Blockzooka rule against it is not adopted.

## Parked (owner, 25 Oct)

- Association as a basis, and confidence. The owner is not ready to go there yet. Confidence is part of Blockzooka's evidence shape (its synergy note). Row 27 stays a basis, not a reason, until this is discussed.

## Exact names

The two summaries disagree on count and wording. The fetch tool does not quote the file verbatim. Exact names need the raw text, either pasted into the chat from the red section of the repo's agent notes, or downloaded once to the scratch folder after the owner allows it.
