# Space Nuke BiDi Debugging Notes 2026-05-07

This note captures the working setup for live Firefox/Quora debugging from this checkout. It is meant as a reproducible handoff for a later Codex session.

## Context

- Repo: `/scratch/dbrower/home/src/mute-block-main`
- Work was outside ADE.
- Local instruction: run `skills-book` first.
- Extension source loaded for Firefox: `firefox/`
- Firefox default profile with the real Quora session: `/home/dbrower/.mozilla/firefox/mdi1eijg.default`
- System Chromium was not useful for this task:
  - `/bin/chromium-browser --version` reported `Chromium 94.0.4606.81 Fedora Project`.
  - Cloudflare/Quora challenge kept looping in Chromium, including a headed non-Puppeteer launch.
- Fresh Firefox/web-ext profiles were also not useful for Quora because they lacked the trusted logged-in session.

## Windows Chrome CDP Tunnel Setup

For Windows-laptop Chrome validation, run Chrome on the laptop with a local
Chrome DevTools Protocol port, then expose that local port back to this host
with an SSH reverse tunnel.

The two commands are independent:

- Start them in either order.
- Chrome can be closed and restarted without restarting the SSH tunnel.
- The tunnel can be closed and restarted without restarting Chrome.
- If the host-side port changes, use that new port in Codex/CDP probes.

### Start Chrome On The Windows Laptop

Use PowerShell's call operator (`&`). Without it, PowerShell parses the quoted
path as a string and treats the `--remote-debugging-port` argument as an
unexpected token.

One-line PowerShell command:

```powershell
& "C:\Program Files\Google\Chrome\Application\chrome.exe" --remote-debugging-address=127.0.0.1 --remote-debugging-port=9222 --user-data-dir="$env:TEMP\mb-chrome-debug" --new-window "about:blank"
```

Readable PowerShell form:

```powershell
& "C:\Program Files\Google\Chrome\Application\chrome.exe" `
  --remote-debugging-address=127.0.0.1 `
  --remote-debugging-port=9222 `
  --user-data-dir="$env:TEMP\mb-chrome-debug" `
  --new-window "about:blank"
```

This uses a separate debug profile under `%TEMP%\mb-chrome-debug`; load the
unpacked extension from:

```text
C:\Users\DBROWER\Documents\src\mute-block-main\chrome
```

### Start The CDP Reverse SSH Tunnel From Cygwin

Run this from a Cygwin shell on the Windows laptop, leaving the SSH session
open. PowerShell OpenSSH may also work, but the current tested laptop setup is
Cygwin SSH.

```bash
ssh -N -o ExitOnForwardFailure=yes -o ServerAliveInterval=30 -R 9223:127.0.0.1:9222 dbrower@phoenix92608.dev3sub2phx.databasede3phx.oraclevcn.com
```

Meaning:

- Windows Chrome listens on laptop-local `127.0.0.1:9222`.
- SSH exposes it on this host as `127.0.0.1:9223`.
- Codex probes Chrome from this host at `http://127.0.0.1:9223/json/version`
  and `http://127.0.0.1:9223/json/list`.

When probing from this host, bypass proxy settings for localhost:

```bash
curl --noproxy '*' --max-time 3 -sS http://127.0.0.1:9223/json/version
curl --noproxy '*' --max-time 3 -sS http://127.0.0.1:9223/json/list
```

Use direct Chrome DevTools Protocol for this Windows Chrome path. The useful
control surface is the CDP HTTP/WebSocket endpoint exposed through the SSH
reverse tunnel; do not route this setup through Puppeteer unless there is a
specific new reason to test Puppeteer's attach behavior. Keep CDP probes
bounded with short timeouts so a page alert or stalled target does not leave a
controller process hanging.

CDP operating rule: use API calls for inspection and setup, but mostly use real
CDP mouse events for driving Quora/extension UI. `Runtime.evaluate`,
`chrome.storage.local`, and `chrome.developerPrivate` are fine for reading
state, marking known test spaces as assets, clearing extension errors, and
reloading the unpacked extension. For user actions like `Nuke 'Em`, prefer
`Page.bringToFront` plus `Input.dispatchMouseEvent` against button coordinates.
Plain DOM `button.click()` and background-tab mouse dispatches can report
success while failing to reach the extension's real interaction path.

The Q Defense Crew `.63`/`.64` live tab showed two related space-feed symptoms:
the aggregate candidate count could rise while scrolling and then fall again,
and a `Nuke 'Em 14` control could still produce `Nothing was queued`. The code
path was using the current live viewport scan at click time whenever any live
entries existed, and only used the button's saved URL list when the live scan
was empty. From `1.5.65`, asset-space aggregate controls keep a page-session
accumulator of discovered candidates and aggregate clicks submit the button's
saved URL snapshot filtered through those accumulated entries.

Before driving live work, check coordinator tab count through `/json/list`.
Expected count is exactly one while work is active and zero or one while idle.
If two `chrome-extension://.../coordinator.html` tabs are present, close the
duplicate before continuing; otherwise queue ownership and visual evidence are
harder to interpret.

If `9223` is occupied on this host, choose another host-side port and keep the
laptop side unchanged. Example:

```bash
ssh -N -o ExitOnForwardFailure=yes -o ServerAliveInterval=30 -R 9333:127.0.0.1:9222 dbrower@phoenix92608.dev3sub2phx.databasede3phx.oraclevcn.com
```

Then probe `http://127.0.0.1:9333/...` from this host.

## Windows Chrome Artifact Push Tunnel

The laptop cannot be reached directly from this host, so Codex can push rebuilt
Chrome extension files only through a reverse SSH tunnel started from the
laptop.

This setup is separate from the Chrome CDP tunnel. Keep both SSH sessions open
when Codex needs to update the laptop copy and then drive Chrome:

- CDP tunnel: laptop Chrome `127.0.0.1:9222` exposed here as `127.0.0.1:9223`
- copy tunnel: laptop Cygwin sshd `127.0.0.1:22` exposed here as
  `127.0.0.1:10022`

The working Cygwin account name on the laptop is:

```text
DBROWER-X40-J+DBROWER
```

### Start The Copy Reverse Tunnel From Cygwin

Run this from a Cygwin shell on the Windows laptop, leaving the SSH session
open:

```bash
ssh -N -o ExitOnForwardFailure=yes -o ServerAliveInterval=30 \
  -R 10022:127.0.0.1:22 \
  dbrower@phoenix92608.dev3sub2phx.databasede3phx.oraclevcn.com
```

This assumes the laptop has a Cygwin/OpenSSH server listening on laptop-local
`127.0.0.1:22`.

### Probe The Copy Tunnel From This Host

Use `BatchMode=yes` so probes fail instead of waiting for a password prompt:

```bash
timeout 8 ssh -p 10022 -o BatchMode=yes \
  'DBROWER-X40-J+DBROWER@127.0.0.1' 'echo ok'
```

Expected output:

```text
ok
```

To check remote tools and target directory:

```bash
timeout 8 ssh -p 10022 -o BatchMode=yes \
  'DBROWER-X40-J+DBROWER@127.0.0.1' \
  'command -v rsync; test -d /cygdrive/c/Users/DBROWER/Documents/src/mute-block-main && echo target-parent-ok; test -d /cygdrive/c/Users/DBROWER/Documents/src/mute-block-main/chrome && echo chrome-dir-ok'
```

### Push `chrome/` From This Host

The robust working path was a tar stream over SSH:

```bash
tar -C /scratch/dbrower/home/src/mute-block-main -cf - chrome \
  | ssh -p 10022 -o BatchMode=yes \
    'DBROWER-X40-J+DBROWER@127.0.0.1' \
    'mkdir -p /cygdrive/c/Users/DBROWER/Documents/src/mute-block-main && tar -xf - -C /cygdrive/c/Users/DBROWER/Documents/src/mute-block-main'
```

This overwrites files present in the archive but does not delete stale files
that no longer exist locally. That is fine for ordinary extension rebuilds
where the file set is stable.

If the piped form fails with `Bad owner or permissions on
/etc/ssh/ssh_config.d/05-redhat.conf`, use a temporary tarball and redirect it
into SSH instead of piping:

```bash
tar -C /scratch/dbrower/home/src/mute-block-main -cf /tmp/mute-block-chrome.tar chrome
ssh -p 10022 -o BatchMode=yes \
  'DBROWER-X40-J+DBROWER@127.0.0.1' \
  'mkdir -p /cygdrive/c/Users/DBROWER/Documents/src/mute-block-main && tar -xf - -C /cygdrive/c/Users/DBROWER/Documents/src/mute-block-main' \
  < /tmp/mute-block-chrome.tar
```

If a future change removes files from `chrome/`, use a clean replace instead:

```bash
tar -C /scratch/dbrower/home/src/mute-block-main -cf - chrome \
  | ssh -p 10022 -o BatchMode=yes \
    'DBROWER-X40-J+DBROWER@127.0.0.1' \
    'rm -rf /cygdrive/c/Users/DBROWER/Documents/src/mute-block-main/chrome && mkdir -p /cygdrive/c/Users/DBROWER/Documents/src/mute-block-main && tar -xf - -C /cygdrive/c/Users/DBROWER/Documents/src/mute-block-main'
```

Use the clean replace only when needed; the non-destructive tar copy is safer
for normal rebuilds.

### Verify The Laptop Copy

Compare manifest version and a few hashes:

```bash
sha256sum chrome/manifest.json chrome/js/content.js chrome/js/sw.js

timeout 10 ssh -p 10022 -o BatchMode=yes \
  'DBROWER-X40-J+DBROWER@127.0.0.1' \
  'cd /cygdrive/c/Users/DBROWER/Documents/src/mute-block-main && sed -n "1,6p" chrome/manifest.json && sha256sum chrome/manifest.json chrome/js/content.js chrome/js/sw.js'
```

Known caveat:

- `rsync -e 'ssh -p 10022 ...'` hit `Bad owner or permissions on
  /etc/ssh/ssh_config.d/05-redhat.conf` from this host's SSH config.
- `rsync -e 'ssh -F /dev/null ...'` avoided the config problem but did not use
  the identity/config that made the normal SSH probe work.
- The working checksum-copy command is now:

```bash
rsync -azc --delete -e 'ssh -F /home/dbrower/.ssh/config -p 10022 -o BatchMode=yes' \
  chrome/ \
  'DBROWER-X40-J+DBROWER@127.0.0.1:/cygdrive/c/Users/DBROWER/Documents/src/mute-block-main/chrome/'
```

Use checksum mode (`-c`) because same-size generated JavaScript once remained
stale on the laptop. Verify remote hashes with the same explicit config:

```bash
ssh -F /home/dbrower/.ssh/config -p 10022 -o BatchMode=yes \
  'DBROWER-X40-J+DBROWER@127.0.0.1' \
  'cd /cygdrive/c/Users/DBROWER/Documents/src/mute-block-main && sed -n "1,6p" chrome/manifest.json && sha256sum chrome/manifest.json chrome/js/content.js chrome/js/sw.js chrome/js/coordinator.js'
```

## Asset Space Test Inputs

The repo-local `assets` file is a newline list of Quora pages that can/should
be marked as asset pages in Mute Block and reused for live coordinator testing.
Use these before ad hoc browsing when a run needs known candidate sources:

```text
https://ummno.quora.com/
https://trollsgalore.quora.com/
https://trollpatrol2.quora.com/
https://takingoutthetrash.quora.com/
https://letsplaywhackatroll.quora.com/
https://spamdetectives.quora.com/
https://theobvioustrollshootinggallery.quora.com/
https://theqdefensecrew.quora.com/
https://instantblock.quora.com/
https://sockpuppestan.quora.com/
https://romancescammercentral.quora.com/
https://www.quora.com/search
```

Operational note: load one or more of the space pages in the debug Chrome
profile, mark them as assets, hard reload after extension updates, then use
their visible space-feed controls to enqueue coordinator work. The search URL
is useful for discovery; treat it separately if it does not present the same
asset-space controls as a space page.

When a page appears to be out of candidates, scroll it down and wait briefly so
new posts can load and the content script can rescan. When the marked asset
pages are exhausted, live candidate testing is done until the next day.

## Working Browser Launch

Close any existing Firefox that has the default profile locked, then launch the real profile with Firefox BiDi:

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

Important details:

- The WebSocket URL is `ws://127.0.0.1:9224/session`.
- This is Firefox WebDriver BiDi, not Chrome DevTools Protocol.
- `/json/version` and `/json/list` are not valid here.
- If probing with `curl`, use `--noproxy '*'`; proxy env vars otherwise tried to route localhost traffic through the corporate proxy.
- Firefox allows only one active BiDi session. Always call `session.end` before closing the WebSocket. If a script is killed before `session.end`, Firefox may reject later `session.new` calls with `Maximum number of active sessions`; restart Firefox to clear it.

