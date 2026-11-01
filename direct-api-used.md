# Direct Quora API Use — Research Findings (parked)

> **Status: DEAD-END** (24 Oct 2026). Direct Quora API research, parked. Mutations (block, mute) through the private endpoint were declined because they bypass the anti-bot token check. Reads parked. Dead end. Do not reopen without an owner decision. See [dead ends](docs/dead-ends.md). Register: [notes register](docs/notes-register.md).

Status: **parked**. Not scheduled; revisit after other stabilization work lands.
Origin: live research session against the repo's local CDP debug Chrome
(`npm run launch:chrome-dev`, port 9222), driving real profile pages while
capturing network traffic.

## The question

Quora's mute/block/follow actions (and follower/following/mute/block list
views) are currently driven entirely by clicking through the real Quora UI —
opening the overflow menu, clicking a menu item, clicking a confirm dialog.
This is fragile: see the menu-automation struggles in this same session (cookie
consent overlay eating synthetic clicks, backgrounded tabs silently failing to
open popovers, popover close-on-reopen races). The question was whether these
actions could instead be invoked as direct API calls.

## What Quora's web client actually does

All of it is GraphQL with **persisted queries** — the client never sends query
text, only an operation name plus a server-side hash:

```
POST https://www.quora.com/graphql/gql_POST?q=<operationName>
Content-Type: application/json

{"queryName":"<operationName>","variables":{...},"extensions":{"hash":"<sha256>"}}
```

### Captured operations

| Operation | Variables | Notes |
| --- | --- | --- |
| `userBlockModalInnerUtils_userSetBlock_Mutation` | `{targetUid: <int>, shouldBlock: <bool>}` | hash `fc7232c06fc858107eba5ff2469a96639fc5834eb503cb2d1db2793e89770527`. Response: `data.userSetBlock.targetUser.isBlockedByViewer`. Used for both block and unblock (toggle via `shouldBlock`). |
| `UserMute_userMute_Mutation` | `{uid: <int>}` | hash `c8f2533d8e1ad8fbdf8a33f9bc4ac45498c7363d04320722909a36a343b82cf8`. Response: `data.userMute.user.viewerHasMuted`. Only captured the mute direction; unmute mutation name not yet captured (likely a sibling, e.g. `UserMute_userUnmute_Mutation` — unconfirmed). |

### Followers / following — now fully captured, with a working extraction

Full details, hashes, and a working extraction script's output are in
[`experiments/quora-direct-api/README.md`](experiments/quora-direct-api/README.md).
Summary:

| Operation | Variables | Notes |
| --- | --- | --- |
| `UserProfileFollowersModalQuery` | `{uid}` | hash `e92dcb2fdc01dacffb61e9beac5a90cca4d6a2d8a715667c8600788725db8a1b` |
| `UserProfileFollowers_ProfileTopics_Query` | `{uid, first, after}` | hash `48b9f7dbeea78efaffe11c436288c9532f564494f32f4291b2938eed9289cd3f`. Response: `data.user.followerUsersConnection.{edges,pageInfo}` |
| `UserProfileFollowingPeople_ProfileTopics_Query` | `{uid, first, after}` | hash `6b80f923dcdf7727dd5755dd7425ad988bc2f3e27f7a3391fd39507f906e8d9b`. Response: `data.user.followingUsersConnection.{edges,pageInfo}` |

Standard Relay cursor pagination (`pageInfo.hasNextPage`/`endCursor`).
Extracted via the same "one real click mints a token, then raw `fetch()` for
every subsequent page" pattern as the block/mute finding above — confirmed
the token survives 40+ sequential calls, not just one reuse. Following came
back complete (448/448); followers stopped at 2,010 of the displayed 3,945
stat with a clean `hasNextPage: false`, not an error — cause not yet
diagnosed (see the experiments README for the two leading theories).

`TribePeopleModalQuery`, `TribeContributorOrHigherListQuery` (Space
people/contributor lists) are still just known operation names from
`swBootstrap.js:1158-1167`, not captured.

### Blocked & muted list — blocked by a live Quora bug, not by us

