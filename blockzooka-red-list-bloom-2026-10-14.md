# Blockzooka Red-List Bloom Filter (received 2026-10-14)

> **Status: REFERENCE** (24 Oct 2026). Captured note from the Blockzooka author (14 Oct) on a red-list Bloom filter. Confirm any hit against the authoritative list. Reference or dated data. Check before relying on its numbers. Register: [notes register](docs/notes-register.md).

Status: reference capture of a note from the Blockzooka author (Brett Williams,
via the forwarded message dated 2026-10-13). Not an active runtime plan. The
secret gist link is kept in the owner's memory, not in this repo.

Related: [blockzooka-synergy-2026-10-12.md](blockzooka-synergy-2026-10-12.md)
(design context) and [blockzooka-writeup.md](blockzooka-writeup.md).

## What it is

A Bloom filter over the 2,467 red-listed Quora profile URLs, published as a
secret GitHub gist with two files:

- `red_list_bloom.json`: the filter (about 4.4 KB) plus metadata.
- `check_bloom.py`: a standard-library Python checker.

Answers:

- **NOT-LISTED**: definitely not on the red list.
- **PROBABLY-LISTED**: probably on the red list. False-positive rate is about
  0.1% (about 1 in 1,000). Confirm any hit against the authoritative list before
  acting on it.

Privacy claim from the author: the filter cannot be used to dump the list. The
claim is about enumeration only. Anyone who guesses a specific profile URL can
test that one URL, so guessable slugs remain testable.

Snapshot: the filter reflects the red list as of 2026-10-13. The author rebuilds
it from scratch when the list changes and updates the gist at the same URL.
Consumers should re-download the JSON periodically.

## Checking a URL

Python 3, no installs:

    python3 check_bloom.py red_list_bloom.json "https://www.quora.com/profile/Some-Name-123"

Multiple URLs can be passed in one call.

## Algorithm (for implementing elsewhere)

1. Canonicalize exactly as the filter was built: strip whitespace, strip any
   `#fragment`, strip trailing slashes. Do **not** lowercase, because Quora
   slugs are case-sensitive.
2. Base64-decode `filter_base64` into a byte array. Read `m_bits` (m) and
   `k_hashes` (k) from the JSON.
3. For i in 0..k-1, bit index =
   `(SHA256("quora-bloom-v1:" + url) + i * SHA256("quora-bloom-v1:2:" + url)) mod m`.
   Read the SHA-256 digests as big-endian integers, and use integer addition on
   the full 256-bit values.
4. All k bits set: probably listed. Any bit clear: definitely not listed.

## Notes for mute-block

- The hash input is the full canonical URL string (`https://www.quora.com/profile/...`),
  not our `quora-profile:<name>` canonical ID. Any mute-block use needs a
  deterministic URL-to-string mapping that matches the author's canonicalization
  exactly, or every lookup will silently return NOT-LISTED.
- A positive is a candidate, not a verdict. Per the synergy note, an unconfirmed
  match maps to Yellow (warn or queue), not Red (block).
- Because the snapshot is dated and the author rebuilds it, any local copy needs
  a version or date check, and must not override a vetted local Green profile
  (synergy note: imports are evidence, not command authority).
- Once the author ships it, verify the algorithm against `check_bloom.py` on a
  known listed URL (`Quert-5` per the author's example) and a known unlisted one
  before relying on it.

## Normalization comparison (2026-10-14)

Compared the author's canonicalization with `normalizeQuoraProfileHref` in
`shared/js/subject.js` (which runs `sanitizeProfileHrefSlug` first). Checked by
running both on sample URLs; no code changed.

Agreement: whitespace trim, `#fragment` removal, trailing-slash removal, no
lowercasing of the slug, and `/profile/` plus `www.quora.com` as the canonical
host and path (the author's examples use the same form).

Divergences that matter for the Bloom lookup:

1. **Query strings.** The author's rules keep `?share=...`; ours drops the query.
   Ours is more forgiving, but only correct if the red list was built from clean
   URLs. Ask Brett whether any list entries carry a query.
2. **Suffix cutting (a real bug).** `sanitizeProfileHrefSlug` cuts slugs at
   tracking and descriptive tokens such as `-share-`, `-type-`, `-target-`,
   `-log`, `-followers`, and `-bio-details`. Real names are truncated:
   `Jane-Type-Smith-7` becomes `Jane`, `Mary-Log-12` becomes `Mary`,
   `Sam-Target-9` becomes `Sam`. Those are wrong canonical keys, not only
   Bloom mismatches. Fixing this touches every queue and dedupe key, so it is a
   discussion item, not a clear fix.
3. **Unicode.** Ours applies NFKC and percent-encodes the slug, so
   `René-Smith-1` becomes `Ren%C3%A9-Smith-1`. The author's example form is raw.
   Ask Brett which encoding the list uses. Until that is known, a non-ASCII
   lookup could return NOT-LISTED when the entry is present.
4. **Case.** Known and intended: slugs are case-sensitive on both sides, so
   `QUERT-5` and `quert-5` do not match a listed `Quert-5`. No change needed.

Open questions for Brett: query handling and percent-encoding versus raw Unicode.