## Loading The Extension

The extension can be loaded into the already logged-in Firefox session through BiDi without starting `web-ext` or a temp profile.

Minimal Node pattern:

```js
const WebSocket = require('ws');
const ws = new WebSocket('ws://127.0.0.1:9224/session');

let id = 1;
const pending = new Map();

function send(method, params = {}) {
  const msg = { id: id++, method, params };
  ws.send(JSON.stringify(msg));
  return new Promise(resolve => pending.set(msg.id, resolve));
}

ws.on('message', data => {
  const msg = JSON.parse(data.toString());
  if (msg.id && pending.has(msg.id)) {
    pending.get(msg.id)(msg);
    pending.delete(msg.id);
  }
});

ws.on('open', async () => {
  await send('session.new', { capabilities: {} });
  try {
    console.log(await send('webExtension.install', {
      extensionData: {
        type: 'path',
        path: '/scratch/dbrower/home/src/mute-block-main/firefox'
      }
    }));
  } finally {
    await send('session.end', {});
    ws.close();
  }
});
```

The logical extension id reported in this run was:

```text
{e6430d3b-a0ca-4052-bd01-2a5966347e6e}
```

The runtime `moz-extension://...` UUID can vary. During this run it was:

```text
moz-extension://8d5ccf9f-e7a6-4614-81e5-4005d88b3dcc/
```

Do not hard-code the UUID unless verifying the current session.

## Finding The Space Page And Button

Use `browsingContext.getTree`, then evaluate in top-level Quora contexts. The target page in this run was:

```text
https://theqdefensecrew.quora.com/?__ni__=0&__tiids__=212052686&__filter__=all&__nsrc__=notif_page&__sncid__=73715399034&__snid3__=97970736930#anchor
```

The top space-feed nuke button selector:

```js
document.querySelector('.mb-ext_space-feed-nuke-btn')
```

The candidate list is stored on the button:

```js
JSON.parse(document.querySelector('.mb-ext_space-feed-nuke-btn')?.dataset.mbSpaceFeedUrls || '[]')
```

In the preflight snapshot before the run:

- top button existed
- top button had 15 unique candidates
- page had 17 nuke buttons total
- page node count was about 4,866

## Monitoring Approach Used

Before clicking the top button, a lightweight page monitor was injected into the owner page:

- `MutationObserver` on `document.documentElement`
- counters for mutation batches, mutation records, added nodes, removed nodes, attribute records
- a 250 ms interval measuring event-loop lag
- button text/state tracking for `.mb-ext_space-feed-nuke-btn`

BiDi subscriptions used:

```js
await send('session.subscribe', {
  events: [
    'browsingContext.contextCreated',
    'browsingContext.contextDestroyed',
    'browsingContext.navigationStarted',
    'browsingContext.domContentLoaded',
    'browsingContext.load',
    'log.entryAdded'
  ]
});
```

The top button was clicked with:

```js
const b = document.querySelector('.mb-ext_space-feed-nuke-btn');
b.scrollIntoView({ block: 'center', inline: 'nearest' });
b.click();
```

When done, remove the injected monitor:

```js
const mon = window.__mbNukeMonitor;
mon?.observer?.disconnect?.();
clearInterval(mon?.interval);
delete window.__mbNukeMonitor;
```

## Observed Run

The run opened child tabs quickly:

- First 10 profile tabs opened almost immediately.
- `profilesPerBatch` was effectively 10.
- Remaining queued profiles were opened as active slots cleared.
- The run mechanically drained by about 50 seconds.
- Top-level browser contexts returned to 2 and no profile tabs remained.

Measured owner-page churn:

- At about 6 seconds:
  - button: `Nuking... [t:10 a:10 q:5]`
  - mutation records: 1,228
  - max event-loop lag: 524 ms
- At about 24 seconds:
  - button: `Nuking... [t:10 a:10 q:0]`
  - mutation records: 13,796
  - max event-loop lag: 10,803 ms
- Final observed state:
  - mutation records: 19,555
  - max event-loop lag: 10,803 ms
  - lag samples over 100 ms: 12
  - owner page node count stayed around 4,866

This points to update/event churn rather than page DOM growth.

## Remaining Candidate State After The Run

After the run, the top button returned to idle/black instead of `Nuked`. The live page showed four unique remaining candidate URLs:

- `https://www.quora.com/profile/Anita-8884`
- `https://www.quora.com/profile/Ealwiga-OWiggies`
- `https://www.quora.com/profile/Mavis-K-Wanczyk`
- `https://www.quora.com/profile/Ronnie-Mac-52`

`Ealwiga-OWiggies` appeared on two separate post buttons, so the visible actionable rows may look like five while the top button reports four unique candidates.

Storage inspection through the extension popup page showed these four profiles had:

- `status: "error"`
- `muteError: "Mute option not found"`
- `blockError: "Block option not found"`
- `finalError: "Queued profile action did not complete"`
- `blockSucceeded: false`

This is why the page kept them queueable. The code only treats these as successful:

- `blockSucceeded`
- `status === "blocked"`
- `status === "already-blocked"`

## 1.5.3 Follow-up Run

Changes made after the slow/failing run:

- Space-feed queue progress now records only the post keys and post URLs associated with each queued profile instead of copying every selected post key and URL onto every profile record.
- Space-feed nuke concurrency is capped at three active profile tabs, even when the general `profilesPerBatch` setting is higher.
- Hidden queued profile tabs promote to the foreground sooner when profile actions are not ready.
- If a hidden profile tab can open the profile menu but cannot see the mute/block menu item, it promotes to the foreground and retries the menu lookup before failing.

Artifacts rebuilt:

- `chrome/mute_block-1.5.3.zip`
- `firefox/mute_block-1.5.3.zip`

Live Firefox was updated through BiDi with the rebuilt `firefox/` directory, then the space page was reloaded.

Preflight after reload showed four remaining unique candidates:

- `https://www.quora.com/profile/Anita-8884`
- `https://www.quora.com/profile/Ealwiga-OWiggies`
- `https://www.quora.com/profile/Mavis-K-Wanczyk`
- `https://www.quora.com/profile/Ronnie-Mac-52`

The monitored 1.5.3 run completed cleanly:

- final top button: `Nuked`
- final top button URLs: `[]`
- active queue label during run: `t:3`, then `t:2`, then `t:1`
- owner-page mutation records: about `2,795`
- owner-page max event-loop lag: about `1,774 ms`

This was much lower churn than the earlier run, which reached about `19,555` mutation records and `10,803 ms` max lag. One automation caveat: a BiDi `script.evaluate` JavaScript `button.click()` did not visibly queue immediately in this run. If a later automation poke appears idle, use a real VNC click or BiDi pointer input before concluding the extension handler is stalled.

## 1.5.4 Follow-up

The 1.5.3 foreground fallback improved completion, but a 40-scroll batch test showed an unacceptable behavior: queued profile tabs promoted themselves and stole focus from the parent space tab.

The 1.5.4 change marks space-feed queued tabs with `noForegroundFallback`:

- `nukeSpaceFeedEntries()` sends `noForegroundFallback: true` with `enqueue-tabs`.
- `sw.js` carries that flag through queued action metadata and `claim-tab-action`.
- queued profile content scripts derive `allowForegroundFallback = !claimedAction.noForegroundFallback`.
- profile action readiness, menu-open fallback, and mute/block menu-action fallback all skip foreground promotion when that flag is set.

This preserves the 1.5.3 foreground fallback for manual/profile flows while keeping space-feed batch jobs from stealing the visible browser tab.

Artifacts rebuilt:

- `chrome/mute_block-1.5.4.zip`
- `firefox/mute_block-1.5.4.zip`

Retest caveat: the interrupted 40-scroll monitor left Firefox with a stuck BiDi session (`Maximum number of active sessions`). Restart Firefox before loading 1.5.4 and re-running the 40-scroll timing test.

## 1.5.5 Follow-up

Observed after more manual runs: Quora sometimes showed menu text like `Unmute <target>`. That is an important clue because a naive `mute` matcher can accidentally match inverse labels if Quora changes the spelling to a variant such as `Un-mute` or `Un mute`.

The 1.5.5 change hardens profile menu action classification:

- inverse mute labels now match `unmute`, `un-mute`, and `un mute`
- inverse block labels now match `unblock`, `un-block`, and `un block`
- primary mute/block labels explicitly reject inverse labels
- mute/block failure progress records include the visible menu action labels as `menuActionLabels`

Artifacts rebuilt:

- `chrome/mute_block-1.5.5.zip`
- `firefox/mute_block-1.5.5.zip`

Relevant source:

- `shared/js/content.js`
  - `isSuccessfulProfileNukeRecord()`
  - `getQueueableSpaceFeedEntryUrls()`
  - `isSpaceFeedPostEffectivelyNuked()`

## Fixed Progress Bloat

Before 1.5.3, `nukeSpaceFeedEntries()` deduped profile URLs, then recorded the same full selected `postKeys` and `postUrls` arrays on every queued profile progress record:

```js
const urls = getDedupedSpaceFeedUrls(entries);
const postKeys = entries.map(entry => entry?.postKey).filter(Boolean);
const postUrls = entries.map(entry => entry?.postUrl).filter(Boolean);

await recordProfileNukeProgressBatch(urls.map(url => ({
  profileHref: url,
  patch: buildQueuedProfileProgressPatch('Queued from space feed', {
    postKeys,
    postUrls
  })
})));
```

Observed effect:

- Each failed profile record contained all 16 post keys and all 16 post URLs from the run.
- That bloats `mbProfileNukeProgress`.
- Every storage write and storage-change event carries a larger payload than necessary.
- This is a credible contributor to the observed mutation/storage/UI churn during large space nukes.

Applied 1.5.3 fix:

- Build a per-profile association map while deduping URLs.
- For each profile URL, store only the post key(s) and post URL(s) where that profile actually appeared.
- Then pass those per-profile arrays to `buildQueuedProfileProgressPatch()`.

Likely local edit area:

- `shared/js/content.js`
  - near `getDedupedSpaceFeedUrls()`
  - `nukeSpaceFeedEntries()`

Because this repo ships packaged extension artifacts, if changing behavior:

1. bump versions first in:
   - `package.json`
   - `package-lock.json`
   - `manifests/chrome.json`
   - `manifests/firefox.json`
2. rebuild:
   - `npm run prod`
   - `npm run build:chrome`
   - `npm run build:firefox`

Use `env npm_config_cache=/scratch/dbrower/.npm-cache ...` if npm tries to write to read-only `/home/dbrower/.npm`.

## Other Pitfalls

- Do not use `web-ext run` for Cloudflare-gated Quora debugging unless copying the real profile state intentionally. A fresh temp profile loses the trusted login/challenge state.
- Do not use Puppeteer/Chromium 94 for the Quora challenge path; it looped.
- For Windows Chrome over the reverse SSH tunnel, use direct CDP rather than Puppeteer.
- Do not leave BiDi sessions open. Use one controller process and always end the session.
- If opening `moz-extension://.../popup.html` to inspect storage, wrap async evals in an async IIFE; plain top-level `await` failed in `script.evaluate`.

## 1.5.6 Scroll/Parent-Page Performance Finding

A 106-candidate asset-page run on `trollsgalore.quora.com` showed the owner tab becoming increasingly saturated:

- before clicking nuke: 106 candidate URLs, 120 post buttons, 122 timestamps, `scrollHeight` about 31936
- around 25 seconds: about 5,292 observed mutations and max main-thread lag about 10.6s
- around 240 seconds: about 54,968 observed mutations, mostly attributes, and max lag about 13.2s
- around 500 seconds: about 114,378 observed mutations, with 114,021 attribute mutations

The important clue is that almost all of the churn was attribute mutation noise, not new feed cards. The 1.5.5 owner page still treated ordinary Quora attribute churn and every progress storage write as a reason to rescan the whole space feed. As the feed grew, each rescan walked all timestamps/cards, did layout reads, refreshed status snapshots, and touched per-post buttons.

Applied 1.5.6 mitigation:

- only schedule full space-feed nuke sync from structural feed mutations or relevant `href` changes
- ignore unrelated attribute churn from the page
- defer full feed rescans until scrolling has been idle briefly
- use cached feed entries for progress-driven top-button updates while background profile tabs are running
- avoid building the heavy MB Info snapshot on every sync; it is generated only when the MB Info button is clicked
- avoid layout sorting of all timestamps during normal feed scans
- reduce per-entry viewport capture from two layout reads to one

Artifacts rebuilt:

- `chrome/mute_block-1.5.6.zip`
- `firefox/mute_block-1.5.6.zip`

