# Mute Block iPhone Safari Plan

Status: separate future-platform plan.

Canonical planning now starts at [planning.md](planning.md). Canonical
architecture starts at [architecture.md](architecture.md). This Safari/iPhone
idea is outside the current `1.6`/`2.0` queue stabilization lane.

## Scope

Build a new iPhone Safari version with a similar user experience, but no shared code assumption with the current desktop extension.

Target behaviors:

- One-button `Mute Block` on Quora profile pages
- One-button link from question pages to the log page
- Optional shared-moderation review/sync participation, if that can be kept as
  advisory input and explicit user action rather than unattended execution

Non-goals for the first pass:

- Desktop browser parity
- Reusing the current Firefox/Chrome extension architecture
- Full settings parity with the desktop popup
- Unattended queued destructive actions on iPhone Safari
- Chrome desktop split-view parity or any desktop action-window model

## Platform Choice

Use a Safari Web Extension packaged inside an iOS app.

Why:

- Firefox iOS and Chrome iOS do not support desktop-style extensions
- Safari is the only realistic browser path for iPhone extension behavior

## Deliverable Shape

Create a new Xcode project containing:

- iOS container app
- Safari Web Extension target
- Extension content scripts for Quora mobile pages
- Minimal popup or action UI only if needed

## Prerequisites

Hardware access is not a current blocker, but the Safari lane needs an Apple
development setup before implementation or reliable validation:

- A reasonably current macOS machine that can run current Xcode and Safari.
- Xcode installed, including command-line tools and iOS simulator support.
- An Apple ID. Apple Developer Program membership is needed for physical-device
  testing and eventual App Store/TestFlight distribution; simulator work can
  start before that.
- A real iPhone with a recent iOS/Safari version for lifecycle, alarm,
  permission, and touch-behavior validation. The simulator is useful for early
  scaffolding, but not sufficient for the final background/suspension questions.
- Safari Web Inspector enabled for iPhone debugging, plus a cable or trusted
  pairing path from the Mac.
- A minimal probe extension before the product port. The probe should measure
  content-script injection on Quora mobile, host permission prompts, background
  lifetime, alarm delivery and `scheduledTime`, storage persistence/limits, and
  behavior across Safari suspension, device lock/unlock, and app switching.
- A target iOS/Safari version policy, including whether the first build targets
  only current iOS or preserves compatibility back to an older Safari Web
  Extension baseline.

## Architecture

Prefer a simple mobile-first design:

- Content script does most of the work
- Minimal nonpersistent background script or Manifest V3 service worker. On iOS,
  Safari requires nonpersistent background execution, so all meaningful state
  must be restorable from storage or the current page.
- Avoid `webRequest`, `windows`, context-menu, and desktop tab-management flows
  as core dependencies. Safari documents `webRequest`, `contextMenus`/`menus`,
  and several `windows` operations as unavailable on iOS.
- Do not assume desktop-style alarm semantics. The current desktop scheduler
  relies on alarm `scheduledTime` to distinguish stale wakeups from current
  work; a Safari/iOS port must revalidate whether that identity exists and is
  reliable before using alarms for queue authority. Treat alarms as wake hints,
  not durable work ownership.
- Use DOM observation and text-based control discovery
- Use pointer events and responsive UI; do not build hover, mouse, or fixed-size
  desktop affordances into the first version.
- Keep state in `storage.local` only if settings or a tiny action log are needed.
  Safari's documented local storage floor is small enough that queue/history
  growth should be avoided in v1.

### Visible Action Surface Constraint

The desktop stabilization work is moving toward a general rule: destructive
Quora UI mutations should run only in a visible action surface. Chrome desktop
may offer extra ways to provide that surface, such as a dedicated action window
or user-created split view. Those are desktop optimizations, not portable
architecture.

iPhone Safari is much more constrained:

- It is effectively a single-foreground browsing surface for this use case.
- There is no practical split-view/action-window equivalent for extension-owned
  queued execution.
- Background execution is nonpersistent and lifecycle-managed by Safari/iOS.
- User gestures, visibility, suspension, lock/unlock, and app switching are
  first-class constraints, not edge cases.

Therefore the iPhone Safari lane should be treated as a foreground,
user-directed companion. It may add a profile-page `Mute Block` button and
other explicit controls on the page the user is currently viewing. It should not
own the normal queued executor role for bulk moderation. If shared moderation is
ported to mobile, the mobile role should be review, policy input, publication,
or manual one-at-a-time action. Desktop Chrome/Firefox should remain the
execution surface for unattended or batched queue work.

## Workstreams

### 1. Bootstrap Safari/iOS Project

