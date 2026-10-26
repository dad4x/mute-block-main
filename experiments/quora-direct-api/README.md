# Quora direct-API extraction experiments

> **Status: DEAD-END** (24 Oct 2026). Direct API extraction experiments. Mutations declined; reads parked. Same decision as direct-api-used.md. Dead end. Do not reopen without an owner decision. See [dead ends](../../docs/dead-ends.md). Register: [notes register](../../docs/notes-register.md).

Live research against the local CDP debug Chrome instances (ports 9222 and
9223, both logged in as the same account). Goal: extract your own followers,
following, blocked, and muted lists via direct GraphQL calls instead of UI
button-pushing, building on the mute/block mutation findings in
[`direct-api-used.md`](../../direct-api-used.md).

## Result summary

| List | Method | Result |
| --- | --- | --- |
| Following (people) | Direct API, paginated | **448 / 448** — complete |
| Followers | Direct API, paginated | **2,010 / 3,945** (stat) — see below |
| Blocked & Muted | Direct API | **Blocked** — Quora's own settings page is broken right now (see below), so the operation's hash was never captured |

Full extracted data: [`followers-following-extracted.json`](followers-following-extracted.json)
(`{followersCount, followingCount, followers: [...], following: [...]}`, each
entry has `uid`, `name`, `profileUrl`, `isBlocking`, `isBlockedByViewer`,
`viewerIsFollowing`, `viewerIsFollowedBy`).

Raw captured request/response traffic from each discovery step is kept
alongside this file (`*-capture*.json`, `*-page-capture.json`, etc.) for
reference — operation names, hashes, and example payloads are all in there if
the extraction script ever needs to be rebuilt.

## Operations discovered this round

| Operation | Variables | Hash | Notes |
| --- | --- | --- | --- |
| `UserProfileFollowersModalQuery` | `{uid}` | `e92dcb2fdc01dacffb61e9beac5a90cca4d6a2d8a715667c8600788725db8a1b` | First page / modal header (follower/following counts, viewer's own user record) |
| `UserProfileFollowers_ProfileTopics_Query` | `{uid, first, after}` | `48b9f7dbeea78efaffe11c436288c9532f564494f32f4291b2938eed9289cd3f` | Followers pagination. Response: `data.user.followerUsersConnection.{edges,pageInfo}` |
| `UserProfileFollowingPeople_ProfileTopics_Query` | `{uid, first, after}` | `6b80f923dcdf7727dd5755dd7425ad988bc2f3e27f7a3391fd39507f906e8d9b` | Following-people pagination. Response: `data.user.followingUsersConnection.{edges,pageInfo}` |
| `MutingSettingsLoadableQuery` | unknown | unknown | Named only — see "Blocked & Muted page is broken" below. Never captured on the wire. |

Standard Relay cursor pagination: `pageInfo.hasNextPage` / `pageInfo.endCursor`,
`after` is a literal numeric-offset string (`"9"`, `"19"`, ...). Extraction
script used `first: 50` per page.

Each `edge.node` in both connections carries `isBlocking`, `isBlockedByViewer`,
`viewerIsFollowing`, `viewerIsFollowedBy` per user — useful byproduct: you can
infer a lot about relationship state from the followers/following connections
themselves, without a dedicated blocked-list endpoint.

## How the extraction worked

Same pattern validated in `direct-api-used.md`: one real UI click (opening
the followers modal) to mint a fresh `Quora-Formkey` / `Quora-Turnstile-Token`
/ `Quora-Window-Id` / `Quora-Broadcast-Id` set, then every subsequent page of
both connections was fetched as a raw `fetch()` from inside the page context
(not simulated clicks, not a new browser), reusing those same headers
end-to-end. The token survived the entire run (~40+ sequential calls) with no
re-mint needed.

## Followers: 2,010 vs the 3,945 stat — open question

The pagination loop terminated cleanly (`pageInfo.hasNextPage: false`) at
2,010 followers, not an error. The last entries returned are ordinary,
unremarkable accounts — nothing suggesting a server-side rejection. The
`3,945` figure is Quora's own displayed stat (`user.followerCount` from the
same query). Two most likely explanations, neither confirmed:

1. Quora caps how deep the followers **connection** can be paginated
   (independent of the displayed counter), e.g. for performance/abuse
   reasons.
2. The displayed counter includes accounts that are excluded from the
   paginated connection for some other reason (deleted/suspended/privacy).

Not investigated further this round. If this matters later, worth testing
from the *last* UI-reachable page in the real followers modal to see if the
browser's own UI hits the same wall (would confirm it's server-side, not an
artifact of our direct calls).

## Blocked & Muted settings page is broken (not us)

`https://www.quora.com/settings/muting` fails to load its content —
confirmed independently by the user doing a hard reload in the visible
browser window, and separately reproduced here: fresh tab, full page
navigation, and with the service worker bypassed via CDP all produce the
same result. Console shows:

```
Error (QueryFetcher): MutingSettingsLoadableQuery Unexpected text/html response to GraphQL request
TempFailureError: Unexpected text/html response to GraphQL request
    at o (https://qsbr.cf2.quoracdn.net/-4-ans_frontend-relay-rspack-common-27-85079cc0781428ae.webpack:177:493)
Error (PageLoadable): Showing default error state: {"errorMessage":"Unexpected text/html response to GraphQL request"}
```

Critically, **zero network requests were ever observed** for this query
across every attempt (confirmed via full network capture, not just the
graphql-filtered one) — the failure happens before any fetch leaves the
browser, which points at a broken/missing code-split chunk for this specific
route rather than a server-side rejection of a real request. We never
captured a real request for `MutingSettingsLoadableQuery`, so no hash is
known for it.

This is a genuine bug on Quora's current frontend build, not something
fixable from our side. Revisit by just trying the page again later — if/when
it starts working, repeat the same capture-then-extract approach used here
for followers/following.