### 1.5.6 Completion Sample

On `https://antispamandscam.quora.com/?__ni__=0&__tiids__=212041273&__filter__=all&__nsrc__=notif_page&__sncid__=73707892235&__snid3__=97960958204#anchor`, after the scroll fix:

- scrolling to the candidate set was subjectively much better
- clicked top `Nuke 'Em` with 88 candidate URLs, 86 post buttons, 89 timestamps, and `scrollHeight` about 26539
- queue drained to idle in about 346.7s
- final top button still had 11 candidate URLs and 11 post buttons still showed `Nuke 'Em`
- final parent-page monitor saw about 67,200 mutations, mostly attributes, with max lag about 7.4s

The 11 visible leftovers all had progress records:

- security verification: `PeekEditPlays`
- profile unavailable: `Security-Professional-With-10`
- timed out waiting for completion before mute/block attempt: `Tofaani`, `%E6%A0%87-%E5%AD%94`, `Winnifred-Wiggiesdottir-1`, `Bernard-Rose-2-1`, `Buying-And-Selling-Online-Businesses`, `Joy-10833`
- muted/already-muted but block option not found: `Marketing-SEO-31`, `Quintadena-Limited`
- profile actions not ready: `Bryan-Anderson-577`

This shifts the next performance/correctness target from owner-page scanning to child-tab handling. The timeout records are especially suspicious because their event trail says `Queued tab closed after timing out waiting for completion`, but the stored record still had `closed: false`; that may keep posts pending and visible as stragglers. The `Block option not found` cases had `menuActionLabels: []`, which also suggests background menu inspection still sometimes cannot see the profile action menu without foreground fallback.

## 1.5.7 Child-Tab Straggler Fixes

The 11 leftovers from the 1.5.6 run exposed two concrete child-tab issues:

- space-feed child tabs directly edited `mbSpacePendingNukedPosts` from their own content-script snapshots; concurrent child tabs could write stale pending-post copies and reintroduce URLs another tab had already removed
- no-foreground-fallback child tabs waited up to 25s for profile actions, but the service worker treated non-action queued tabs as stale after 15s and could close them before the content script finished waiting

Applied 1.5.7 fixes:

- serialize pending/nuked space-feed storage updates through the service worker
- route child-tab `removePendingSpaceFeedUrls()` and `confirmSpaceFeedProfileBlocked()` through those service-worker storage actions, with the old direct path only as a fallback
- extend the service-worker stale timeout for `noForegroundFallback` queued tabs to 35s
- when the service worker closes a stale active tab, write `tabClosedAt`, `closedByExtension`, and `closeReason` into the progress record before removing the tab

Artifacts rebuilt:

- `chrome/mute_block-1.5.7.zip`
- `firefox/mute_block-1.5.7.zip`

## 1.5.8 Settled-Failure Button State

After reloading 1.5.7, a smaller follow-up run on the same asset page left the top button black with 4 candidates:

- `PeekEditPlays`: security verification
- `Security-Professional-With-10`: profile unavailable
- `Marketing-SEO-31`: mute succeeded/already muted, but block option not found
- `Quintadena-Limited`: mute succeeded/already muted, but block option not found

Storage inspection showed these 4 were not in matching pending-post records anymore, so the serialized service-worker pending update was working. They were still counted because `getQueueableSpaceFeedEntryUrls()` excluded only successful profile records. Terminal failed/skipped records were removed from pending state but then rediscovered as fresh queueable candidates by the visible page scan.

Applied 1.5.8 fix:

- add `isSettledProfileNukeRecord()` / `isProfileNukeSettled()`
- treat successful, unavailable, error, error-page, and interrupted records as settled for space-feed queueability
- exclude settled records from `getQueueableSpaceFeedEntryUrls()`
- mark the top space-feed button `Done` and disabled when all actionable entries are settled, instead of leaving a black `Nuke 'Em` button with zero useful work

Artifacts rebuilt:

- `chrome/mute_block-1.5.8.zip`
- `firefox/mute_block-1.5.8.zip`

## 1.5.9 Child-Tab Timing Instrumentation

The 1.5.8 large run on `https://theobvioustrollshootinggallery.quora.com/` completed cleanly with the top button disabled as `Done`, but it still took several minutes for 116 candidates. The parent tab was no longer doing the old mutation-rescan spiral, so the next question is where the child-tab wall time is going and whether the parallel slots are actually buying throughput.

Applied 1.5.9 instrumentation:

- assign a unique `runId` and `queueIndex` to each top-button space-feed nuke run
- record `tabCreatedAt`, `contentOpenedAt`, `terminalAt`, `slotReleasedAt`, and `closeRequestedAt` in addition to the existing action timestamps
- add an MB Info timing summary with count/avg/p50/p90/max for queue wait, content open, profile ready, mute, block, total, slot release, and close phases
- include the 10 slowest profiles in the MB Info timing summary
- add per-candidate raw `_ms` timing fields plus `run_id`, `queue_index`, and normalized outcome in the detailed report

Next performance test:

1. Load/reload the unpacked Firefox extension from this repo's `firefox/` directory.
2. Reload the asset-space page after the extension reload.
3. Build a large candidate set, click top `Nuke 'Em`, and let it finish.
4. Click `MB Info` and copy the report. The useful lines start with `timing_`, and the per-candidate fields include `queue_wait_ms`, `content_open_ms`, `profile_ready_ms`, `mute_ms`, `block_ms`, `total_ms`, `slot_release_ms`, and `close_ms`.

Artifacts rebuilt:

- `chrome/mute_block-1.5.9.zip`
- `firefox/mute_block-1.5.9.zip`

## 1.5.9 Post-Nuke Timing Result

User-provided MB Info from `https://kickingassandtakingnames.quora.com/` showed the 1.5.9 timing instrumentation working for the active run:

- run id: `space-feed-1778204900353-zvkb69`
- 94 scoped timing profiles
- outcomes: `blocked=21`, `already-blocked=71`, `profile-unavailable=1`, `security-verification=1`
- queue wait dominated wall time: avg `254s`, p50 `279s`, p90 `416s`, max `448s`
- action work was much smaller: content open p90 `6.0s`, profile-ready avg `2.3s`, mute avg `16s`, block avg `9.2s`
- the slowest profiles were queue indexes 85-94, confirming tail latency was mostly waiting behind the 3-wide space-feed cap
- pending state was clean at the end: `pending: 0`, `tracked_candidates: 146`, `actionable_candidates: 146`, `post_buttons: 144`, `expected_post_buttons: 144`

The remaining instrumentation gap was close/slot accounting:

- `timing_slot_release` counted only 11 records for 94 terminal profiles
- `timing_close` counted only 12 records for 94 terminal profiles
- many terminal records still had `closed: false`, `closed_by_extension: false`, and blank `slot_release_ms` / `close_ms`

That pointed at service-worker close paths that released or removed tabs without recording timing fields, especially terminal-progress cleanup and background blocked sweeps.

## 1.5.10 Slot/Close Accounting And 5-Wide Probe

Applied 1.5.10 fixes:

- centralize `slotReleasedAt` recording in `releaseQueuedTab()` so every active slot release is stamped
- centralize `closeRequestedAt`, `closeReason`, and `closedByExtension` recording in `markQueuedTabClosing()`
- keep queued-tab metadata until `tabs.onRemoved` can record actual `tabClosedAt`
- avoid clearing metadata before service-worker-driven removals for terminal progress, close-request timeout, and stale active tabs
- normalize successful records that were later patched as `interrupted` back to `blocked` / `already-blocked`
- raise the space-feed concurrency cap from 3 to 5 as an internal safety cap, separate from the user `profilesPerBatch` setting for profile-list flows

Next run expectations:

- `timing_slot_release` and `timing_close` should be near the scoped `timing_profiles` count
- `closed_by_extension` should be true for extension-removed terminal tabs
- queue p50/p90/max should drop if Quora and Firefox tolerate five active space-feed profile tabs

Artifacts rebuilt:

- `chrome/mute_block-1.5.10.zip`
- `firefox/mute_block-1.5.10.zip`

## 1.5.10 Post-Nuke Timing Result

User-provided MB Info from `https://qtrollpatrol.quora.com/` showed the 1.5.10 accounting fix working:

- run id: `space-feed-1778206559891-gwv6no`
- 112 scoped timing profiles
- outcomes: `already-blocked=103`, `blocked=5`, `profile-unavailable=3`, `security-verification=1`
- pending state was clean at the end: `pending: 0`
- close/slot accounting matched the scoped profile count: `timing_slot_release: count=112`, `timing_close: count=112`

The 5-wide probe did not materially improve throughput:

- previous 3-wide result: 94 profiles in about 457s, about 4.9s/profile
- 5-wide result: 112 profiles in about 541s, about 4.8s/profile
- content-open timing worsened from p90 about 6.0s to p90 about 14s

Conclusion: the higher internal cap is stable enough for accounting, but Quora/browser contention appears to erase most of the concurrency gain. The next useful code target is hardening stale-active-tab timeout behavior around slow in-progress actions, not adding a user-facing concurrency preference.

## 1.5.11 Preference/Cap Separation

The popup `Profiles Per Batch` hint now documents that the setting applies to profile-list open/nuke flows. Space-feed nukes use the fixed internal safety cap directly instead of treating `profilesPerBatch` as another way to tune space-feed concurrency.

## 1.5.12 Stale Attempt Retry

Stale active queued tabs now close and requeue the same profile for a bounded replacement attempt instead of immediately ending as `interrupted`. The retry is internal, limited to two replacements, and is recorded as `retrying` so the owner-page progress stays visibly active through `[active/queued]` counters rather than sitting quiet behind one long timeout.

## 1.5.13 Retry Backoff Lesson

The stale-attempt retry idea was useful diagnostically, but the aggressive retry behavior was not a good production direction. In live asset-space runs it increased pressure on Quora and led to more bad page loads / 504-style behavior instead of improving throughput.

Carry this forward as a constraint:

- do not fix slow child tabs by amplifying retries
- prefer earlier terminal classification, better stale-state reconciliation, and better target dedupe
- keep space-feed concurrency as an internal safety policy, not a user-facing tuning knob unless there is strong evidence it helps

## 1.5.14 / 1.5.15 Already-Blocked Preservation

The instantblock-style asset-space case showed that already-blocked profiles were being detected, but some early paths still recorded them as generic `blocked` or failed to close their tabs consistently.

Applied direction:

- preserve `status: "already-blocked"` when `foundBlockedBeforeQueue` is true
- let early `isProfileBlocked()` paths close through `closeQueuedBlockedTab()` with an already-blocked patch instead of writing already-blocked and then overwriting it as blocked
- treat successful records as terminal for timing and queue cleanup

This matters heavily for asset spaces because the same targets are often reported repeatedly across different posts and across different asset spaces. The dedupe key should be the normalized target profile URL, not the evidence post URL.

## 1.5.16 Cross-Run Success Short-Circuiting

Current source/build version is `1.5.16`.

Built artifacts expected in this checkout:

- `chrome/mute_block-1.5.16.zip`
- `firefox/mute_block-1.5.16.zip`

Validation already run for this build:

- `node --check shared/js/content.js`
- `node --check shared/js/sw.js`
- `env npm_config_cache=/scratch/dbrower/.npm-cache npm test`
- `env npm_config_cache=/scratch/dbrower/.npm-cache npm run prod`
- `env npm_config_cache=/scratch/dbrower/.npm-cache npm run build:chrome`
- `env npm_config_cache=/scratch/dbrower/.npm-cache npm run build:firefox`

The unpacked `firefox/` output was loaded into the live Firefox profile through BiDi. The reported extension id was:

```text
{e6430d3b-a0ca-4052-bd01-2a5966347e6e}
```

1.5.16 added stronger short-circuiting before opening more tabs:

- content-side space-feed scans filter out stored successful profile records before writing fresh `queued` records
- pending space-feed URLs ignore profiles that are already known successful
- space post and modal nuke flows skip known successful profiles
- service-worker enqueue/open paths refuse to open tabs whose stored progress is already terminal/successful
- successful records are confirmed back against pending space-feed state so duplicate evidence posts can settle without another tab

Expected effect: repeated reports of the same profile across asset spaces should either avoid a child tab entirely or close quickly as terminal if a tab was already in flight. This is the main near-term win for asset-space redundancy.

## Current Live Test Context

The user loaded `1.5.16` and is testing additional asset spaces manually. Do not make more code changes during this run unless explicitly asked.

Latest pasted pre-run MB Info snapshot:

- `extension_version: 1.5.16`
- page/category: `space` / `asset`
- space appears to be `sockpuppestan.quora.com`
- `entries: 131`
- `actionable: 131`
- `actionable_candidates: 133`
- `stored_progress_records: 867`
- `tracked_candidates: 12`
- `pending: 0`
- `expected_post_buttons: 128`
- `post_buttons: 128`

