# Queue Validation Coordinator Handoff - 2026-06-17

## Objective

Reach a live 300-element queued run with:

- all legitimate rows successful,
- `0` soft-fail,
- `0` hard-fail,
- `0` queued,
- `0` active,
- `0` stray profile tabs,
- extension errors `0`.

Current state is still well before that gate. The lane remains blocked on cleanup of old enqueue paths and then asset-space candidate correctness.

## Policy Direction

The enqueue source policy is now explicit:

- The only allowed source of enqueue data is product code itself collecting candidates from the live page.
- Do not use operator-supplied URL intake.
- Do not use flattened file input.
- Do not use `reviewed-profile-list`.
- Do not use `tools/cdp/enqueue-visible-profile-search.js --urls-file`.
- Do not use inline `--urls`.

For live validation, use only:

1. a real asset-categorized Quora space,
2. product collection of candidates in that space,
3. the product `Nuke 'Em` path.

## Current Code Reality

As of this handoff, `tools/cdp/enqueue-visible-profile-search.js` still has the retired path live:

- `readUrlsFile()` still exists,
- `parseExplicitUrls()` still exists,
- `--urls-file` still feeds enqueue input,
- inline `--urls` still feeds enqueue input,
- explicit intake is still relabeled as `reviewed-profile-list`.

No cleanup patch landed yet.

## Worker Attempts

Three worker attempts were made to retire the old helper intake path.

Result:

- none returned a usable patch,
- none changed the file,
- all stalled on a task that should have been narrow and fast.

Coordinator conclusion:

- do not assume this was only prompt ambiguity,
- tooling or sandbox friction is likely involved,
- repeated respawn of the same tiny task was not productive.

## Process / Runner Finding

A direct process-tree check found a real sandbox hang:

- PID `2366108`
- process: `bwrap`
- state: `D`
- wait channel: `autofs_wait`

The stuck command tail showed sandbox startup ending in:

```text
-- /usr/bin/true
```

Implication:

- at least one sandboxed helper process is stuck in uninterruptible automounter wait,
- this is a plausible explanation for the repeated bad worker behavior,
- normal task delegation may remain unreliable until that runner issue clears.

Do not keep spawning more tiny workers blindly while this condition persists.

## Explorer Finding

A read-only explorer pass found that operator-facing cleanup scope is narrow:

- the main live retirement surface is `tools/cdp/enqueue-visible-profile-search.js`,
- the current handoff note already states the correct live policy,
- no broader README or operator-doc cleanup was identified as necessary right now,
- `tmp/quora-reporting-assets.*` should remain diagnostic evidence only.

## Immediate Next Step

The next concrete code task remains:

1. retire all operator-supplied enqueue intake in `tools/cdp/enqueue-visible-profile-search.js`.

Required end state:

- `--urls-file` fails nonzero before any CDP connection,
- inline `--urls` fails nonzero before any CDP connection,
- failure message:

```text
flattened URL-file enqueue is disabled; use in-space collect candidates plus in-space nuke button
```

- the unreachable `reviewed-profile-list` branch is removed or made impossible,
- the live page-collection path from a real Quora page remains intact.

Because of the current runner finding, the next coordinator should first decide whether to:

- wait for runner health to recover,
- use a different execution path for the narrow edit,
- or avoid more worker delegation until the sandbox issue is understood.

## Next Product Diagnosis After Helper Retirement

Once the old helper intake path is actually retired, the next likely product hotspot is:

- `shared/js/content.js`
- function: `getSpaceFeedPostCandidateProfileUrls()`

Why:

- this is where asset-space candidate profile URLs are assembled,
- this is the likely point where poster/current-user/profile-card links can still be admitted incorrectly,
- this is the next place to harden so asset runs do not queue contaminated targets.

## Live Validation Guardrails

Until product-side candidate correctness is improved:

- do not scale to 300,
- do not use flattened reviewed-list inputs,
- do not mix old helper-driven queueing with the product `Nuke 'Em` path,
- keep validation small and in-space,
- avoid gratuitous waiting on dead or stuck workers.
