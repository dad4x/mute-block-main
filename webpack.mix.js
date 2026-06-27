const fs = require('fs')
const mix = require('laravel-mix')
const path = require('path')

const sharedJsBuildDir = path.resolve(__dirname, 'tmp/mix-shared/js')
const browserJsBuildDirs = [
    path.resolve(__dirname, 'chrome/js'),
    path.resolve(__dirname, 'firefox/js')
]

mix.options({
    terser: {
        extractComments: false,
        terserOptions: {
            output: {
                comments: false
            }
        }
    }
})
.setPublicPath('./')

.js('./shared/js/content.js', 'tmp/mix-shared/js')

.js('./shared/js/popup.js', 'tmp/mix-shared/js')

.js('./shared/js/coordinator.js', 'tmp/mix-shared/js')

.js('./shared/js/sw.js', 'tmp/mix-shared/js')

.then(() => {
    for(const browserJsBuildDir of browserJsBuildDirs) {
        fs.rmSync(browserJsBuildDir, {recursive: true, force: true})
        fs.cpSync(sharedJsBuildDir, browserJsBuildDir, {recursive: true})
    }
})

.copy('./shared/css', 'chrome/css')
.copy('./shared/css', 'firefox/css')

.copy('./shared/popup.html', 'chrome/popup.html')
.copy('./shared/popup.html', 'firefox/popup.html')

.copy('./shared/coordinator.html', 'chrome/coordinator.html')
.copy('./shared/coordinator.html', 'firefox/coordinator.html')

.copy('./shared/icons', 'chrome/icons')
.copy('./shared/icons', 'firefox/icons')

.copy('./manifests/chrome.json', 'chrome/manifest.json')
.copy('./manifests/firefox.json', 'firefox/manifest.json')
