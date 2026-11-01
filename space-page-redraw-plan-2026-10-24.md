# Space page: redraw plan (24 Oct 2026)

> **Status: NEAR** (24 Oct 2026). Four-stage plan for space-page redraws (24 Oct). Stage 1 is marked this build and may be in progress in another session. Owner to confirm. Agreed or in progress. Check planning.md for the order. Register: [notes register](docs/notes-register.md).

## Problem

Each redraw of the space page re-reads the feed: it finds the posts in view, reads their
text and links, re-measures positions, and rebuilds the counts and button lists. Redraws
happen on every scroll step, every mutation and every state reply, so the work repeats
constantly, and it grows with the number of posts the page has seen.

## What the page can know, and when

- **A post appears:** the page's change observer reports new elements in the feed. This is
  the reliable signal. A scan of the whole feed is not needed to learn about it.
- **A post is in view:** the position of the post, read when it is needed. Scrolling a short
  distance changes which posts are in view, but not which posts exist.
- **A profile's state changes:** the worker's answer changes (a run finishes, a row settles).
  Today the page asks again in rounds; the worker does not push per-profile changes.
- **The page's own actions:** clicks and nukes are known to the page.

## Stages

### Stage 1 (this build): reuse the last scan

A redraw reuses the last scan of the feed when nothing structural has changed, the view has
moved only a short way, and the scan is recent. A scan runs again when:

- a structural change happened (a post was added or removed),
- the view moved more than the band (1000 px down, 200 px up, inside the scan window),
- the last scan is older than the reuse limit (10 seconds), or
- the content root changed.

Redraws between those points only draw buttons for posts in view, as before.

Expected effect: scrolling no longer rereads the whole feed on every step. The cost of a
redraw falls to the work on the posts in view plus the counts.

### Stage 2: remember per-post answers

Remember each post's text and links once, keyed by its element, and update only the posts
that changed. Counts are adjusted when a post changes, not recounted.

### Stage 3: the worker pushes per-profile state

The page subscribes to state changes for the profiles it has seen, instead of asking again
in rounds. A slow fallback check remains while a run is active.

### Stage 4: redraw only what changed

Each redraw handles the posts whose state, visibility or content changed.

## Checks for each stage

- Source-level tests pin the new behaviour (the test files in `test/`).
- Counters in the Info report show redraw, scan and state-request counts on the live page.
- The owner checks the live page after each load: buttons on posts in view, counts, and speed.
