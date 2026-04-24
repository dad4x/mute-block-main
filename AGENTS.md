# Build Rule

Every rebuild must start with a version bump.

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

