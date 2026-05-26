# Firefox BiDi Harness

This directory contains small Firefox WebDriver BiDi helpers for live browser
inspection. They are intentionally separate from `tools/cdp/`, because Firefox
BiDi is not Chrome DevTools Protocol.

## Non-Interference Rules

- Do not use Puppeteer.
- Default commands attach, inspect, and end the BiDi session cleanly.
- Read-only inspection should not install or reload the extension.
- Commands that mutate browser state, such as extension install, are separate
  explicit scripts.
- Always end the BiDi session. Firefox allows only one active BiDi session, and
  a killed controller can leave Firefox rejecting future `session.new` calls
  until the browser is restarted.
- Do not request an escalation grant for repo-local mock/Firefox harness work
  just because Firefox is involved. Use the repo's normal approved command
  path, such as `bash -lc 'tools/firefox-bidi/run-mock-smoke.sh'`, and treat
  wrapper or sandbox-looking failures as tooling friction first.

## Firefox Launch

A dedicated harness profile is preferred for local/mock development because it
does not disturb the real logged-in profile or another debug cycle:

```bash
tools/firefox-bidi/launch-dedicated-firefox.sh
```

By default this uses:

```text
/scratch/dbrower/mute-block-firefox-bidi-profile
```

The profile is persistent so it can keep local browser state across harness
runs, but it starts separate from the real Quora login. Override the profile,
port, binary, or start URL when needed:

```bash
MB_FIREFOX_PROFILE=/scratch/dbrower/mb-firefox-alt \
MB_FIREFOX_BIDI_PORT=9225 \
tools/firefox-bidi/launch-dedicated-firefox.sh http://127.0.0.1:8765/
```

For the real logged-in Firefox profile, the previously working launch shape was:

```bash
/bin/firefox --new-instance \
  --profile /home/dbrower/.mozilla/firefox/mdi1eijg.default \
  --remote-debugging-port 9224 \
  --remote-allow-hosts 127.0.0.1,localhost \
  about:blank
```

Expected terminal line:

```text
WebDriver BiDi listening on ws://127.0.0.1:9224
```

The harness defaults to:

```text
ws://127.0.0.1:9224/session
```

Override with:

```bash
MB_FIREFOX_BIDI_WS=ws://127.0.0.1:9224/session node tools/firefox-bidi/target-summary.js
```

or:

```bash
node tools/firefox-bidi/target-summary.js --host 127.0.0.1 --port 9224
```

## Commands

For local mock development, start the mock server in one shell:

```bash
node tools/mock-quora/server.js
```

Then start dedicated Firefox against it in another shell:

```bash
tools/firefox-bidi/launch-dedicated-firefox.sh http://127.0.0.1:8765/
```

```bash
node tools/firefox-bidi/target-summary.js
```

Creates a temporary BiDi session, lists top-level browsing contexts, gathers
page titles where possible, prints a compact JSON summary, and calls
`session.end`.

```bash
node tools/firefox-bidi/open-url.js http://127.0.0.1:8765/space/shared-blocks
```

Creates a new Firefox tab, navigates to the URL, waits for load completion, and
calls `session.end`.

```bash
node tools/firefox-bidi/mock-smoke.js
```

Runs a browser-level smoke against `tools/mock-quora/`: opens the shared-blocks
fixture, verifies the `MBLOCK` journal block and Quora-like selectors, drives
the mock composer, verifies the posted proof, and calls `session.end`.

```bash
node tools/firefox-bidi/extract-mblock.js http://127.0.0.1:8765/space/shared-blocks
```

Opens a URL, extracts rendered `MBLOCK:BEGIN v=N` / `MBLOCK:END` blocks from
visible page text, parses each JSON document, prints document ids and event
types, and calls `session.end`.

For a full local-only run that starts the mock server and a dedicated Firefox
profile, then cleans both up:

```bash
tools/firefox-bidi/run-mock-smoke.sh
```

This intentionally uses a dedicated profile and `127.0.0.1`; it does not open
real Quora.

```bash
node tools/firefox-bidi/install-extension.js
```

Creates a temporary BiDi session, installs the unpacked Firefox extension from
`firefox/`, prints the returned extension id data, and calls `session.end`.
This is intentionally not part of the read-only summary command.

For mock pages, first create a localhost-enabled temporary extension copy:

```bash
node tools/mock-quora/make-dev-firefox-extension.js
node tools/firefox-bidi/install-extension.js --path /tmp/mute-block-firefox-mock
```

That helper patches only the temporary copy under `/tmp`; production manifests
stay Quora-only.

## Known Caveats

- `/json/version` and `/json/list` are CDP endpoints and do not apply to
  Firefox BiDi.
- If `session.new` fails with a maximum-session error, another controller is
  already attached or a previous controller exited without `session.end`.
  Restart Firefox if no active controller should exist.
- Fresh Firefox or `web-ext` profiles usually do not preserve the trusted
  logged-in Quora session. Use the real profile only when live Quora behavior
  is the thing being tested.
- Real Quora is not expected to be useful on the corporate VM. Prefer
  `tools/mock-quora/` for local harness development.