Interpretation:

- many visible entries still show `progress: none`, which is normal before the fresh run
- the `timing_run_id` and timing summary in that pre snapshot are mostly older data, not proof of a fresh `1.5.16` result
- old records with `closed: false` can predate the later close/slot accounting fixes and should not be treated as live tabs without checking current browser contexts
- fresh `1.5.16` results should be judged by the new run id, fresh event timestamps, `closed_by_extension`, `close_reason`, `slot_release_ms`, and `close_ms`

Good fresh-run signals to look for in the next MB Info paste:

- repeated already-successful targets are absent from the queued set, or close with `terminal-progress-record`
- `already-blocked` remains `already-blocked`, not generic `blocked`
- `timing_slot_release` and `timing_close` counts stay close to `timing_profiles`
- `pending` returns to `0`
- `tracked_candidates` is much lower than `actionable_candidates` when asset-space redundancy is high

## 1.5.16 Sockpuppestan Post-Run Result

User-provided post-run MB Info from `sockpuppestan.quora.com`:

- report generated: `2026-05-08T05:21:04.051Z`
- run id: `space-feed-1778216805909-xe2bpd`
- `entries: 131`
- `actionable_candidates: 133`
- `stored_progress_records: 991`
- `tracked_candidates: 133`
- `pending: 0`
- `expected_post_buttons: 84`
- `post_buttons: 84`
- timing profiles: `122`
- outcomes:
  - `blocked=37`
  - `already-blocked=41`
  - `error:Queued tab timed out waiting for completion=25`
  - `error:Pending queue state reconciled after stale-active-tab=16`
  - `security-verification=1`
  - `profile-unavailable=2`

Good results from this run:

- close and slot accounting now looks solid: `timing_slot_release: count=122` and `timing_close: count=122`, matching `timing_profiles`
- `pending` returned to `0`
- fresh terminal-success examples generally show `closed: true`, `closed_by_extension: true`, and `close_reason: terminal-progress-record`
- duplicate visible evidence can share one profile record: `Kimberleedenise-Williamson-20` appeared as entry 9 and entry 101 with the same run id / queue index / close timing
- remapping is visible in the report, for example:
  - `Addison-1874` remapped to `Addison-Reed-57`
  - `Mark-Robbie-Fernando` remapped to `Amiraaldhabidubai9920`
  - `Rahimullah-Esazai` remapped to `Muhabat-Ullah-Esazai`
  - `Barry-Soreassaurus` remapped to `Demonrat-Troll-Buster`

Main unresolved problem:

- 41 of 122 fresh timing profiles ended in stale/timeout-style outcomes
- the stale outcomes often happen shortly after tab navigation and before useful content-script progress:
  - many have blank `content_open_ms`, `profile_ready_ms`, `mute_ms`, and `block_ms`
  - many show `Queued tab close requested (stale-active-tab)` around 16-18s after navigation
  - several show `Queued tab opened` only after the stale close was already requested, which means the service-worker stale timer can beat the child tab's open/ready signal
- this looks more like stale-active timeout policy / child-tab readiness coordination than parent-page scanning or close-accounting

Important nuance:

- `already-blocked` preservation is improved, but `found_blocked_before_queue: true` does not always mean the tab was skipped before action work. Some fresh records with that flag still show `mute_attempted: true` and `block_attempted: true`. The flag may be set by a later background sweep rather than by a pre-open dedupe decision, so do not use it alone as proof that already-blocked short-circuiting worked.
- `tracked_candidates: 133` is not the same as "still queueable"; after a run it can mean every visible candidate has some progress record. Use per-candidate status/outcome, post button state, and pending state to judge remaining work.

Next code target when changes resume:

1. Inspect the service-worker stale-active timer against the no-foreground space-feed path.
2. Verify which timestamp starts the stale timeout: tab creation, navigation, content-open, or claimed-action time.
3. Avoid closing a child tab before the content script has had a realistic chance to claim/open on slow Quora loads.
4. Avoid retry amplification; this run still supports bounded timeout policy changes over aggressive retries.
5. Keep the already-blocked success guard, but distinguish true pre-open successful-record skips from background-sweep confirmations that happen after a tab was already opened.

## OP-Chase Asset Posts Are A Separate Case

Do not solve the OP-chase problem by rejecting content/question/article URLs outright.

Some asset spaces use posts/articles as the evidence item, and the intended target is the original poster of that linked content. In those cases the extension needs to chase from the evidence post/article to the original poster, then mute/block that resolved profile.

Important distinction:

- direct profile-like asset posts can dedupe and act on the normalized profile URL immediately
- evidence content URLs need a content-page-to-OP resolution path before the profile action timeout
- once the OP is resolved, terminal progress should be keyed to the resolved profile so future duplicate evidence can short-circuit

There is already question-log OP redirect machinery (`mb_op=1`) for normal question pages, but queued space-feed nuke tabs currently expect to reach a profile quickly. That is why content/OP cases can stale-close today. Revisit this later after the current asset-space runs produce fresh examples.

## Resume Checklist

When resuming in a new Codex session:

1. Run `skills-book` first.
2. Stay read-only until the user asks for code changes; current live testing may still be running.
3. Ask for or inspect the fresh post-run MB Info from `1.5.16`.
4. Separate fresh `1.5.16` run data from older stored progress records.
5. For redundancy work, focus on normalized target-profile success/terminal short-circuiting.
6. For OP-chase work, preserve evidence content URLs and add resolution to original-poster profile rather than filtering them out.
7. If changing shipped behavior, bump version first, then rebuild `prod`, `build:chrome`, and `build:firefox` with `env npm_config_cache=/scratch/dbrower/.npm-cache`.

## 2026-05-09 Chrome Coordinator Resume Note

- Live Windows Chrome debugging is using direct CDP over the reverse SSH tunnel, not Puppeteer.
- CDP endpoint: `http://127.0.0.1:9223` with `curl --noproxy '*'`.
- Extension id: `ajcjckiafbnhioeafaejlaehkmdcdeha`.
- `1.5.29` showed a Manifest V3 service-worker liveness failure: one profile completed, then storage still had pending coordinator rows but there were no live profile worker tabs and no extension errors.
- `1.5.30` adds a coordinator-page resume heartbeat plus service-worker reconstruction from persisted `mbCoordinatorQueue` rows when the in-memory executor queue is empty.
- After copying/loading `1.5.30`, the stranded pending rows resumed and drained to zero after the coordinator was opened.
- Avoid CDP `/json/new` for normal coordinator opening because Chrome raises the new tab. It is acceptable as a manual debug fallback, but it is not representative of the extension's intended inactive coordinator open path.
- `1.5.31` narrows security-verification detection and allows stale coordinator `security-verification` rows to reset when newer progress is transient and no longer marked security.
- Live `1.5.31` validation reset six stale security rows and executed them; manual coordinator repair then settled raw storage to `97 succeeded`, `19 failed`, `0 pending`.
- `1.5.32` makes the coordinator heartbeat look at raw stored queue state as well as display-merged state, so terminal progress should repair raw pending coordinator rows without a manual repair click/message.
- Live `1.5.32` update was clean: no runtime, warning, or manifest errors; coordinator opened with `active: false`; storage stayed at `97 succeeded`, `19 failed`, `0 pending`.

## 2026-05-09 Source-Page Pending And Timeout Retry Note

- Live Windows Chrome before the `1.5.35` patch had `mbSpacePendingNukedPosts` empty, so the stale `Nuking... 1 left` source-page state was not reproducing in the current snapshot.
- The code still allowed that stale state: source controls treated any stored pending post row as busy even if the remaining profile URLs had already reached terminal progress.
- `1.5.35` changes source-page pending calculations to count only active/transient profile work. Successful, non-retryable failed, and retryable terminal rows no longer keep a post button in `Nuking...`.
- Timeout-style terminal progress is retryable from source pages now. `interrupted` is retryable, and `error` is retryable only when its error text looks timeout/stale/interrupted. `securityVerification` remains non-retryable.
- The service worker executor now permits retryable terminal profile progress to be enqueued again instead of skipping it as already terminal. Successful and security-verification rows are still skipped/terminal.
- Validation completed locally before copy/update: `node --check shared/js/content.js`, `node --check shared/js/sw.js`, `node --check shared/js/coordinator.js`, `npm test`, `npm run prod`, `npm run build:chrome`, and `npm run build:firefox`.
- Built artifacts: `chrome/mute_block-1.5.35.zip` and `firefox/mute_block-1.5.35.zip`.
- Live Windows Chrome update to `1.5.35` was clean: zero runtime errors, runtime warnings, or manifest errors before and after update.
- Live click test on Trolls galore queued `https://www.quora.com/profile/DW-908` from an old failed timeout row. This confirmed the retryable row was not skipped and did not trigger the previous "Nothing was queued" popup.
- The worker opened and ran profile actions, including mute success and block attempt, but still ended as `failed/timeout` with profile progress `status: interrupted`, `closeReason: stale-active-tab`, and `finalError: Queued tab timed out waiting for completion`.
- Source-page stale UI improved in this test: `mbSpacePendingNukedPosts` returned to empty and the Trolls galore aggregate button returned from `Nuking... 1 left` to idle `Nuke 'Em`.
- Remaining timeout target: stale-active policy can still close a tab after profile actions have started but before block completion is recorded. The next fix should focus on action-stage heartbeat/deadline handling, especially after block flow starts or the tab navigates during block confirmation.
- Manual inspection of `DW-908` showed the native profile menu state was `Unmute ...` plus `Block`: muted but not blocked.
- Manual click on native `Block` opened a modal confirmation dialog with `role="dialog"`, text `Cancel` and `Block`, and submit button class `puppeteer_test_modal_submit`.
- `1.5.36` changes block-confirm selection so the extension only accepts a modal/dialog block submit button. It no longer treats the profile menu's own `Block` row as the confirmation action or as a pending confirm surface.
- Validation completed locally: `node --check shared/js/content.js`, `node --check shared/js/sw.js`, `node --check shared/js/coordinator.js`, `npm test`, `npm run prod`, `npm run build:chrome`, and `npm run build:firefox`.
- Built artifacts: `chrome/mute_block-1.5.36.zip` and `firefox/mute_block-1.5.36.zip`.
- Live Windows Chrome update to `1.5.36` was clean: zero runtime errors, runtime warnings, or manifest errors before and after update.
- Live retry on `DW-908` through the extension's visible `Mute Block` button worked: the page displayed `BLOCKED`, the profile progress row became `status: blocked`, `blockSucceeded: true`, `finalError: ""`, and events include `Block completed`.
- Residual state issue: the old raw `mbCoordinatorQueue[DW-908]` row remained `failed/timeout` even after profile progress became blocked. Coordinator display can merge progress, but raw storage repair did not run in this direct-profile action path. Fix this later by ensuring successful profile progress wakes or invokes coordinator repair/sync.
- After the user manually unblocked and unmuted `DW-908`, the single target was reset in storage and retried through the Trolls galore aggregate `Nuke 'Em` button on `1.5.36`.
- The first CDP DOM `click()` did not visibly enqueue; a real CDP mouse event against the button coordinates reached the extension path.
- Coordinator retry succeeded end-to-end: `mbProfileNukeProgress[DW-908]` became `status: "blocked"`, `blockSucceeded: true`, `finalError: ""`, and included `Block completed` plus queued-tab close events.
- The raw coordinator queue row also repaired correctly on this coordinator path: `mbCoordinatorQueue[DW-908]` became `status: "succeeded"`, `outcome: "blocked"`, `error: ""`, with run `space-feed-1778310848454-t8urcq` marked `complete`.
- The Trolls galore pending post state was empty for `DW-908`, and the post evidence was restored under `mbSpaceNukedPosts`.

## 2026-05-09 Security Verification Recheck

- Live `1.5.36` storage still had three `failed/security-verification` coordinator rows:
  - `Dear-son-I-Have`
  - `Rai-1006`
  - `SapienSedigitus`
- Each row had `securityVerification: true`, but the terminal errors were generic close/action errors rather than explicit verification messages.
- Inactive live opens of all three profiles loaded normal Quora profile pages:
  - `Dear-son-I-Have`: normal profile, no security text, already `BLOCKED`.
  - `Rai-1006`: normal profile, no security text, visible extension `Mute Block` controls.
  - `SapienSedigitus`: normal profile, no security text, already `BLOCKED`.