- Create a Safari Web Extension app in Xcode
- Define extension permissions for Quora
- Confirm host permissions are sufficient for any `tabs` API use
- Verify extension can load on iPhone Safari
- Confirm content scripts run on Quora mobile pages
- Probe background lifecycle and alarm behavior, including whether alarm events
  include a stable scheduled-time identity after Safari suspension or reload

### 2. Mobile Quora Discovery

- Inspect Quora mobile profile pages
- Inspect Quora mobile question pages
- Inspect Quora mobile log pages
- Record stable selectors, button labels, menu flows, and dialog behaviors

### 3. Profile Feature

- Detect mobile Quora profile pages
- Inject one `Mute Block` button in the profile header/action area
- Require this action to be initiated from the visible foreground profile page;
  do not build a hidden-tab or background queue executor around it.
- Open the relevant profile menu
- Trigger `Mute`
- Trigger `Block`
- Confirm dialogs and success states on iPhone

### 4. Question Feature

- Detect mobile Quora question pages
- Inject one button labeled for opening the log page
- Navigate directly to the log page in the current tab or through an ordinary
  page link; do not depend on `windows.create` or desktop-style popup placement
- Do not add extra scrolling or log-page automation in v1

### 5. Hardening

- Handle delayed rendering with mutation observers
- Guard against duplicate button injection
- Handle menu or dialog not found states cleanly
- Add lightweight console logging for field debugging

### 6. Packaging and Device Testing

- Test on a real iPhone, not only simulator
- Test on several Quora profiles and questions
- Verify extension survives Safari reloads and page navigations
- Force Safari suspension, device lock/unlock, and app switching during an
  in-progress interaction to prove no in-memory background state is required
- Produce an installable dev build

## Likely Technical Risks

- Quora mobile DOM differs substantially from desktop
- Menus and dialogs may be sheet-based or otherwise different on iPhone
- Safari extension lifecycle is stricter than desktop browsers. Apple recommends
  top-level event listeners, storage-backed state restore, and alarms rather
  than `setTimeout` for nonpersistent backgrounds.
- Background wakeups may be delayed, coalesced, dropped, or delivered without
  the same alarm identity fields used by the desktop Chrome/Firefox scheduler.
  Treat any future queue/reconcile model as storage-driven and content/user
  triggered until Safari alarm behavior is measured on device.
- Mobile Safari should not be assumed capable of reliable unattended destructive
  queue processing. If it participates in shared moderation, constrain it to
  foreground manual actions, review/sync, or advisory policy input unless device
  testing proves a stronger model.
- Safari ignores unsupported manifest keys and APIs, so missing functionality
  can look like a no-op rather than a clear startup failure unless each intended
  API is probed during bootstrap.
- Local extension storage is more constrained than the desktop design assumes;
  avoid carrying over desktop queue metrics, history, or large snapshots.
- Some automated click flows may require additional waits or retries
- Quora page changes will still be an ongoing maintenance risk

## Research Notes

- Apple Safari web extensions are packaged as macOS, visionOS, or iOS app
  extensions, and Safari web extensions are available on iOS 15 and later.
- Apple recommends nonpersistent background execution for Safari, requires it on
  iOS, and says nonpersistent backgrounds should register top-level listeners,
  restore state from Storage, and use the Alarms API instead of `setTimeout`.
- Apple documents several iOS Safari extension incompatibilities relevant here:
  `webRequest` is not supported on iOS, `contextMenus`/`menus` are not supported
  on iOS, and `windows.create`/`windows.remove`/`windows.update` are not
  supported on iOS. `tabs` API use needs host permission.
- MDN and Chrome document alarm `scheduledTime` as the scheduled fire time, and
  Chrome notes alarms can be delayed and are not guaranteed to persist across
  browser restart. Safari behavior still needs on-device measurement before it
  becomes part of scheduler authority.

## Recommended Milestones

### Milestone 1

Safari extension loads on iPhone and can inject a test button on Quora mobile pages.

### Milestone 2

`Mute Block` works end-to-end on at least one mobile Quora profile.

### Milestone 3

Question-page button opens the log page reliably on mobile.

### Milestone 4

Selectors and timing are hardened across several real pages.

## First Implementation Order

1. Create Safari/iOS project skeleton
2. Prove content-script injection on mobile Quora
3. Implement profile-page `Mute Block`
4. Implement question-page `Open Log Page`
5. Harden selectors and waits
6. Add optional settings only if needed

## Success Criteria

- On iPhone Safari, a Quora profile page shows one `Mute Block` button
- Clicking it completes mute + block on supported pages
- On iPhone Safari, a Quora question page shows one button to open the log page
- No dependency on desktop-only Quora layout or desktop-only extension behavior
- No unattended queued execution path is introduced for iPhone Safari
