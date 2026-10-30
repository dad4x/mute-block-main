const fs = require('fs')
const mix = require('laravel-mix')
const path = require('path')

const sharedJsBuildDir = path.resolve(__dirname, 'tmp/mix-shared/js')
const browserJsBuildDirs = [
    path.resolve(__dirname, 'chrome/js'),
    path.resolve(__dirname, 'firefox/js')
]

class StripArchitectureCommentsPlugin {
    apply(compiler) {
        compiler.hooks.compilation.tap('StripArchitectureCommentsPlugin', compilation => {
            compilation.hooks.processAssets.tap(
                {
                    name: 'StripArchitectureCommentsPlugin',
                    stage: compiler.webpack.Compilation.PROCESS_ASSETS_STAGE_OPTIMIZE
                },
                assets => {
                    for(const assetName of Object.keys(assets)) {
                        if(!assetName.endsWith('.js')) continue
                        const source = assets[assetName].source().toString()
                        const stripped = source.replace(/\/\*\s*(?:\*\s*)?ARCHITECTURE:[\s\S]*?\*\//g, '')
                        if(stripped !== source) {
                            compilation.updateAsset(
                                assetName,
                                new compiler.webpack.sources.RawSource(stripped)
                            )
                        }
                    }
                }
            )
        })
    }
}

mix.disableNotifications()

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
.webpackConfig({
    plugins: mix.inProduction() ? [new StripArchitectureCommentsPlugin()] : []
})

.js('./shared/js/content.js', 'tmp/mix-shared/js')

.js('./shared/js/preferences.js', 'tmp/mix-shared/js')

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

.copy('./shared/preferences.html', 'chrome/preferences.html')
.copy('./shared/preferences.html', 'firefox/preferences.html')

.copy('./shared/coordinator.html', 'chrome/coordinator.html')
.copy('./shared/coordinator.html', 'firefox/coordinator.html')

.copy('./shared/icons', 'chrome/icons')
.copy('./shared/icons', 'firefox/icons')

.copy('./manifests/chrome.json', 'chrome/manifest.json')
.copy('./manifests/firefox.json', 'firefox/manifest.json')