- `1.5.37` changes stored security classification so the raw `securityVerification` boolean is not enough by itself. A record is treated as real security verification only when stored evidence includes an explicit reason/message/URL such as security verification, verify-you-are-human, just-a-moment, challenge-platform, cdn-cgi, or turnstile.
- Fresh content-script progress now stores `securityVerificationReason` when the current page actually matches the security heuristic.
- Old generic security-flagged `error` or `interrupted` rows should now map to retryable action/timeout-style failures instead of permanent `security-verification`.
- Validation completed locally: `node --check shared/js/content.js`, `node --check shared/js/sw.js`, `node --check shared/js/coordinator.js`, `npm test`, `npm run prod`, `npm run build:chrome`, and `npm run build:firefox`.
- Built artifacts: `chrome/mute_block-1.5.37.zip` and `firefox/mute_block-1.5.37.zip`.
- Live update to `1.5.37` loaded cleanly and the explicit repair pass reclassified the three rows from `failed/security-verification` to `failed/action-error`.
- Clicking the visible Trolls galore aggregate button for `Rai-1006` did not enqueue. CDP click capture showed the event reached the button, but the extension handler did not run. This exposed a stale content-script button problem after extension reload: old DOM buttons can survive with dead extension listeners, and sync code reused them.
- `1.5.38` adds content-script instance stamping for space-feed top, aggregate, and single-post buttons. When a new content-script instance sees an existing button, it binds a current listener even if the DOM node came from an older extension context.
- Validation completed locally: `node --check shared/js/content.js`, `node --check shared/js/sw.js`, `node --check shared/js/coordinator.js`, `npm test`, `npm run prod`, `npm run build:chrome`, and `npm run build:firefox`.
- Built artifacts: `chrome/mute_block-1.5.38.zip` and `firefox/mute_block-1.5.38.zip`.
- Live update to `1.5.38` loaded cleanly, but Chrome did not inject the new content-script instance into the already-loaded Trolls galore page. A hard reload (`Ctrl+R`/`^R`) was needed before the visible button showed `data-mb-handler-instance` and `data-mb-click-handler`.
- After hard reload, the button handler was present, but clicking still did not enqueue because the top-button handler recomputed from an empty `latestSpaceFeedEntries` cache instead of using the URL already stored on the clicked button.
- `1.5.39` adds a fallback for top and per-post aggregate buttons: if live entries are empty, enqueue from the clicked button's stored `data-mb-space-feed-urls`.
- Validation completed locally: `node --check shared/js/content.js`, `node --check shared/js/sw.js`, `node --check shared/js/coordinator.js`, `npm test`, `npm run prod`, `npm run build:chrome`, and `npm run build:firefox`.
- Built artifacts: `chrome/mute_block-1.5.39.zip` and `firefox/mute_block-1.5.39.zip`.
- Live update to `1.5.39` loaded cleanly. After hard reloading Trolls galore, the top aggregate button for `Rai-1006` had a fresh handler instance and still had `data-mb-space-feed-urls`.
- Clicking the top aggregate button successfully entered `Nuking... 1 left`, opened a worker, and completed the retry.
- Final `Rai-1006` state: `mbProfileNukeProgress` is `status: "blocked"`, `blockSucceeded: true`, `securityVerification: false`, `finalError: ""`; `mbCoordinatorQueue` is `status: "succeeded"`, `outcome: "blocked"`.
- Pending state for `Rai-1006` was empty and the source post moved to `mbSpaceNukedPosts`; the source button showed `Nuked`.
- Chrome extension error surface after the run was clean: zero runtime errors, runtime warnings, or manifest errors.
- The source page briefly showed an incoherent `Paused [t:0 a:0 q:0]` style label. That should never display because pause is only meaningful while work exists.
- `1.5.40` normalizes owned-nuke status so `paused` is false whenever owned/active/queued are all zero, and the top space-feed button only renders `Paused` when there is real in-flight work.
- Validation completed locally: `node --check shared/js/content.js`, `node --check shared/js/sw.js`, `node --check shared/js/coordinator.js`, `npm test`, `npm run prod`, `npm run build:chrome`, and `npm run build:firefox`.
- Built artifacts: `chrome/mute_block-1.5.40.zip` and `firefox/mute_block-1.5.40.zip`.

## 2026-05-09 1.5.41 Stale Timeout Follow-up

The next known problem after `1.5.40` is timeout/stale-active behavior on old failed rows.

Concrete mismatch found:

- no-foreground space-feed profile workers wait up to 25 seconds in content code for profile actions
- the service-worker background stale-active timeout was 15 seconds
- previous failing rows often closed around 16-18 seconds, sometimes before the worker had reported useful content progress

`1.5.41` changes:

- background queued tabs get 45 seconds while waiting for content to open
- after content opens, background queued tabs get 35 seconds for profile actions to become ready
- mute/block action stages get 30 seconds
- the service worker's raw `get-owned-nuke-status` clears/report-suppresses `paused` when `active`, `owned`, and `queued` are all zero

Validation completed locally:

- `node --check shared/js/sw.js`
- `node --check shared/js/content.js`
- `node --check shared/js/coordinator.js`
- `env npm_config_cache=/scratch/dbrower/.npm-cache npm test`
- `env npm_config_cache=/scratch/dbrower/.npm-cache npm run prod`
- `env npm_config_cache=/scratch/dbrower/.npm-cache npm run build:chrome`
- `env npm_config_cache=/scratch/dbrower/.npm-cache npm run build:firefox`

Built artifacts:

- `chrome/mute_block-1.5.41.zip`
- `firefox/mute_block-1.5.41.zip`

Live test target:

- copy/load `chrome/` `1.5.41`
- update through CDP/extension manager, then hard reload Quora asset tabs
- retry a visible failed timeout target from CrowdOut, for example `Matt-Fuller-54`
- check whether any remaining timeout happened before `contentOpenedAt`, before `actionReadyAt`, or during `muting`/`blocking`

Live validation completed:

- Chrome unpacked extension updated to `1.5.41` with zero runtime errors, zero runtime warnings, and zero manifest errors
- hard reloaded Trolls Galore, CrowdOut, and Notifications
- CrowdOut showed one aggregate retry for `Matt-Fuller-54`
- retry ran through the coordinator and worker tab without stale-active timeout
- profile milestones showed content open, profile ready, mute attempted, block attempted, terminal close, and tab closed
- final source button text was `Nuked`
- final progress was `status: "blocked"`, `blockSucceeded: true`, `finalError: ""`
- final coordinator row was `status: "succeeded"`, `outcome: "blocked"`, `error: ""`
- pending post rows for the target returned to zero

## 2026-05-09 1.5.42 Duplicate Progress Diagnostic

The next known issue is duplicate-looking progress events in successful queued-worker runs. `Matt-Fuller-54` succeeded, but several events appeared in pairs. `1.5.42` adds temporary instrumentation to identify whether the duplicate source is multiple content-script instances, multiple executors in one content-script instance, or duplicate progress writes between content and service worker.

Removal marker:

```text
TEMP-DIAGNOSTIC remove after duplicate queued worker debug
```

Stored diagnostic fields:

- `mbDiagnosticContentInstanceId`
- `mbDiagnosticExecutorId`
- `mbDiagnosticClaimId`
- `mbDiagnosticClaimTabId`
- `mbDiagnosticOwnerTabId`
- `mbDiagnosticRunId`
- `mbDiagnosticItemId`

Event suffix example:

```text
[mbdiag claim=claim-... exec=exec-... inst=...]
```

How to read the next run:

- same claim, executor, and instance on duplicate events means duplicate storage/progress recording
- different executor with same instance means a single content-script instance started more than one executor
- different instance means multiple content-script injections are active in the worker tab
- `Duplicate queued executor suppressed` means the page-global guard caught and stopped a second executor

Remove the diagnostic fields and guard once the root cause is clear.

Validation completed locally:

- `node --check shared/js/content.js`
- `node --check shared/js/sw.js`
- `node --check shared/js/coordinator.js`
- `env npm_config_cache=/scratch/dbrower/.npm-cache npm test`
- `env npm_config_cache=/scratch/dbrower/.npm-cache npm run prod`
- `env npm_config_cache=/scratch/dbrower/.npm-cache npm run build:chrome`
- `env npm_config_cache=/scratch/dbrower/.npm-cache npm run build:firefox`

Built artifacts:

- `chrome/mute_block-1.5.42.zip`
- `firefox/mute_block-1.5.42.zip`

Live validation result:

- Chrome updated to `1.5.42` with zero runtime errors, runtime warnings, or manifest errors
- hard reloaded CrowdOut, Trolls Galore, and Notifications
- ran CrowdOut visible aggregate retry for `Tyler-D-Schafer`
- retry succeeded: source button `Nuked`, profile progress `blocked`, coordinator `succeeded/blocked`, pending rows `0`
- duplicate action events all carried the same diagnostic ids:
  - claim: `claim-1778313541538-jl0xut`
  - executor: `exec-1778313541600-5lttj6`
  - content instance: `1778313540472-c6dd54`
- this means the duplicate events are not from multiple content-script instances and not from multiple queued executors in this run
- current root cause target is duplicate progress recording: content writes the progress event locally, then sends the same event to the service worker, which records it again
- service-worker close/slot events are separate expected events, but the paired action events such as `Mute completed`, `Block flow started`, and `Block completed` should be de-duplicated
- note: final stored diagnostic fields preserved claim id but lost executor/content-instance values because later service-worker writes merged blank diagnostic fields; the event suffixes were the trustworthy evidence

Next patch should remove this temporary diagnostic and fix the duplicate progress write or merge behavior.

## 2026-05-09 1.5.43 Duplicate Progress Fix

`1.5.43` removes the temporary `1.5.42` diagnostic code and fixes the identified duplicate progress-write path.

Change:

- content scripts still update their local in-memory `profileNukeProgress` immediately
- content scripts no longer write progress directly to extension storage when the service worker successfully records the same patch
- direct content storage writes remain as a fallback when `record-nuke-progress` or `record-nuke-progress-batch` does not return `recorded: true`

Expected live validation:

- no fresh `TEMP-DIAGNOSTIC`, `mbDiagnostic*`, or `mbdiag` fields/events
- no paired duplicate content-originated action events for one queued worker executor
- service-worker close/slot events may still appear separately because they are distinct lifecycle events

Validation completed locally:

- `node --check shared/js/content.js`
- `node --check shared/js/sw.js`
- `node --check shared/js/coordinator.js`
- `env npm_config_cache=/scratch/dbrower/.npm-cache npm test`
- `env npm_config_cache=/scratch/dbrower/.npm-cache npm run prod`
- `env npm_config_cache=/scratch/dbrower/.npm-cache npm run build:chrome`
- `env npm_config_cache=/scratch/dbrower/.npm-cache npm run build:firefox`
- `git diff --check`
- verified the temporary diagnostic strings are absent from source and built JS

Built artifacts:

- `chrome/mute_block-1.5.43.zip`
- `firefox/mute_block-1.5.43.zip`

## 2026-05-09 1.5.44 Concurrent Asset Enqueue Fix

Manual testing suggested that two asset tabs queueing at nearly the same time
did not work reliably. The likely root cause was a service-worker race:
concurrent `enqueue-coordinator-items` messages read, modified, and wrote the
same coordinator queue/run/event storage without a shared serialization gate.

Change:

- service-worker coordinator enqueues now run through a serialized promise
  chain
- worker-tab executor staging now prunes existing actions and skips targets
  already queued or active for the same owner/action
- the same duplicate action guard was applied to the older `enqueue-tabs` path

Validation completed locally:

- `node --check shared/js/content.js`
- `node --check shared/js/sw.js`
- `node --check shared/js/coordinator.js`
- `env npm_config_cache=/scratch/dbrower/.npm-cache npm test`
- `git diff --check`
- `env npm_config_cache=/scratch/dbrower/.npm-cache npm run prod`
- `env npm_config_cache=/scratch/dbrower/.npm-cache npm run build:chrome`
- `env npm_config_cache=/scratch/dbrower/.npm-cache npm run build:firefox`

Built artifacts:

- `chrome/mute_block-1.5.44.zip`
- `firefox/mute_block-1.5.44.zip`

Copy status:

- pushed `chrome/` to the Windows laptop through the Cygwin copy tunnel on
  `127.0.0.1:10022`
- remote `chrome/manifest.json`, `chrome/js/content.js`, and `chrome/js/sw.js`
  hashes matched local

Live validation is still pending because the CDP tunnel on `127.0.0.1:9223`
was refusing connections at this checkpoint.

## 2026-05-09 1.5.48 De-Duped Run Accounting Fix

Live `1.5.47` testing in Windows Chrome showed that near-sequential asset
page clicks no longer created duplicate coordinator tabs, but exposed a run
accounting bug for de-duped submissions.

Observed shape:

- clicked `spamdetectives.quora.com` and `takingoutthetrash.quora.com` with
  foreground CDP mouse events
