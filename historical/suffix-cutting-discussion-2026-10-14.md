# Profile slug suffixes: findings and rules

> **Status: HISTORICAL** (24 Oct 2026). Findings behind the identity rule (14 to 15 Oct). The rule itself is in architecture.md. Kept as a record. Do not implement from it. planning.md is the front door. Register: [notes register](../docs/notes-register.md).

We started with 1,715 slugs taken from reporting posts, and looked to see what normalization was needed to open the corresponding profiles. Of these, 282 have a suffix that the old cut would remove. The other 1,433 have none, and we did not open them.

Evidence as of 15 Oct 2026. Quora's rate limit stopped the bulk check, so some rows are still pending. No code or queue has changed.

## Findings

- **Suffixed slugs are not profiles.** All 96 checked returned Quora's 404 page after a redirect to a non-profile path. Four more are pending.
- **Stripping the closed set usually reaches the same profile.** The closed set is `-log`, `-share-N`, `-ch-N`, `-questions`, `-answers` and `-posts`. Of the 231 closed-set rows checked, 218 (94%) reach a profile whose canonical slug equals the stripped form exactly.
- **The rest of the closed set is not safe to strip blindly.** Eight stripped forms redirect on Quora to a different canonical slug (for example, `Katie-12553` lands on `Katy-2439`). Five return 404. The page does not show whether a redirect is the same person under a new name or a different person.
- **Prose-like tails do not strip reliably.** Of the 7 rows with prose-like tails, 3 reach the same profile, 2 redirect and 2 return 404.
- **A queued plain row matches its stripped form.** All 25 checked rows whose stripped form is already queued reach the same profile.
- **Sequential checks hit Quora's rate limit.** The check stopped with a 429 after 235 base checks, at about one request every 2.5 to 3 seconds.

## What works and what does not

| Approach | Evidence | Verdict |
| --- | --- | --- |
| Keep suffixed slugs as separate identities | 0 of 96 reach a profile | Does not work |
| Strip the closed set and use the stripped form | 218 of 231 reach the same profile | Works, if the landing is checked |
| Strip the closed set with no landing check | 13 of 231 act on another page or none | Does not work |
| Strip prose-like tails | 3 of 7 reach the same profile | Does not work |
| Collapse a suffixed row into its queued plain row | 25 of 25 match | Works |

## Why NFC, not NFKC

Unicode Normalization Form C (NFC, canonical composition) merges only sequences that are the same character written two ways, such as `é` as one character or as `e` plus a combining accent. Unicode Normalization Form KC (NFKC, compatibility composition) does that too, and also maps compatibility variants onto the plain characters they imitate. We used NFKC until 15 Oct and now use NFC.

Under NFKC, each spelling below takes the key of a plain name. These are the kind of spellings an impersonator uses. They are test strings, not queued rows.

| Spelling | NFC key (current) | NFKC key (old) | Plain key it would merge with |
| --- | --- | --- | --- |
| `Ｊａｎｅ-Smith-1` (fullwidth letters) | `Ｊａｎｅ-Smith-1` | `Jane-Smith-1` | `Jane-Smith-1` |
| `ﬁsher-22` (ligature) | `ﬁsher-22` | `fisher-22` | `fisher-22` |
| `Ⓐlice-3` (circled letter) | `Ⓐlice-3` | `Alice-3` | `Alice-3` |
| `Name²-4` (superscript digit) | `Name²-4` | `Name2-4` | `Name2-4` |

Under NFKC, one key would cover two profiles, so one queue row and one handled mark could stand in for both. NFC keeps them apart.

In the current queue, 17 of the 1,715 slugs contain non-ASCII characters. None changes under NFKC, so the choice changes no key today. Two are worth noting. `Ꝗuora-Prompt-Generator-1` starts with Ꝗ, a Latin Q with a stroke through its tail, which reads as "Quora". It has no compatibility mapping, so NFKC leaves it alone, and it is a separate key under both forms. `Hugh-Askew-҈Ø-1` carries a stray combining mark, which neither form removes.

Neither form catches a homoglyph, a character that looks like a plain one but is not. The exact rule keeps such a name apart, but it does not flag it. Flagging would need a separate check.

## Rules going forward (proposed)

1. **Identity is exact.** A profile is its normalized slug, compared case-sensitively in Unicode Normalization Form C (NFC), with the query and fragment dropped. No change.
2. **Strip only the closed set, and only as a candidate.** Remove `-log`, `-share-N`, `-ch-N`, `-questions`, `-answers` or `-posts` when forming the key. Do not strip prose-like tails.
3. **A candidate key is used only if Quora serves it at that exact slug.** A redirect to another slug, or a 404, means no action. The current code re-maps a queued row to the profile it lands on after a redirect, so this rule needs a code change.
4. **A suffixed row whose stripped form is already queued is dropped.** The plain row stays.
5. **A suffixed slug is never acted on as a profile.**

## One-time queue plan (provisional)

For the 282 suffixed rows, using the results so far:

- Rewrite to the stripped form: 194 rows.
- Drop as duplicates of a queued plain row: 33 rows (25 checked, 8 unchecked but dropped either way).
- Drop because the stripped form redirects to another slug: 10 rows.
- Drop because the stripped form returns 404: 7 rows.
- Hold for review: 2 prose-like rows that reach the same profile.
- Pending the remaining checks: 36 rows.

Rewriting and dropping rows changes the queue, so it needs the owner's go-ahead.

## Open

- 36 closed-set stripped forms still to check, and 4 suffix checks for the sample. Resume after a cooldown.
- Rule 3 needs a code change, which is a build, so it is the owner's call.
- Rules 2 to 5 and the one-time plan need the owner's approval.

## Questions for Brett

1. Does the red list store the URL as typed, or the canonical slug Quora serves? Ten stripped forms redirect to a different canonical slug, so a list keyed on typed URLs can name a different profile than the one a visitor reaches.
2. Do any entries carry a closed-set suffix (`-log`, `-share-N`, and so on)? Those forms are not profiles on Quora.
3. Do any entries carry a query string, such as `?share=...`? We drop queries; your rules keep them.
4. For non-ASCII names, is the hash input raw Unicode or percent-encoded? Do you apply Unicode normalization? We use Unicode Normalization Form C (NFC).
5. Could you send test vectors: two or three listed and two or three unlisted URLs, with the digests or first bit indices your build produces?

## Scope

- The extension does not use the Bloom filter. Nothing from it is acted on.
- Any future use would treat a hit as a candidate, not a block.
