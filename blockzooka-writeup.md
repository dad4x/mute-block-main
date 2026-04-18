# Blockzooka Write-Up

This is a functional summary of what "Blockzooka" appears to be, based on:

- the saved Quora pages in `/home/dbrower/src/blockzooka`
- the GitHub repo `https://github.com/brettlwilliams/QuoraBlockzooka`

## Current Status

This note should be read as a collaboration memo

Current repo reality:

- `mute-block-main` already ships extension-native execution on current Quora pages
- Blockzooka still looks valuable as a source of workflow knowledge, collection heuristics, and operator experience
- there is no direct import bridge today between Blockzooka outputs and the extension
- the Firefox store release for `mute-block-main` is currently stuck on `1.2`, so collaboration assumptions should be based on the source tree and local builds, not Firefox distribution parity

## Short Version

Blockzooka is not one thing.

It is a loose workflow made of three parts:

1. identify bad-pattern content or users
2. extract or collect profile URLs
3. act on those URLs with blocking or reporting automation

The Google Sheet referenced in the Quora post does not look like a shared list of accounts to block. It looks like a shared `HighlightThis` pattern list used to visually mark bad-pattern text on Quora pages.

The GitHub repo is the action toolkit: bookmarklets and small scripts that scrape profile links, block a profile, batch-block pasted profile URLs, mute spaces, and mass-report content.

## What The Saved Quora Pages Suggest

### 1. `Bad Patterns to use for effective blocking`

This page is not the blocker itself. It is the pattern-detection side.

From the saved page:

- it explicitly says the author uses `HighlightThis`
- it says "If you want to use the list, use these settings"
- it says to choose `Google Sheets`
- it gives a Sheets ID:

`1L1VXJ4Ekp7BRMWnzNMbyHSGycn5ht2MsUpdpXdpHvvA`

That implies a shared sheet feeding `HighlightThis`, so Quora pages can visually highlight text patterns of interest.

The most likely sheet URL is:

`https://docs.google.com/spreadsheets/d/1L1VXJ4Ekp7BRMWnzNMbyHSGycn5ht2MsUpdpXdpHvvA`

What this appears to be for:

- highlighting suspicious phrases or "bad patterns"
- making problematic content easier for a human to spot

What it does not appear to be for:

- storing profile URLs as a block queue
- directly driving the blocking automation

### 2. `The Blockzooka`

The Quora "Blockzooka" material looks like a hub page describing a moderation/curation workflow.

From the saved pages and metadata:

- there is a main "The Blockzooka" page
- there is a `Pt 2` page about `/q_scrape_reported`
- the descriptions refer to HARPA automation such as `/qblock` and `/q_scrape_reported`

That suggests the Quora posts describe an operational process:

- find targets
- scrape or collect their profile links
- run automation against them

## What The GitHub Repo Actually Contains

Repo:

`https://github.com/brettlwilliams/QuoraBlockzooka`

This repo is real code, but it is not a centralized block database. It is a set of browser-side utilities.

### Main tools in the repo

- `followerslist.js`
  extracts profile links from a user's followers popup
- `contributorslist.js`
  extracts profile links from a space contributors popup
- `extractSpaceReports.js`
  scrapes profile links from a Quora space feed/report context
- `block.js`
  blocks the currently open profile
- `theBlockzooka.js`
  accepts pasted profile URLs and batch-blocks them
- `spacemute.js`
  mutes a space
- `massReport_q.js`
  mass-reports items on a profile questions page
- `massreport_a.js`
  mass-reports items on a profile answers page
- `harpa/block.js`
  a HARPA custom JS step that blocks the currently open profile

### Important behavioral detail

The batch blocker does not fetch from Google Sheets.

`theBlockzooka.js` presents a textarea and expects pasted `/profile/` URLs. It then:

- limits the list
- opens each profile in a popup
- skips already blocked users
- skips users who follow you
- clicks the Quora block flow
- throttles itself with randomized delays

So the repo is the execution machinery, not the shared intelligence source.

