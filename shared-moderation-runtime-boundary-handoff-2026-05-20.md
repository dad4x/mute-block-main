# Shared Moderation Runtime Boundary Handoff, 2026-05-20

Status: supporting handoff, runtime integration deferred.

Canonical planning now starts at [planning.md](planning.md). Canonical
architecture starts at [architecture.md](architecture.md). This note defines the
runtime boundary for future shared-moderation integration.

This handoff describes the intended boundary between the pure shared
moderation model and future runtime integration. It is deliberately separate
from the active service-worker/debug refactor.

## Standing Rule

Imported moderation data is input to local review and local policy. It is not a
remote command channel.

Runtime code should enter through the pure helpers in
`shared/js/sharedModeration.js` and then hand accepted results to the existing
local authority layers. It should not write queue rows, registry rows, progress
records, or export state directly from parsed remote text.

## Current Pure Entry Points

- `parseMblockBlocks(text)`: extracts MBLOCK documents from rendered text.
- `validateEventJournal(document)`: validates event journal shape.
- `normalizeEventJournal(document)`: deduplicates event ids and normalizes
  profile/Space subjects.
- `collectProfileModerationInputs(journals, options)`: turns external profile
  events into review inbox records only.
- `reduceImportInbox(state, action)`: imports, dismisses, or marks profile
  inputs applied idempotently.
- `collectSpaceRecommendations(journals, options)`: turns external Space
  classification events into recommendations only.
- `reduceSpaceRecommendationInbox(state, action)`: imports, dismisses, or marks
  Space recommendations applied idempotently.
- `makeLocalSpaceClassificationEvent(recommendation, options)`: converts an
  accepted recommendation into a local classification event payload.
- `resolveLabelPolicyAction(labels, policy)`: maps imported labels to local
  policy decisions without executing actions.
- `verifyPostedProof(document, proof)`: checks that an export proof covers the
  expected document and event ids.

## Content Script Boundary

Content script work should be limited to observation and user-directed
foreground action:

- read rendered post text;
- detect the explicit mock metadata gate in dev-only localhost tests;
- pass rendered text to the service worker or test harness;
- show UI indicators for local review status;
- send user-directed foreground commands for explicit mute/block/close button
  use on a visible profile page.

Content script code should not:

- parse MBLOCK with a duplicate ad hoc parser;
- apply imported profile actions directly;
- write Space registry state directly from imported recommendations;
- enqueue remote recommendations directly;
- mark export events as posted or exported.

## Service Worker Boundary

The service worker remains the runtime authority for storage, scheduling,
queueing, and export state. Future integration should sequence through narrow
reducers:

1. Read rendered/shared text from a trusted source.
2. Parse with `parseMblockBlocks`.
3. Validate and normalize journals.
4. Split external profile inputs and Space recommendations into review inboxes.
5. Let local policy and user review decide whether to accept.
6. On accept, create local events or existing queue requests through the same
   local entry points used by foreground user actions.
7. Persist through the storage authority layer, not by direct primitive writes.

The service worker should not treat repair/reconciliation as the normal import
path. If repair has to reconstruct imported inbox state routinely, the import
path is probably bypassing its intended authority boundary.

## Scheduler And Export Boundary

Export scheduling should remain proof-driven:

- select pending local events;
- render an MBLOCK document;
- attempt publication only through the scheduler/export worker path;
- re-read the post;
- call `verifyPostedProof`;
- mark events exported only after proof verification.

Failed automatic export leaves events pending. Manual publish may override
volume threshold, but not proof requirements.

## Mock Composer Boundary

Mock browser integration should use the existing dev-only metadata gate:

- localhost injection only through the temporary dev manifest;
- page must expose explicit `mute-block-mock-quora` metadata;
- mock posts must be parsed through `parseMblockBlocks`;
- proof checks should use the same reducer/helper path intended for live Quora.

Production manifests should not gain broad localhost permissions.

## Review Checklist For Future Wiring

- No duplicate MBLOCK parser is introduced.
- Imported profile events land in an inbox before any action.
- Imported Space events land in recommendations before any registry change.
- Accepting a recommendation emits a local classification event before any
  registry write.
- Local queue work starts only through the established service-worker authority
  path.
- Exported status requires posted proof.
- Self journals do not create imported actions.
- Unknown-source journals do not create recommendations or inputs.
- Runtime source changes are split by boundary: parser/import, review UI,
  registry apply, queue execution, scheduler/export, mock composer.
