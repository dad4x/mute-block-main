# De-novo Code Review

- **Target:** `rc/1.6` at `330adcdd66d39fc2e3f3c666be0ac45de0d76f3c` (`330adcd`)
- **Review date:** 2026-11-01
- **Method:** Static review of the checked-out source and relevant queue/profile call paths. No tests were run.

## Findings

### [P1] Make profile slug normalization idempotent

**Location:** `shared/js/subject.js:28` (`sanitizeProfileHrefSlug`)

The new rule removes one trailing alphanumeric token when it follows a numeric token, but applying it again can remove another token. For example, `Name-1-2-3` normalizes to `Name-1-2` on the first pass and `Name-1` on a second pass.

The code normalizes already-normalized profile URLs in multiple paths. `getNormalizedProfileHrefList()` normalizes each input, then derives its identity key by normalizing that output again (`shared/js/content.js:5941-5942` via `getQuoraProfileSlugData()` at `5906`). Coordinator job construction also normalizes `targetProfileHref` (`shared/js/jobState.js:750`). As a result, duplicate detection and the durable queued target can disagree about which profile a repeated-numeric slug identifies. A queued mute/block action can therefore land on a different profile than the link selected. The new test for `Name-1-2-3` asserts only the first pass and misses this repeated-normalization case (`test/subject.test.js:158-161`).

Make the canonicalization idempotent, or keep the cleanup confined to raw input before a canonical profile URL is produced.

## Review notes

No other confirmed actionable findings were identified in this review. `git diff --check` reported only trailing whitespace in generated webpack wrapper comments in the Chrome and Firefox bundles.