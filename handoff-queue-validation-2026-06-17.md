# Queue Validation Handoff - 2026-06-17

## Objective

Reach a live 300-element queue run with all rows successful and zero soft-fail counters/events.

Current state is not complete. The latest live work improved queue draining, but the gate is not clean and the candidate ingestion path needs cleanup before scaling.

## Current Build State

- Local repo version: `1.6.1001`.
- Live dev extension was synced and reloaded to `1.6.1001`.
- Live extension ID: `bklhndemdhkokhagmpmjnhppdcmmkggc`.
- Reload result: enabled, manifest errors `0`, runtime errors `0`.
- Local artifacts built:
  - `chrome/mute_block-1.6.1001.zip`
  - `firefox/mute_block-1.6.1001.zip`
- No commit or tag has been created for this state.

## Relevant Code Changes In 1.6.1001

Worker patch in `shared/js/sw.js` addressed:

- Duplicate same-profile queued tabs being preserved after a reclaimable tab was selected.
- Stale queued-action prune failing to refill from durable queued rows.
- Pause containment gaps where stale scheduled/rearm work could still open profile tabs after pause.
- Pause/rearm paths now re-check pause before fill-capable work.

Worker validation reported this passed:

```bash
timeout 60 node --check shared/js/sw.js
```

## Live Gate Results

The original 24-row gate drained under `1.6.1001`, but was not clean:

- Dashboard final split: `17 succeeded`, `4 soft-fail`, `3 hard-fail`.
- Queue recovered/WAL final split: `17 succeeded`, `7 failed`.
- Runtime after drain: `0 queued`, `0 active`, no profile tabs.
- Extension errors: none.

A failure-only retry gate later drained to:

- `21 succeeded`
- `3 failed`
- `0 queued`
- `0 active`
- `0 soft-fail`
- `3 hard-fail`
- `0` profile tabs
- extension errors: none

Remaining failures from that retry:

- `David-Brower`: contaminated input, should not count as a valid target.
- `Sammie-Stevens-4`: executor enqueue returned without active/terminal/runtime surface.
- `Taumi-Conohan-1`: executor enqueue returned without active/terminal/runtime surface.

Do not scale to 300 until the legitimate repeated failures and candidate ingestion contamination are handled.

## David-Brower Provenance

`David-Brower` should never have been queued. It is contaminated candidate input, not a queue engine failure.

Worker provenance found:

- Source file: `tmp/quora-reporting-assets.json`
- Matching flattened input: `tmp/quora-reporting-assets.urls`
- Source space: `https://trollsgalore.quora.com/`
- Source title: `Trolls galore`
- Snippet: `David Brower , lives in Northern California`
- It was labeled as `kind:"asset"` and flattened into a reviewed input path.

Likely bug:

- The Quora space asset collector treated a poster/current-user/profile-link as an asset target.
- The flattened `reviewed-profile-list` / URL-file path hid that provenance and fed it as `targetProfileHref`.

Likely code areas:

- `shared/js/content.js` space candidate extraction around `getSpaceFeedPostCandidateProfileUrls()`.
- `tools/cdp/enqueue-visible-profile-search.js` URL-file mode, which relabels file-fed URLs as `reviewed-profile-list`.
- `shared/js/sw.js` accepted the resulting target; it did not invent the bad URL.

## User Direction

The user does not trust the flattened reviewed-list candidate path.

Future live validation should use only:

1. actual in-space candidate collection,
2. marking assets in the space UI,
3. the in-space `nuke em` button.

Do not use:

- `reviewed-profile-list` as a live validation source,
- `tools/cdp/enqueue-visible-profile-search.js --urls-file`,
- flattened files such as `tmp/quora-reporting-assets.urls` as queue input.

Treat `tmp/quora-reporting-assets.*` as diagnostic evidence only.

## Cleanup Attempt Status

Multiple workers were asked to disable the flattened URL-file enqueue path. None completed the edit.

Confirmed worker status:

- `tools/cdp/enqueue-visible-profile-search.js` still contains the original `--urls-file` / `readUrlsFile()` path.
- No cleanup patch landed.
- No validation for that cleanup ran.
- No shipped extension code changed for that cleanup.

The next agent should either implement this directly or assign a reliable worker with a very small scope:

- Disable `--urls-file` in `tools/cdp/enqueue-visible-profile-search.js`.
- Make attempts fail nonzero with a clear message: `flattened URL-file enqueue is disabled; use in-space collect candidates plus in-space nuke button`.
- Remove/update any help text in that file advertising `--urls-file`.
- Run:

```bash
node --check tools/cdp/enqueue-visible-profile-search.js
```

- Prove `--urls-file` fails before CDP connection.

No extension rebuild should be needed if only this tool changes.

## Recommended Next Steps

1. Disable the flattened URL-file enqueue path.
2. Patch the in-space collector to preserve role metadata and prevent poster/author/current-user/profile-card links from becoming asset targets.
3. Use only a real Quora space tab:
   - collect candidates in the space,
   - mark assets in that space,
   - run the in-space `nuke em` button.
4. Run a small in-space gate first.
5. If the small gate is clean, scale gradually toward 300.

Clean means:

- `0 queued`
- `0 active`
- all legitimate rows succeeded
- `0 soft-fail`
- `0 hard-fail`
- `0` profile tabs
- extension errors `0`

## Operational Notes

- Foreground agent should supervise and preserve context.
- Use workers for edits, builds, live CDP execution, and queue runs unless the user explicitly asks otherwise.
- Do not run Puppeteer.
- Use direct CDP helpers under `tools/cdp/`.
- Do not scale to 300 from the contaminated reviewed-list path.
