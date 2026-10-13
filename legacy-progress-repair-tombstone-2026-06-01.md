# Legacy Progress/Repair Tombstone

This file intentionally preserves the historical words `mbProfileNukeProgress`,
`record-nuke-progress`, `legacyImport`, `importLegacy`, and `repair-*` as a
tombstone only.

Those names describe deleted compatibility surfaces and should not be restored
as live service-worker, dashboard, CDP, or test-helper APIs. Current authority
flows are queue/WAL backed; current progress storage is compact projection
state only.

Use this tombstone as the place to point future readers who find old branch
names in discussions or logs. Do not add new runtime compatibility paths for
these names.