- coordinator count stayed at exactly one
- one enqueue event was `Enqueued 0 new targets and merged 13`
- the run created for that all-merged submission stayed `active` with
  `itemCount: 13`, `activeCount: 0`, and `terminalCount: 0`
- root cause: merged queue items kept their older execution `runId`, so the
  new run had no items to recompute against

Change in `1.5.48`:

- each coordinator run now records `targetProfileHrefs`
- service-worker run recomputation counts items either by item `runId` or by
  the run's target href list
- coordinator UI run display uses the same target-list accounting, so de-duped
  submissions remain visible as their own runs without duplicating execution
  rows

Validation completed locally:

- `node -c shared/js/sw.js`
- `node -c shared/js/coordinator.js`
- `env npm_config_cache=/scratch/dbrower/.npm-cache npm test`
- `git diff --check`
- `env npm_config_cache=/scratch/dbrower/.npm-cache npm run prod`
- `env npm_config_cache=/scratch/dbrower/.npm-cache npm run build:chrome`
- `env npm_config_cache=/scratch/dbrower/.npm-cache npm run build:firefox`

Built artifacts:

- `chrome/mute_block-1.5.48.zip`
- `firefox/mute_block-1.5.48.zip`

Live validation:

- pushed `chrome/` to the Windows laptop through the Cygwin copy tunnel
- remote hashes matched local for `chrome/manifest.json`,
  `chrome/js/content.js`, `chrome/js/sw.js`, and
  `chrome/js/coordinator.js`
- reloaded the unpacked extension through `chrome.developerPrivate.reload`
- Chrome reported Mute Block `version: 1.5.48` with zero runtime errors, zero
  runtime warnings, and zero manifest errors
- hard reloaded asset pages and clicked `spamdetectives.quora.com` and
  `letsplaywhackatroll.quora.com` with foreground CDP mouse events
- new all-merged run `space-feed-1778352342106-qwyvsd` settled to
  `complete`, `itemCount: 1`, `terminalCount: 1`, `targetCount: 1`
- new all-merged run `space-feed-1778352345084-904f70` settled to
  `complete`, `itemCount: 3`, `terminalCount: 3`, `targetCount: 3`
- source buttons ended at `Nuked`, coordinator queue had no active or queued
  items, coordinator count stayed at exactly one during work

Note: old pre-`1.5.48` run records can still lack `targetProfileHrefs`; the
new accounting applies to newly created runs.

## 2026-05-09 1.5.49 Source Reconciliation Fix

Live `1.5.48` stress testing after scrolling asset pages exposed two related
source-page issues:

- scrolled per-post aggregate `Nuke 'Em N` buttons could remain visually idle
  while the top aggregate button showed `Nuking...`
- source pages falsely reconciled coordinator-owned queued work as
  `interrupted` after about 12 seconds, producing many timeout failures with
  `Pending queue state reconciled after stale queued work was found`

Root cause:

- after the coordinator refactor, source pages no longer own worker tabs
- source-page stale reconciliation still used the old owner-tab view of work;
  when `get-owned-nuke-status` returned no source-owned active tabs, the source
  page allowed age-only stale reconciliation for coordinator-owned queue rows

Implemented locally in `1.5.49`:

- per-post aggregate buttons now use pending/busy space-feed entry state, not
  only owner-tab status, when deciding to show `Nuking...`
- source pages no longer convert transient space-feed records to
  `interrupted` solely because they are older than the stale threshold
- source reconciliation still handles explicit terminal/close/error/final
  states

Validation completed locally:

- `node -c shared/js/content.js`
- `env npm_config_cache=/scratch/dbrower/.npm-cache npm test`
- `git diff --check`
- `env npm_config_cache=/scratch/dbrower/.npm-cache npm run prod`
- `env npm_config_cache=/scratch/dbrower/.npm-cache npm run build:chrome`
- `env npm_config_cache=/scratch/dbrower/.npm-cache npm run build:firefox`

Built artifacts:

- `chrome/mute_block-1.5.49.zip`
- `firefox/mute_block-1.5.49.zip`

Live load status:

- not loaded yet
- attempted tar-over-SSH copy through `127.0.0.1:10022`; the SSH process hung
  for over a minute and was killed
- after that, both `127.0.0.1:10022` copy probes and `127.0.0.1:9223` CDP
  probes timed out
- next session should restart both laptop tunnels, re-probe them, push
  `chrome/`, reload the unpacked extension, hard reload the asset pages, and
  re-test the scrolled per-post aggregate button state on fresh candidates

## 2026-05-09 1.5.50-1.5.52 Windows Chrome Verification

After the laptop reboot, both tunnels were restored:

- CDP: `http://127.0.0.1:9223/json/version` returned Chrome 147.
- Copy: `ssh -F /home/dbrower/.ssh/config -p 10022 -o BatchMode=yes
  'DBROWER-X40-J+DBROWER@127.0.0.1' 'echo ok'` returned `ok`.

Loaded versions and findings:

- `1.5.50` fixed a coordinator page that stayed at `Loading` while storage
  showed queued/running work.
- `1.5.51` started syncing coordinator raw queue state from successful
  confirmation paths.
- `1.5.52` also syncs successful progress in service-worker resume/skip paths,
  which cleaned up raw `queued`/`active` coordinator rows left behind by
  completed runs.

Final live state for this pass:

- Windows Chrome loaded Mute Block `1.5.52` from
  `C:\Users\DBROWER\Documents\src\mute-block-main\chrome`.
- Coordinator count was exactly one when opened.
- Coordinator UI showed `queued: 0`, `active: 0`, and the newest one-target
  runs complete.
- Raw `mbCoordinatorQueue` status counts were terminal only:
  `succeeded: 254`, `failed: 127`.
- Chrome extension manager showed zero runtime errors, zero runtime warnings,
  and zero manifest errors.

## 2026-05-10 Failed Coordinator Row Inspection

Live `1.5.52` storage had 127 failed raw coordinator rows:

- 121 rows were stale timeout fallout from the pre-`1.5.49` source-page
  stale-reconcile bug:
  `Pending queue state reconciled after stale queued work was found`
- 5 rows were `action-error` with close reason `terminal-progress-record`
- 1 row was `action-error` with close reason `owner-tab-closed`

Manual failed-row profile checks through visible Windows Chrome:

- `911-Garage-Door-Long-Beach-1`, `Cyber-Jonaki`, and `Dear-son-I-Have`
  loaded as normal profile pages, already showed `BLOCKED`, and only had the
  extension `Close tab` button. Their failed rows were stale/misclassified,
  not current Quora action failures.
- `Ava-West-99` loaded as a normal profile page and was not blocked. It had
  the extension `Mute Block Close`, `Mute Block`, and `Close tab` buttons.
  A CDP mouse click on the visible `Mute Block` button muted the profile,
  opened Quora's block confirmation, clicked through, and reached `BLOCKED`.

The `Ava-West-99` manual kill exposed bookkeeping gaps:

- Direct single-profile action updated `mbProfileNukeProgress` to
  `status: blocked`, `blockSucceeded: true`, but raw `mbCoordinatorQueue`
  temporarily became `active` instead of `succeeded`.
- Explicit `repair-coordinator-storage` then repaired raw queue state, moving
  `Ava-West-99` to `succeeded/blocked`.
- Successful direct action after an older failed row preserved the old
  `terminalAt`, because progress normalization only filled `terminalAt` when
  it was empty.

Implemented locally in `1.5.53`:

- profile progress normalization in both content and service worker refreshes
  `terminalAt` when a record transitions from non-success to success
- profile pages that visibly load as already `BLOCKED` now check whether they
  have a coordinator queue row; if so, they record `already-blocked` progress
  and confirm the associated space-feed entries
- the coordinator page watches `mbProfileNukeProgress` changes for a raw queue
  mismatch and schedules a debounced storage repair, so direct-profile local
  fallback writes can still repair coordinator rows

Live `1.5.53` validation showed the already-blocked profile pages did record
fresh `already-blocked` progress, but their raw coordinator rows remained
failed when no coordinator tab was open to run repair. `1.5.54` added a
content-side repair of the matching raw `mbCoordinatorQueue` row whenever
successful profile progress is written, so this repair does not depend on a
live coordinator tab or service-worker storage-change wakeup.

Live `1.5.54` validation then exposed a multi-tab storage race: three
already-blocked profile tabs reloaded at nearly the same time, and only one
raw queue-row repair survived the whole-map `chrome.storage.local` writes.
`1.5.55` makes the single-row content-side repair read, write, verify, and
retry with short backoffs so concurrent profile tabs converge.

Live `1.5.55` validation:

- extension manager before/after reload showed zero runtime errors, zero
  runtime warnings, and zero manifest errors
- simultaneous hard reload of `911-Garage-Door-Long-Beach-1`,
  `Cyber-Jonaki`, and `Dear-son-I-Have` repaired the two remaining failed
  rows from that set; raw counts moved to `succeeded: 258`, `failed: 123`
- `Elaina-Valzania-1` was already blocked and repaired after hard reload;
  raw counts moved to `succeeded: 259`, `failed: 122`
- opening inactive tabs for `Burning-Memory-2` and `Hemo-Stroid` showed both
  were already blocked and repaired; raw counts moved to `succeeded: 261`,
  `failed: 120`
- sampling stale timeout row `Adelynn-Hopkins` showed it was already blocked
  and repaired; raw counts moved to `succeeded: 262`, `failed: 119`
- all remaining failed rows are now the old timeout class:
  `Pending queue state reconciled after stale queued work was found`

Validation completed locally:

- `node --check shared/js/content.js`
- `node --check shared/js/sw.js`
- `node --check shared/js/coordinator.js`
- `git diff --check`
- `npm test`
- `env npm_config_cache=/scratch/dbrower/.npm npm run prod`
- `env npm_config_cache=/scratch/dbrower/.npm npm run build:chrome`
- `env npm_config_cache=/scratch/dbrower/.npm npm run build:firefox`

Built artifacts:

- `chrome/mute_block-1.5.55.zip`
- `firefox/mute_block-1.5.55.zip`

## 2026-05-10 Failed Retry Control

Decision after inspecting the remaining failed rows:

- the existing 119 failed rows are likely one-time backlog from the old
  stale-reconcile bug, but the right repair mechanism is general
- retry should be coordinator-owned, opt-in, one-at-a-time, and only when idle
- retry should reuse normal profile execution so the current page state decides
  the result:
  already blocked becomes `succeeded/already-blocked`, unblocked profiles run
  mute/block, unavailable profiles skip, and explicit security verification
  remains failed

Implemented locally in `1.5.56`:

- coordinator queue panel has a `Retry Failed` toggle and retryable-failed
  count
- when enabled, the coordinator asks the service worker to retry one failed
  row only when both stored queue state and the tab executor are idle
- retryable failures are `timeout`, `action-error`, or errors containing
  timeout/stale/interrupted text; `security-verification` is not retried
- each retry records `retryCount`, `lastRetryAt`, and `retryReason`, with a
  per-row retry limit of 2
- retries run at concurrency 1 with no foreground fallback and a 45 second
  idle-loop interval from the coordinator page

Validation completed locally:

- `node --check shared/js/content.js`
- `node --check shared/js/sw.js`
- `node --check shared/js/coordinator.js`
- `git diff --check`
- `npm test`
- `env npm_config_cache=/scratch/dbrower/.npm npm run prod`
- `env npm_config_cache=/scratch/dbrower/.npm npm run build:chrome`
- `env npm_config_cache=/scratch/dbrower/.npm npm run build:firefox`

Built artifacts:

- `chrome/mute_block-1.5.56.zip`
- `firefox/mute_block-1.5.56.zip`

Live `1.5.56` validation:

- copied `chrome/` to the Windows laptop through the Cygwin SSH tunnel
- reloaded unpacked Chrome extension from
  `C:\Users\DBROWER\Documents\src\mute-block-main\chrome`
- extension manager showed zero runtime errors, zero runtime warnings, and
  zero manifest errors after reload
- coordinator UI showed `119 retryable / 119 failed`; CDP mouse click on
  `Retry Failed` started the idle retry loop
- first two retry cycles each retried one failed row, recorded
  `Retrying 1 failed target`, and completed as already-blocked success
- raw coordinator counts moved from `succeeded: 262, failed: 119` to
  `succeeded: 264, failed: 117`
- the coordinator retry toggle was left on, with the next check scheduled
  every 45 seconds while the coordinator tab remains open

## 2026-05-10 Coordinator Logo

Implemented locally in `1.5.57`:

- coordinator page title is `Mute Block Coordinator`
- coordinator logo uses the shipped extension logo asset `icons/116.png`
  instead of the temporary text `MB` mark

Live `1.5.57` validation:

