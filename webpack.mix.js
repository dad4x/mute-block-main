const mix = require('laravel-mix')

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

.js('./shared/js/content.js', 'chrome/js')
.js('./shared/js/content.js', 'firefox/js')

.js('./shared/js/sw.js', 'chrome/js')
.js('./shared/js/sw.js', 'firefox/js')

.copy('./shared/css', 'chrome/css')
.copy('./shared/css', 'firefox/css')

.copy('./shared/icons', 'chrome/icons')
.copy('./shared/icons', 'firefox/icons')

.copy('./manifests/chrome.json', 'chrome/manifest.json')
.copy('./manifests/firefox.json', 'firefox/manifest.json')