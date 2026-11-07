# Draft reply to Brett (not sent)

> **Status: HISTORICAL** (24 Oct 2026). Unsent draft reply to the Blockzooka author (14 Oct). Not sent. Kept as a record. Do not implement from it. planning.md is the front door. Register: [notes register](../docs/notes-register.md).

Subject: Re: Red-list Bloom filter — how to check a URL

Hi Brett,

Thanks for the Bloom filter and the write-up. We compared your canonicalization
rules against our own URL normalizer. The basics agree (trim whitespace, drop
the #fragment, drop trailing slashes, no lowercasing). Two points still need
an answer before we rely on the filter:

1. **Query strings.** Do any red-list entries include a query string, such as
   `?share=...`? Your rules keep the query, and ours drops it. If the list is
   built from clean profile URLs, both approaches give the same result, but we
   want to confirm that.

2. **Non-ASCII names.** Is the list built from raw Unicode, such as
   `https://www.quora.com/profile/René-Smith-1`, or from percent-encoded URLs,
   such as `.../Ren%C3%A9-Smith-1`? Our normalizer percent-encodes, so the
   answer decides whether lookups for non-ASCII profiles match.

If you can, a few test vectors would also help: two or three listed URLs and
two or three unlisted ones, with the SHA-256 digests or the first few bit
indices your build produces. That lets us check our implementation against
yours exactly, not just against the final verdict.

Thanks,
[name]
