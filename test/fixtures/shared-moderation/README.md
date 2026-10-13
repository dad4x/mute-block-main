# Shared Moderation Fixtures

These fixtures are stable inputs for the future pure `sharedModeration` model
tests. They intentionally avoid browser, storage, service-worker, and network
dependencies.

The fixture set covers:

- valid event journal rendering and parsing;
- duplicate event ids that import logic should tolerate idempotently;
- malformed `MBLOCK` text;
- Quora-rendered `MBLOCK` text with extra blank lines and spacing;
- MBLOCK parsing around extra prose paragraphs, JSON-looking text outside
  markers, and truncated markers;
- imported label-policy inputs that remain local policy decisions, not remote
  commands;
- imported profile moderation inbox inputs that remain review records, not
  queued execution work;
- imported Space recommendations that remain review records until accepted as
  local classification event payloads;
- valid roaming profile fields;
- forbidden roaming profile fields that must be rejected before publication;
- posted proof containing the expected document and event ids.
