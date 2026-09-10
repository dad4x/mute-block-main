# Build Rule

This repository is a normal Git project, not an ADE workspace. ADE checkout,
transaction, view, and `$ADE_VIEW_ROOT` restrictions do not apply here. Do not
run ADE commands, require ADE checkout, or apply ADE permission rules in this
repository unless the user explicitly asks for an ADE operation outside this
project.

There is no project-level sandbox requirement for this repository. Treat files
inside this tree as directly writable under the user's standing authorization.
If a command fails because of the agent runner's external wrapper or sandbox
mechanism, treat that as tooling friction rather than a project policy. Retry
with the repo's normal command path, such as `bash -lc`, and do not ask the user
for repo-local read, edit, test, build, copy, or validation permission.

All files under this repository tree are writable by AI coding assistants for
the active refactor and stabilization work. Treat repo-local source, test, doc,
note, manifest, build-output, and packaging edits as permanently authorized by
the user.

Do not ask again for permission to read, edit, test, rebuild, package, copy, or
validate repo-local files in this tree. Do not ask for another authorization
just because a command changes files under this checkout. Continue directly
once the task is clear.

## Command Discipline For This Repo

Use simple command shapes that match the agent runner's approved command
prefixes. Prefer:

- `bash -lc 'npm test'`
- `bash -lc 'node tools/cdp/<script>.js ...'`
- `bash -lc 'npm run prod'`
- `bash -lc 'npm run build:chrome'`
- `bash -lc 'npm run build:firefox'`

If a repo-local command fails with sandbox, `bwrap`, mount, wrapper, or
permission-looking tooling noise, retry once through `bash -lc` before treating
it as a real project failure. Do not ask the user for repo-local permissions
after runner-wrapper failures.

Repo-local mock browser harnesses are covered by this rule. Do not request
escalation merely because a command launches or attaches to the dedicated local
Firefox/Chrome harness for this checkout. Use the normal approved command path
first, for example `bash -lc 'tools/firefox-bidi/run-mock-smoke.sh'`. Escalate
only after an actual sandbox/tooling failure that cannot be handled by the
repo-local helper path, or for genuinely destructive/out-of-tree actions.

Avoid complex one-off shell forms for live debugging. If a command needs inline
JavaScript, command substitution, heredocs, redirection, or fragile quoting,
put the logic in a repo-local helper such as `tools/cdp/<script>.js` and run
that helper through `bash -lc`.

Keep normal safety rules: avoid destructive Git/history operations unless
explicitly requested, preserve unrelated user changes, and validate shipped
behavior changes with the build rule below.

Every rebuild must start with a version bump.

In this repo, assume code changes should end with a fresh local rebuild unless the user explicitly says not to. The user copies the local packaged artifacts directly, so after modifying shipped extension code or behavior:

- bump the version first
- rebuild the local extension outputs
- regenerate the Chrome and Firefox zip artifacts

Do not leave code changes sitting at an old packaged version.

If you are about to run any release-oriented build step, including:

- `npm run prod`
- `npm run build:chrome`
- `npm run build:firefox`
- regenerating zip artifacts

advance the version first in:

- `package.json`
- `package-lock.json`
- `manifests/chrome.json`
- `manifests/firefox.json`

Do not rebuild or regenerate release zips at the existing version.

## Release Traceability

When a build generates Chrome or Firefox zip artifacts that may be installed,
copied to another machine, or used for live validation, treat it as a release
savepoint:

- run the intended validation before closing the release build
- commit the exact source, test, manifest, package, build-output, and zip
  artifact state that produced the zips
- create an annotated Git tag for the released version, for example
  `v1.6.550`

The tag is the Git equivalent of an ADE savepoint for that build. Do not tag a
known-broken or accidentally generated package; discard it or advance to a new
version and rebuild.

There is no relaxed rule for local/dev/test-only builds. Every build,
including `npm run build:chrome-dev` and any other build run purely for local
live-testing iteration, still bumps the version first. The version number is
the only cheap way to tell from the running extension (`chrome://extensions/`
or the popup) whether a reload actually picked up new code, so skipping the
bump on "just a test build" defeats the entire point during a live-testing
loop. Commits and Git tags remain optional for test-only builds unless the
user asks for them or the test build becomes the candidate release -- only
the version-bump-before-build requirement is unconditional.

# Live Browser Automation

Never use Puppeteer in this repository. For live browser validation, use direct
Chrome DevTools Protocol calls over the remote-debugging endpoint instead.
