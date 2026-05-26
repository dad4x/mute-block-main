# Raw Report Page Fixtures

These are saved Quora Space pages used as deterministic fixture source for
page-shape regression tests. They intentionally live under `test/fixtures/` so
test code does not depend on a top-level scratch capture directory.

## Current Gate

`node test/rawReportPages.test.js` inventories the saved pages and checks:

- the fixture directory is `test/fixtures/raw-report-pages`;
- the expected ten top-level `.html` captures are present;
- each capture still contains space-feed markers such as `TribeFeed`,
  `puppeteer_test_tribe_post_item_feed_story`, `q-click-wrapper`, and
  `post_timestamp`;
- each capture still exposes enough canonical Quora profile links to be useful
  for source-page and resolver tests;
- one known profile sample per capture is still canonicalized by
  `shared/js/subject.js`.

The helper for reuse is `test/lib/rawReportPages.js`.

## How To Extend

Use these captures as source material before inventing new page shapes.

Preferred next steps:

- extract small, scrubbed DOM snippets into separate fixtures for post root
  selection, source-post resolver classification, contributor row extraction,
  and message sender extraction;
- keep the full saved pages here as provenance for those smaller fixtures;
- add fixture expectations in code, not in live-browser timing checks;
- keep `npm test` browser-free and deterministic.

Do not add copied images, webpack bundles, or full saved-page asset directories
to new snippet fixtures unless a test explicitly needs them. The existing saved
asset directories are kept only because they arrived with the raw browser
captures and preserve their local provenance.
