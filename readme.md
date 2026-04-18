# Mute Block

Silence unwanted noise on Quora profiles instantly with this browser extension.

## Current Status

- Source and local build artifacts are currently at `1.4.92`.
- Chrome is the current release track.
- Firefox store updates are currently blocked, so the published Firefox add-on is still on `1.2` until that pipeline is sorted out.

## Current Feature Surface

- `Mute Block` and `Mute Block Close` actions on supported Quora profile pages
- `Original Poster Profile` helper on supported log/question contexts
- bulk `Open Profiles` and `Nuke 'Em` flows on supported follower, following, contributor, and related people-list contexts
- local settings for `FOP Button Delay`, `Auto Switch To Answers`, `FOP Flip Delay`, and `Profiles Per Batch`

## Download Links

- [Chrome](https://chromewebstore.google.com/detail/mute-block-fop-new/nlmmkoljofpgbmlcojebolmniineboah) (also Brave)
- [Firefox](https://addons.mozilla.org/en-US/firefox/addon/mute-block/) currently reflects the older `1.2` release

## Installation

### Chrome

1. Visit the [Chrome Web Store](https://chromewebstore.google.com/detail/mute-block-fop-new/nlmmkoljofpgbmlcojebolmniineboah).
2. Click `Add to Chrome`.
3. Follow the prompts to install the extension.

### Firefox

1. Visit the [Firefox Add-ons](https://addons.mozilla.org/en-US/firefox/addon/mute-block/).
2. Click `Add to Firefox`.
3. Follow the prompts to install the extension.
4. Give it permissions.  See [https://qr.ae/ps9aTh]
5. Note that the store listing is currently behind the source tree and still serves `1.2`.

## Development

### Prerequisites

Ensure you have the following installed:

- Node.js
- npm (Node Package Manager)

### Setup

1. Clone the repository:

    ```bash
    git clone https://github.com/dad4x/mute-block-main.git
    cd mute-block-main
    ```

2. Install the dependencies:

    ```bash
    npm install
    ```

### Scripts

- **Development**: `npm run dev` This compiles the source code for dev testing
- **Production**: `npm run prod` This compiles the source code for production and refreshes the built extension directories
- **Build for Chrome**: `npm run build:chrome` This builds the Chrome zip from the refreshed `chrome/` directory
- **Build for Firefox**: `npm run build:firefox` This builds the Firefox zip from the refreshed `firefox/` directory
- **Run in Chrome**: `npm run chrome` This will starts the chrome browser with extension installed
- **Run in Firefox**: `npm run firefox` This will starts the firefox browswer with extension installed

In practice, run `npm run prod` before creating release zips so the packaged files match the current source.

### Resources

- [webextension-polyfill](https://github.com/mozilla/webextension-polyfill)
- [web-ext](https://github.com/mozilla/web-ext)