## Implied End-To-End Workflow

The best interpretation of the whole system is this:

### Phase 1: Pattern detection

Use `HighlightThis` with the shared Google Sheet to visually flag bad-pattern language on Quora pages.

Purpose:

- help a human recognize likely nuisance, spam, or hostile accounts faster

### Phase 2: Target collection

Collect actual profile URLs from places where target accounts cluster.

Examples from the repo and Quora notes:

- followers lists
- contributors lists
- report spaces / space feeds
- manually observed profiles
- HARPA or bookmarklet scraping flows such as `/q_scrape_reported`

Output of this phase:

- a plain list of Quora profile URLs

### Phase 3: Action

Feed those URLs into an action tool.

Examples:

- run `block.js` or `harpa/block.js` on one open profile
- paste many profile URLs into `theBlockzooka.js` for batch blocking
- run `spacemute.js` on a space
- run mass-report tools on questions or answers pages

## Where The Google Sheet Fits

The sheet appears to be upstream of blocking, not the block action itself.

Most likely role:

- shared list of words, phrases, or other textual patterns for `HighlightThis`

Less likely role:

- a list of people to block

Why:

- the saved Quora page ties the sheet directly to `HighlightThis`
- the code repo expects pasted profile URLs, not a sheet fetch
- no sheet-reading logic was found in the repo

## Where HARPA Fits

HARPA appears to be one automation front-end in the broader workflow.

What is visible:

- the Quora posts reference HARPA flows like `/qblock` and `/q_scrape_reported`
- the repo contains `harpa/block.js`, which automates the block flow on the current profile page

What is not visible here:

- the full HARPA prompt library or orchestration logic

So HARPA is probably one way of executing parts of the workflow, but the repo we inspected is mostly bookmarklet-based.

## Relationship To `mute-block-main`

`mute-block-main` is a direct-action browser extension for Quora pages.

Conceptually:

- Blockzooka is a broader workflow for finding and processing targets
- `mute-block-main` is a focused productized tool for acting in-page

The overlap is the last mile:

- muting
- blocking
- jumping to log pages
- other small page-local actions

The difference is that Blockzooka also includes discovery and batch-processing ideas, while `mute-block-main` is centered on extension UI inside the page you are already viewing.

## How Blockzooka And `mute-block-main` Can Work Together

This is the practically useful part.

The two systems line up well if you treat them as different layers:

- Blockzooka finds or gathers targets
- `mute-block-main` performs safer in-page actions on the current Quora UI

### What already fits together now

#### 1. Shared discovery, extension-based execution

Blockzooka-style tools can gather profile URLs from:

- followers
- following
- contributors
- report spaces
- manually observed bad-pattern accounts

Then `mute-block-main` can be used when you actually visit the resulting profiles or question/log pages.

That means the workflow can already be:

1. use HighlightThis and other Blockzooka discovery methods to identify likely targets
2. open the target profiles
3. let `mute-block-main` provide the in-page actions:
   - `Mute Block`
   - `Close Tab`
   - `Original Poster on Log Page`
   - `Open Profiles`
   - `Nuke 'Em`

#### 2. `mute-block-main` already overlaps some Blockzooka collection flows

The extension is no longer just a single-profile action button.

It already has features that cover some of the same territory as Blockzooka:

- batch-opening discovered profiles via `Open Profiles`
- working from contributors / followers / following popups
- one-click bulk action via `Nuke 'Em`
- configurable batch size via `Profiles Per Batch`

So one reasonable interpretation is:

- Blockzooka repo = a practical bookmarklet/HARPA toolkit that mapped real moderation workflows early
- `mute-block-main` = an extension-native implementation of some overlapping operational ideas

#### 3. `mute-block-main` is likely better for the last mile

For current Quora, the extension approach has some advantages over bookmarklets and HARPA snippets:

- it is anchored to the current DOM continuously
- it can react to page changes and SPA navigation
- it can persist settings
- it can expose buttons in the page instead of requiring pasted scripts

