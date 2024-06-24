# Mute Block

Silence unwanted noise on Quora profiles instantly with this browser extension.

## Download Links

- [Chrome](https://chromewebstore.google.com/detail/mute-block-fop-new/nlmmkoljofpgbmlcojebolmniineboah) (also Brave)
- [Firefox](https://addons.mozilla.org/en-US/firefox/addon/mute-block/)

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
- **Production**: `npm run prod` This compiles the source code for production
- **Build for Chrome**: `npm run build:chrome` This builds the zip file of chrome version
- **Build for Firefox**: `npm run build:firefox` This builds the zip file of firefox version
- **Run in Chrome**: `npm run chrome` This will starts the chrome browser with extension installed
- **Run in Firefox**: `npm run firefox` This will starts the firefox browswer with extension installed

### Resources

- [webextension-polyfill](https://github.com/mozilla/webextension-polyfill)
- [web-ext](https://github.com/mozilla/web-ext)