- copied `chrome/` to the Windows laptop through the Cygwin SSH tunnel
- reloaded the unpacked Chrome extension
- coordinator `brand-mark` rendered as an `IMG` with `src=icons/116.png`,
  natural size `116x116`, and displayed size `40x40`
- extension manager showed version `1.5.57` with zero runtime errors, runtime
  warnings, or manifest errors

## 2026-05-10 Persistent Idle Retry

Decision:

- the coordinator retry loop should recover automatically after coordinator
  reload or extension reload
- the retry setting is a background-operation preference, so it should stay on
  until the user stops it, even when the current retryable-failed backlog is
  empty
- the old 45 second cadence is too slow for externally loaded queues; use a 5
  second idle check while preserving one-at-a-time retry execution

Implemented locally in `1.5.59`:

- persisted the Retry Failed toggle in storage key
  `mbCoordinatorRetryFailedEnabled`
- coordinator load restores the persisted retry state and starts the loop
  automatically when enabled
- service worker update/startup/storage-change hooks reopen the coordinator
  inactive when persistent retry is enabled and Chrome has closed the
  coordinator tab during extension reload
- retry cadence changed from 45 seconds to 5 seconds
- the retry loop continues polling when idle and empty instead of turning
  itself off at `no-retryable-failed-items`

Validation completed locally:

- `node --check shared/js/content.js`
- `node --check shared/js/sw.js`
- `node --check shared/js/coordinator.js`
- `git diff --check`
- `npm test`
- `env npm_config_cache=/scratch/dbrower/.npm npm run prod`
- `env npm_config_cache=/scratch/dbrower/.npm npm run build:chrome`
- `env npm_config_cache=/scratch/dbrower/.npm npm run build:firefox`

Built artifacts:

- `chrome/mute_block-1.5.59.zip`
- `firefox/mute_block-1.5.59.zip`

Live `1.5.59` validation:

- copied `chrome/` to the Windows laptop through the Cygwin SSH tunnel
- reloaded the unpacked Chrome extension from `1.5.58` to `1.5.59`
- extension manager showed version `1.5.59` with zero runtime errors, runtime
  warnings, or manifest errors
- coordinator page showed `v1.5.59`, one coordinator tab, and `Idle retry is
  off` before enabling the new persisted toggle
- clicking `Retry Failed` stored `mbCoordinatorRetryFailedEnabled: true` and
  changed the UI to `Stop Retry` with `next check every 5s`
- hard reloading the coordinator page restored the enabled retry state from
  storage, showing `Idle retry is on; next check every 5s`
- reloading the extension while the persisted flag was true automatically
  recreated one inactive coordinator tab through the service-worker restore
  hook
- the restored coordinator page showed `v1.5.59`,
  `mbCoordinatorRetryFailedEnabled: true`, `Stop Retry`, and `Idle retry is on;
  next check every 5s (resumed)`
- the live backlog continued draining after resume, moving raw counts from
  `succeeded: 274, failed: 107` to `succeeded: 277, failed: 104`

## 2026-05-10 Space-Feed Slowdown Follow-Up

Live symptom:

- with several large asset-space tabs open, the browser had a huge slowdown
- `spamdetectives` briefly stopped answering even tiny CDP probes such as
  `document.title` and `document.readyState`
- the coordinator retry loop and old queued work were still contributing to
  load

Operational cleanup:

- stopped persistent idle retry; `mbCoordinatorRetryFailedEnabled` is false
- paused/canceled remaining non-terminal coordinator work
- closed four stray profile worker tabs
- directly canceled the remaining raw pending coordinator rows
- final queue snapshot before the performance fix was:
  `succeeded: 300`, `failed: 93`, `canceled: 22`

Implemented locally in `1.5.60`:

- bounded space-feed timestamp scanning to posts within the viewport plus a
  1800px margin
- capped each scan to the nearest 60 timestamps, restoring document order
  after choosing the nearest candidates
- this prevents enormous previously loaded space pages from forcing a full
  historical `a.post_timestamp` scan on each refresh

Live `1.5.60` validation:

- copied `chrome/` to the Windows laptop and reloaded the unpacked extension
- extension manager showed Mute Block `1.5.60` with zero runtime errors,
  warnings, or manifest errors
- hard reloaded `spamdetectives`; page became responsive with 16 timestamps,
  9 post buttons, and `MB Info`
- hard reloaded `ummno`; page became responsive with 20 timestamps, 8 post
  buttons, and `MB Info`

Follow-up implemented locally in `1.5.61`:

- storage-driven progress refresh no longer requests an immediate full
  space-feed rescan on every storage event when no owned work is in flight;
  it debounces the full scan instead
- stale page-local `Nuking... N left` state is cleared when there is no owned
  work and no active pending space-feed URLs
- this addresses the live `takingoutthetrash` tab showing `Nuking... 27 left`
  even though extension storage had no active or queued work

Validation completed locally for `1.5.61`:

- `node --check shared/js/content.js`
- `node --check shared/js/sw.js`
- `node --check shared/js/coordinator.js`
- `git diff --check`
- `npm test`
- `env npm_config_cache=/scratch/dbrower/.npm npm run prod`
- `env npm_config_cache=/scratch/dbrower/.npm npm run build:chrome`
- `env npm_config_cache=/scratch/dbrower/.npm npm run build:firefox`

Built artifacts:

- `chrome/mute_block-1.5.61.zip`
- `firefox/mute_block-1.5.61.zip`

Live `1.5.61` validation:

- copied `chrome/` to the Windows laptop through the Cygwin SSH copy tunnel
- reloaded the unpacked Chrome extension from `1.5.60` to `1.5.61`
- extension manager showed zero runtime errors, zero runtime warnings, and
  zero manifest errors before and after reload
- hard reloaded the six open asset-space tabs through CDP
- all six tabs answered bounded CDP probes with `readyState: complete`,
  visible Mute Block controls, and `MB Info`
- `takingoutthetrash` changed from stale `Nuking... 27 left` to `Done`

## 2026-05-10 KickingAss Slow Page And Scroll Pickup

Live symptom:

- `https://kickingassandtakingnames.quora.com/` loaded slowly and did not pick
  up newly visible posts quickly after scrolling
- a coordinator tab and several profile worker tabs were also open and
  crawling in the background

Operational cleanup:

- closed the coordinator tab and profile worker tabs
- reloaded the unpacked extension to kill remaining in-memory queued executor
  state
- canceled 5 stale raw `queued` coordinator rows and cleared 2 stale pending
  post records
- verified after cleanup that persistent retry was off and the extension had
  zero runtime errors, warnings, or manifest errors

Implemented locally in `1.5.62`:

- visible space-feed discovery now samples the viewport using
  `document.elementsFromPoint()` and nearby feed-card ancestors before falling
  back to a full `a.post_timestamp` scan
- scroll idle now schedules a real bounded space-feed rescan instead of only
  refreshing controls from the previous cached entry set
- this keeps initial load away from a full historical timestamp query on normal
  visible pages and lets already-loaded posts get controls soon after the user
  scrolls to them

Validation completed locally for `1.5.62`:

- `node --check shared/js/content.js`
- `node --check shared/js/sw.js`
- `node --check shared/js/coordinator.js`
- `git diff --check`
- `npm test`
- `env npm_config_cache=/scratch/dbrower/.npm npm run prod`
- `env npm_config_cache=/scratch/dbrower/.npm npm run build:chrome`
- `env npm_config_cache=/scratch/dbrower/.npm npm run build:firefox`

Built artifacts:

- `chrome/mute_block-1.5.62.zip`
- `firefox/mute_block-1.5.62.zip`

Live `1.5.62` validation:

- copied `chrome/` to the Windows laptop through the Cygwin SSH copy tunnel
- reloaded the unpacked Chrome extension from `1.5.61` to `1.5.62`
- hard reloaded `kickingassandtakingnames`; the page answered bounded CDP
  probes with `readyState: complete`, `MB Info`, and 2 visible post controls
- after one CDP wheel scroll and a short idle wait, the page updated to 18
  visible post controls
- extension manager showed Mute Block `1.5.62` with zero runtime errors, zero
  runtime warnings, and zero manifest errors
- no profile worker tabs and no coordinator tabs were open after validation

## 2026-05-10 Mismatched Nuking Count Labels

Live symptom:

- `/home/dbrower/odd.png` showed the top aggregate button at
  `Nuking... 4 left` while visible post controls showed `Nuking... 5 left`
  and `Nuking... 1 left`
- storage at the time had only terminal coordinator rows and no pending post
  records, so this was a stale/immediate UI-label issue rather than durable
  queue state

Implemented locally in `1.5.63`:

- after enqueue and after sweep fallback, the clicked button now formats its
  label from `getLiveSpaceFeedEntries(getLatestSpaceFeedEntries())`
- before this, that immediate label used all cached entries, while the top
  aggregate used only live queueable/pending entries; the scopes could disagree
  until a later sync

Validation completed locally for `1.5.63`:

- `node --check shared/js/content.js`
- `node --check shared/js/sw.js`
- `node --check shared/js/coordinator.js`
- `git diff --check`
- `npm test`
- `env npm_config_cache=/scratch/dbrower/.npm npm run prod`
- `env npm_config_cache=/scratch/dbrower/.npm npm run build:chrome`
- `env npm_config_cache=/scratch/dbrower/.npm npm run build:firefox`

Built artifacts:

- `chrome/mute_block-1.5.63.zip`
- `firefox/mute_block-1.5.63.zip`

Live `1.5.63` validation:

- copied `chrome/` to the Windows laptop through the Cygwin SSH copy tunnel
- reloaded the unpacked Chrome extension from `1.5.62` to `1.5.63`
- extension manager showed Mute Block `1.5.63` with zero runtime errors, zero
  runtime warnings, and zero manifest errors
- coordinator queue storage had no non-terminal rows and pending post storage
  was empty after reload

## 2026-05-10 Profile Followers Modal Nuke Source

Live symptom:

- on `https://www.quora.com/profile/Adam-Troy-62`, the followers modal nuke
  button displayed `Nuked`, but the visible follower profiles had not been
  queued
- live inspection found 80 visible follower rows, 10 rows marked as opened,
  and zero `mbProfileNukeProgress` records for all 80 visible follower profile
  URLs

Root cause:

- modal open and modal nuke used the same `mbOpened`/handled tracking, so
  profiles opened from the modal could be skipped by the nuke source even
  though they had not been muted/blocked
- existing modal buttons could survive extension reloads with stale DOM state;
  the modal nuke button did not rebind to the current content-script instance
  or reset a stale `done/Nuked` state when queueable rows were visible

Implemented locally in `1.5.64`:

- split modal tracking into opened rows and nuke-queued rows
- modal `Open Followers` now uses only opened-row tracking
- modal `Nuke 'Em` now uses independent nuke-queued tracking and can still
  queue rows that were previously opened
- existing modal open/nuke buttons are rebound to the current content-script
  instance
- stale `Nuked` state is reset when nukeable rows are visible

Validation completed locally for `1.5.64`:

- `node --check shared/js/content.js`
- `node --check shared/js/sw.js`
- `node --check shared/js/coordinator.js`
- `git diff --check`
- `npm test`
- `env npm_config_cache=/scratch/dbrower/.npm npm run prod`
- `env npm_config_cache=/scratch/dbrower/.npm npm run build:chrome`
- `env npm_config_cache=/scratch/dbrower/.npm npm run build:firefox`

Built artifacts:

- `chrome/mute_block-1.5.64.zip`
- `firefox/mute_block-1.5.64.zip`

Live `1.5.64` validation:

- copied `chrome/` to the Windows laptop through the Cygwin SSH copy tunnel
- reloaded the unpacked Chrome extension from `1.5.63` to `1.5.64`
- extension manager showed Mute Block `1.5.64` with zero runtime errors, zero
  runtime warnings, and zero manifest errors
- existing already-open Quora tabs still need a page reload to get the new
  content-script logic

## 2026-05-10 Adam Troy Followers Modal Scroll-Walk

Live symptom:

- on `https://www.quora.com/profile/Adam-Troy-62`, the followers modal showed
  `217 followers`, but modal `Nuke 'Em` only acted on the initially loaded
  follower block instead of scrolling the modal to discover the rest

Implemented locally:

- `1.5.69` added modal scroll-walking for follower/following modal nuke
  discovery
- live test showed `1.5.69` still waited for the first worker queue response
  before scrolling, so worker startup latency could cap discovery at the first
  loaded rows
- `1.5.70` changed modal nuke to walk and mark the modal first, collect the
  discovered URL set, then submit one `enqueue-tabs` request with a bounded
  response wait
- `1.5.71` keeps modal controls disabled and the nuke button visibly
  `Nuking...` while modal nuke is active, even if Quora mutations cause button
  reinjection