In other words, once a target is on-screen, `mute-block-main` is probably the better control surface.

### Best combined workflow

The most sensible combined workflow is:

#### Stage A: find candidates

Use the Blockzooka pattern-discovery side:

- shared HighlightThis sheet
- Quora report-space scraping ideas
- contributor/follower/following discovery

#### Stage B: get them on-screen

Use either:

- Blockzooka link extraction tools to get profile URLs
- or `mute-block-main` popup-list actions to open profiles directly in batches

#### Stage C: act with the extension

Use `mute-block-main` for the actual Quora UI operations:

- mute + block on profile pages
- log-page jump / original-poster helpers on question pages
- bulk action from follower/following/contributor popups

That division of labor is clean:

- discovery and targeting upstream
- durable page-native action downstream

### Where the current gap is

The current gap is that Blockzooka and `mute-block-main` do not share a target queue.

Right now they are connected manually:

- Blockzooka extracts links
- a human opens or pastes them
- `mute-block-main` acts once those pages are visible

There is no evidence in the current extension of:

- importing a pasted URL list
- reading a sheet
- reading a shared block queue
- automatically consuming output from the Blockzooka repo

### The simplest useful integration to add later

If tighter integration were wanted, the lowest-friction options would be:

#### Option 1: clipboard handoff

Add a popup action in `mute-block-main` like:

- `Open Profiles From Clipboard`
- `Queue Profiles From Clipboard`

Then Blockzooka extractors could remain unchanged:

- scrape profile URLs
- copy them
- hand them to the extension

This is probably the cleanest bridge.

#### Option 2: paste box in the extension popup

Add a textarea to the extension popup that accepts newline-separated Quora profile URLs.

Then `mute-block-main` could:

- validate them
- open them in batches using the existing `profilesPerBatch` concept
- optionally auto-close after mute/block completes

This would make the extension a direct replacement for `theBlockzooka.js`.

#### Option 3: extension-native extraction

Move more of the Blockzooka discovery steps into the extension itself.

Examples:

- extract profile links from follower/following/contributor modals
- show them in an extension-managed queue
- support `Open`, `Nuke`, `Skip`, `Export`

Some of this is already partially present via `Open Profiles` and `Nuke 'Em`.

#### Option 4: shared local storage format

A more advanced option would be a local target queue stored in browser extension storage:

- discovered profiles enter a queue
- queue items get states such as `new`, `opened`, `muted`, `blocked`, `skipped`

That would unify discovery and action, but it is more machinery and probably not the first thing to build.

### Recommended direction

If the goal is practical utility rather than architecture purity, the best near-term model is:

- keep the Google Sheet only for pattern discovery
- keep any Blockzooka extraction logic that still works
- let `mute-block-main` own the actual Quora interaction layer
- if needed, add clipboard or paste-box import so the extension can consume extracted profile URLs directly

That would preserve the parts of Blockzooka that help find people, while letting the extension handle the more persistent page-native execution layer.

## Bottom Line

The cleanest mental model is:

- Google Sheet: shared pattern list for visual highlighting
- Quora Blockzooka pages: describe the moderation workflow
- GitHub QuoraBlockzooka repo: provides scrape/block/report bookmarklets and HARPA snippets
- `mute-block-main`: your extension-based version of some of the direct-action parts

So if you were expecting the sheet to be a shared repository of accounts to block, the evidence so far does not support that. It looks more like a shared repository of patterns used to find likely targets.

The useful synthesis is:

- let Blockzooka-style tools identify and gather candidates
- let `mute-block-main` handle the real Quora UI actions
- if they need tighter coupling, add a clipboard or paste-list bridge rather than trying to make the Google Sheet into a block queue

If collaboration happens, the friendliest accurate framing is:

- Blockzooka already did meaningful exploration of Quora moderation workflows
- `mute-block-main` can complement that work by offering a steadier extension surface for the final action step
- the best near-term collaboration point is probably exchanging heuristics and handoff formats, not trying to collapse both projects into one system immediately
