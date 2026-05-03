# Build Rule

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