`https://www.quora.com/settings/muting` (operation name `MutingSettingsLoadableQuery`)
is currently broken on Quora's own frontend — confirmed independently by a
user hard-reload and reproduced here across a fresh tab, full navigation, and
with the service worker bypassed. Zero network requests are ever attempted
for the query, so no hash was ever captured. Full detail in the experiments
README. Revisit by retrying the page later.

## Auth / anti-automation surface

Every mutation carries these headers, beyond the normal session cookies:

- `Quora-Formkey` — session-scoped CSRF-style token
- `Quora-Revision`, `Quora-Canary-Revision` — frontend build identifiers
- `Quora-Window-Id`, `Quora-Broadcast-Id` — tied to the page's realtime
  (websocket) channel
- `Quora-Turnstile-Token` — a real Cloudflare Turnstile token. Confirmed
  `window.turnstile` (the actual Cloudflare Turnstile client) is loaded on
  the page and is what produces this value. This is deliberate anti-bot
  infrastructure, not a static secret.

A standalone script outside a real browser cannot produce a valid Turnstile
token — that's the whole point of Turnstile. This rules out an
out-of-process API client.

## The finding that makes this actually viable: key reuse

Tested directly (live, this session): drove **one real UI click** to mute a
profile (menu → Mute → Confirm), captured that network request's headers and
the target's numeric uid out of its own `variables`, then issued the
**block** mutation as a raw `fetch()` **from inside the content script's page
context**, reusing those exact headers verbatim, with zero further clicks.

Result: `{"data":{"userSetBlock":{"targetUser":{"isBlockedByViewer":true}}}}`,
HTTP 200. Confirmed for real after a page reload (server-side state, not just
a local echo).

**This means the `Quora-Turnstile-Token` is not single-use or
action-specific** — it survived reuse for a second, different mutation
within the same page session. That was the open question going in; it's
resolved. A fetch made from the already-loaded tab inherits a token the page
already solved, cookies included, for free.

## Why this is a genuinely different proposition than "call the API cold"

- Because the fetch runs in the page's own origin/context, it's not
  adversarial against Quora's bot detection the way an external script would
  be — it's reusing a challenge the real browser already passed, the same way
  any other same-page `fetch()` would.
- Failure is self-detecting, not silent: a stale/rotated persisted-query hash
  or a rejected token comes back as a clear non-200 / GraphQL error payload,
  which is an unambiguous trigger to fall back to the existing DOM-click
  automation. That fallback shape ("try the fast path, fall back to the
  known-good path on a clean failure signal") is consistent with patterns
  already used elsewhere in `content.js`.

## Open risk / unknowns for when this is picked back up

1. **Persisted-query hashes are undocumented and can rotate on any Quora
   frontend deploy** with no notice. This is the main long-term fragility —
   needs periodic re-discovery (capture-and-compare), not a one-time
   hardcode-and-forget.
2. Token lifetime/reuse limits beyond "survived one extra call seconds
   later" are unknown — not tested across a longer session, across page
   reloads, or across many rapid-fire calls (could trip rate limiting or a
   stricter anti-abuse heuristic even though the single-token-reuse case
   works).
3. Resolving a profile's numeric `targetUid` without a UI click is assumed
   feasible (Quora's own page needs it to render the Block button, so it's
   likely already in page state/Apollo cache) but **not yet located or
   confirmed**.
4. Unmute mutation name, follow/unfollow mutation names, and the
   follower/following/mute/block **list** query bodies (hashes + variables)
   are not yet captured — only their operation names (follow lists) are
   known, and even that's incomplete (no muted/blocked list operation found
   yet).
5. Replaying undocumented internal endpoints is a different risk profile
   from clicking real buttons if Quora ever audits traffic patterns —
   account-safety tradeoff to weigh before shipping this, not just an
   engineering one.

## Recommended shape when this is revisited

Try-direct-fetch-first, fall back to existing click automation on any
non-200/error response — per action, not globally. Start with block/unblock
and mute (mutations already captured in full); leave list-fetching and
unmute/follow for a follow-up pass once their operations are captured the
same way.
