# Mock Quora Fixtures

This is a localhost-only fixture server for Mute-Block browser harness work.
It is not a Quora replacement and does not prove live Quora behavior. It gives
the Firefox BiDi harness stable pages for development when the corporate VM
cannot usefully reach real Quora.

## Start

```bash
node tools/mock-quora/server.js
```

Default URL:

```text
http://127.0.0.1:8765/
```

Override the host or port:

```bash
MB_MOCK_QUORA_HOST=127.0.0.1 MB_MOCK_QUORA_PORT=8766 node tools/mock-quora/server.js
```

## Useful Pages

- `/` redirects to `/space/muteblockdevelopment`
- `/space/muteblockdevelopment` is a Quora-like development Space with a
  composer entry, visible post list, and Mute-Block-like category controls.
- `/space/shared-blocks` renders a shared moderation journal post containing an
  `MBLOCK:BEGIN v=1` block.
- `/composer` is a standalone composer/proof page.
- `/api/posts` returns posts created through the mock composer as JSON.

The pages deliberately include a few stable Quora-ish selectors used by prior
live-debug notes, such as:

- `.puppeteer_test_tribe_composer`
- `.post_timestamp`
- `.mb-ext_space-category-btn`

Mock Space pages also expose explicit metadata for future source hooks:

```html
<meta name="mute-block-mock-quora" content="space">
<meta name="mute-block-space-url" content="https://muteblockdevelopment.quora.com/">
<meta name="mute-block-space-slug" content="muteblockdevelopment">
```

Runtime source should use this metadata only through a localhost-only temporary
dev manifest or equivalent test gate. Production manifests stay Quora-only.

## Smoke Test

```bash
node tools/mock-quora/smoke.js
```

The smoke test starts the mock server on a separate port, checks the
development Space, checks the shared-blocks `MBLOCK` fixture, posts one mock
journal entry through `/api/posts`, verifies it renders, and then stops the
server.

## Firefox Harness

Start a dedicated Firefox profile against the mock server:

```bash
tools/firefox-bidi/launch-dedicated-firefox.sh http://127.0.0.1:8765/
```

Then inspect it:

```bash
node tools/firefox-bidi/target-summary.js
```

To create a temporary Firefox extension directory whose manifest also matches
localhost mock pages:

```bash
node tools/mock-quora/make-dev-firefox-extension.js
```

Default output:

```text
/tmp/mute-block-firefox-mock
```

This copies the generated `firefox/` directory and patches only the temporary
copy. It does not change production manifests or package artifacts.

With the mock server and dedicated Firefox running, the browser-level smoke is:

```bash
node tools/firefox-bidi/mock-smoke.js
```

That command opens mock pages through Firefox BiDi, verifies selectors and the
`MBLOCK` fixture, drives the mock composer, and verifies the posted proof is
visible. It does not start Firefox by itself.

## Boundary

This mock path is for repeatable local regression scaffolding. It cannot prove:

- Quora login/session state;
- Cloudflare behavior;
- real Quora composer selectors;
- whether Quora accepts or rewrites a real post.
