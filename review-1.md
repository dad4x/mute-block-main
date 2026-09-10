  P1 /scratch/dbrower/home/src/mute-block-main/shared/js/sw.js:36805:
  openReservationHref is used without being declared in fillQueuedTabsOnce().
  The bundled service worker modules run strict, so the first queued-tab open
  path that reaches openReservationHref = reserveQueuedProfileOpen(...) will
  throw instead of opening work. npm run lint:correctness flags this plus all
  later release uses.

  P1 /scratch/dbrower/home/src/mute-block-main/shared/js/sw.js:3912: reason is
  referenced but not defined in
  mutateCoordinatorActiveWithoutRuntimeActorReconcile(). If
  operation.reconcileReason and operation.reason are absent, this recovery path
  throws while handling active-without-actor rows.

  P2
  /scratch/dbrower/home/src/mute-block-main/tools/cdp/sw-pause-and-close-profile
  -tabs.js:36: this helper no longer closes profile tabs. The prior behavior
  queried https://www.quora.com/profile/* and removed those tabs after pausing;
  now it only sends pause-coordinator-nukes and returns. That makes the reset
  helper name/contract false and leaves stale profile tabs in the live browser.