- `1.5.72` sets `noForegroundFallback: true` on modal `Nuke 'Em` worker-tab
  enqueue requests. The live `1.5.70` run used the older modal enqueue shape
  and could bring each worker profile tab to the foreground when action probing
  stalled in the background.
- `1.5.73` fixes the Chrome restart path where a re-opened space page could
  show `Nuking...` without a coordinator. Live storage on the restarted
  `instantblock` page had no non-terminal coordinator rows and no owned work,
  but it still had one stale `mbSpacePendingNukedPosts` row from a Q Defense
  post whose profile progress had reached `tab-opened` and `slotReleasedAt`.
  The stale pending row made unrelated space pages enter the unknown-active
  UI state. Restart reconciliation now treats `slotReleasedAt` as stale
  transient evidence, marks the profile progress interrupted, and removes it
  from pending space-feed storage.

Live validation:

- copied and loaded `1.5.70` in Windows Chrome through the CDP/copy tunnels
- hard-reloaded the Adam Troy profile tab and reopened the followers modal
- clicked modal `Nuke 'Em` with real CDP mouse events
- the modal scroller advanced from the initially loaded block to `217`
  listitems and `218` profile links including the owner link
- after idle-scroll stop, the queue request started worker tabs; extension
  storage showed the modal run had queued about 194 modal-discovered targets,
  with 180 still queued and several already blocked/active in the first
  follow-up sample
- extension manager still showed Mute Block `1.5.70` with zero runtime errors,
  zero runtime warnings, and zero manifest errors
- `1.5.71` was built and copied to the laptop but not loaded immediately,
  because reloading the extension during the active modal run would risk losing
  the old executor's in-memory `enqueue-tabs` queue

Validation completed locally for `1.5.71`:

- `node --check shared/js/content.js`
- `node --check shared/js/sw.js`
- `node --check shared/js/coordinator.js`
- `git diff --check`
- `npm test`
- `env npm_config_cache=/scratch/dbrower/.npm npm run prod`
- `env npm_config_cache=/scratch/dbrower/.npm npm run build:chrome`
- `env npm_config_cache=/scratch/dbrower/.npm npm run build:firefox`

Built artifacts:

- `chrome/mute_block-1.5.71.zip`
- `firefox/mute_block-1.5.71.zip`

Validation completed locally for `1.5.72`:

- `node --check shared/js/content.js`
- `node --check shared/js/sw.js`
- `node --check shared/js/coordinator.js`
- `git diff --check`
- `npm test`
- `env npm_config_cache=/scratch/dbrower/.npm npm run prod`
- `env npm_config_cache=/scratch/dbrower/.npm npm run build:chrome`
- `env npm_config_cache=/scratch/dbrower/.npm npm run build:firefox`

Built and copied artifacts:

- `chrome/mute_block-1.5.72.zip`
- `firefox/mute_block-1.5.72.zip`
- unpacked `chrome/` copied to the Windows laptop; manifest/content/sw hashes
  matched after copy

Validation completed locally for `1.5.73`:

- `node --check shared/js/content.js`
- `node --check shared/js/sw.js`
- `node --check shared/js/coordinator.js`
- `git diff --check`
- `npm test`
- `env npm_config_cache=/scratch/dbrower/.npm npm run prod`
- `env npm_config_cache=/scratch/dbrower/.npm npm run build:chrome`
- `env npm_config_cache=/scratch/dbrower/.npm npm run build:firefox`

Live `1.5.73` validation:

- copied unpacked `chrome/` to the Windows laptop and verified
  `manifest.json`, `js/content.js`, and `js/sw.js` hashes
- reloaded the unpacked extension from `1.5.72` to `1.5.73`; extension manager
  showed zero runtime errors, runtime warnings, and manifest errors
- hard-reloaded the restarted `instantblock` tab
- the top button changed from stale `Nuking... 1 left` to idle `Nuke 'Em`
  with current candidates, and post aggregate buttons changed to idle
  `Nuke 'Em 4`
- `mbSpacePendingNukedPosts` was empty after reconciliation
- the stale `Wam-Bui-1` profile progress row was marked `interrupted` with
  event `Reconciled stale pending queue state`
- no coordinator tab was opened because the coordinator queue had no
  non-terminal rows; stored queue state was `376 succeeded`, `116 failed`,
  and `3 canceled`

Built artifacts:

- `chrome/mute_block-1.5.73.zip`
- `firefox/mute_block-1.5.73.zip`

## 2026-05-10 Kicking Loaded During Active Coordinator Run

Live symptom:

- `https://kickingassandtakingnames.quora.com/` was opened while the
  coordinator was actively working Instant Block items
- buttons eventually appeared, but Kicking showed `Nuking... 5 left` for five
  visible Kicking profiles that had not been queued

Live evidence:

- coordinator storage had `17 queued` and `1 active`, all from the current
  active run
- `mbSpacePendingNukedPosts` had 20 pending rows, all with
  `spaceUrl: https://instantblock.quora.com`
- the five Kicking profiles shown in the button help text were not in
  `mbCoordinatorQueue`, not in `mbProfileNukeProgress`, and not in
  `mbSpacePendingNukedPosts`

Root cause:

- space-feed UI used global `hasActivePendingSpaceFeedWork()` inside unknown
  active-state checks
- pending work from any space could make an unrelated space page render all of
  its own visible candidates as `Nuking...`

Implemented locally in `1.5.74`:

- `hasActivePendingSpaceFeedWork()` can now be scoped to the current page's
  known entries
- active/unknown space-feed button state no longer uses global pending work
  from other spaces
- stale local busy-state cleanup also scopes pending checks to current page
  entries

Follow-up in `1.5.75`:

- when any space-feed pending work exists, a page whose viewport timestamp
  sampling misses no longer falls back to scanning every `a.post_timestamp` in
  the document
- this keeps newly loaded asset pages responsive during coordinator work; they
  may briefly show no feed controls or `Scanning...` until a cheap viewport
  sample succeeds or the operator scrolls, but they should not block Chrome on
  a full-document layout scan

Follow-up in `1.5.76`:

- the Kicking asset-space tab still had no feed controls after the `1.5.75`
  responsiveness fix
- isolated content-script diagnostics showed `pageType: null`,
  `timestampCount: 18`, and `postLike: 192`
- root cause: the page had enough post markup to operate on, but the old
  `.puppeteer_test_tribe_info_header` space marker was absent, so scheduling
  stopped before the feed-control path
- fix: add a conservative Quora subdomain root-page fallback for `getPageType`
  using cheap DOM/resource markers only

Follow-up in `1.5.77`:

- hard reloading Kicking with `1.5.76` showed no page-side exceptions, but no
  `.mb-ext_space-feed-*` controls appeared
- visible timestamps and the tab bar were present, so the remaining miss was
  scheduling rather than candidate scanning
- fix: the mutation observer now schedules space-feed control sync when the
  page is recognized as a space and the status control is missing, not only
  when that mutation contains a structural feed signal

Follow-up in `1.5.78`:

- hard reloading Kicking with `1.5.77` still showed no controls and no
  exceptions after 10 seconds
- root cause refinement: late recognition can happen after useful mutations
  have already passed, so observer-only recovery is insufficient
- fix: add delayed space-page follow-ups at `800ms`, `2s`, `5s`, and `10s`
  after startup/navigation; the follow-ups are cheap unless `getPageType()`
  has become `space`

Follow-up in `1.5.79`:

- hard reloading Kicking with `1.5.78` still showed no feed controls, but the
  category host appeared, proving delayed activation was running
- the remaining pre-sync blocker is the owned-work status message to the
  service worker; that read now times out after `2500ms`
- expected behavior: feed controls render using a normalized zero-status
  fallback if the service worker is slow, then later refresh as storage/status
  changes arrive

Follow-up in `1.5.80`:

- hard reloading Kicking with `1.5.79` produced `MB Info` and `Scanning...`,
  with `26` document timestamps but `0` scanned entries
- root cause refinement: viewport sampling missed posts on that layout while
  active pending work still prevented the old full-document fallback
- fix: add a bounded timestamp fallback for the active-pending case; it checks
  no more than `160` timestamp candidates, avoiding the old unbounded layout
  scan while recovering controls on pages where point sampling misses

## 2026-05-10 Built-In Chrome Observation Attempt

Goal:

- capture Chrome built-in tracing while the operator opened space pages from
  notifications during an active coordinator queue

Result:

- browser-wide tracing started through CDP at
  `http://127.0.0.1:9223/json/version`
- after `Tracing.end`, a second browser-level connection reported
  `Tracing is not started`, so Chrome did receive an end request
- the original trace reader never drained the returned stream over the reverse
  tunnel and no trace file was written; it had to be interrupted

Lesson:

- the first trace configuration was too heavy for this tunnel/run
- next trace attempt should use a shorter capture and fewer categories, and
  write `IO.read` chunks incrementally rather than buffering the whole stream
  in memory before writing the file

Current-state evidence captured during/after the run:

- extension `1.5.80`, zero extension errors/warnings
- one coordinator tab and the Mute Block service worker were present
- queue moved from `56 queued / 1 active / 420 succeeded / 99 failed` to
  `49 queued / 2 active / 426 succeeded / 99 failed`
- one deeper Runtime evaluation against extension/page targets hung for more
  than 10 seconds while `/json/version` stayed responsive
- lightweight `Performance.getMetrics` showed one Quora profile page
  (`Joe-Goode-2`) timing out even on `Performance.enable`; another profile
  target returned an empty protocol error
- this points at renderer/extension-target responsiveness under queue load,
  not the SSH tunnel itself

Follow-up two-load experiment:

- Chrome still reported `Tracing has already been started` after the aborted
  trace readers, so built-in tracing could not be restarted without a browser
  restart
- used a CDP `Performance.getMetrics` sampler instead, every two seconds for
  `45s`, while the operator loaded two notification pages
- output: `/tmp/mute-block-two-load-metrics-1778431577350.jsonl`
- new pages observed during the sample:
  - `Spider-602` profile, responsive to metrics, initial
    `TaskDuration: 0.047306`, `ScriptDuration: 0.026082`
  - `Starbull-2` profile, responsive to metrics, initial
    `TaskDuration: 0.036522`, `ScriptDuration: 0.016561`
- persistent stuck/slow worker evidence:
  - `Joe-Goode-2` profile was present throughout all 7 snapshots and timed out
    on every `Performance.enable`
  - `Simon-Adeyi-1` had one `Performance.enable-timeout` before later becoming
    responsive and disappearing
- coordinator CPU was low during the sample (`TaskDuration` delta about
  `0.004s`), and the opened notification/space pages showed little incremental
  task time
- current best hypothesis: queue worker profile tabs can get into a renderer
  state where even CDP `Performance.enable` cannot complete; these stuck
  worker renderers likely compete with normal notification/space page loads
  more than the coordinator page itself does

Follow-up stuck-worker repro:

- `Joe-Goode-2` was confirmed as the stuck worker tab and closed through CDP:
  `PUT http://127.0.0.1:9223/json/close/6A746A01F8C7B6EA891A8DBD032FCA87`
- after the tab closed, the stored coordinator queue row still showed
  `status: active`, `tabId: null`, while profile progress still showed
  `status: tab-opening`
- root cause: after a service-worker lifecycle reset, the in-memory
  `queuedTabMetadata`/`activeQueuedTabs` state can be gone, so
  `tabs.onRemoved` cannot release or terminalize the stored active row
- intended `1.5.81` fix: persist worker `tabId` in profile progress, carry it
  into coordinator queue rows, and let coordinator repair convert stale
  persisted active/transient rows into timeout failures when the tab is gone
  or when the exact persisted worker tab id needs to be closed
- follow-up `1.5.82` hardening: content progress writes and coordinator
  control messages are bounded so a non-responsive service worker cannot
  indefinitely block local progress persistence or the coordinator UI. The
  service-worker `repair-coordinator-storage` action now returns after storage
  repair and resumes execution in the background.
- follow-up `1.5.83` correction: stale persisted-active detection uses worker
  stage timestamps (`tabCreatedAt`, `tabOpenedAt`, `contentOpenedAt`,
  `actionReadyAt`, action attempts) rather than generic `updatedAt`, because
  progress normalization can refresh `updatedAt` without real worker progress.
- live validation after loading `1.5.83`: Chrome extension manager showed
  version `1.5.83` with zero runtime, manifest, or install-warning errors.
  Raw coordinator queue counts settled to `succeeded: 473`, `failed: 101`,
  `skipped: 5`, `canceled: 3`, and no `active`, `queued`, or `settling` rows.
  `Joe-Goode-2` was repaired to `succeeded/already-blocked`; the remaining
  stale active row (`Vusal-Aliyev-35`) was also terminalized.
