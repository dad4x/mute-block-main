const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const colorTokens = require('../shared/js/colorTokens')

const root = path.join(__dirname, '..')
const readCss = name => fs.readFileSync(path.join(root, 'shared', 'css', name), 'utf8')

const tokensCss = readCss('tokens.css')
const definedTokens = new Map(
    [...tokensCss.matchAll(/--(mb-[a-z0-9-]+)\s*:\s*([^;]+);/g)].map(match => [match[1], match[2].trim()])
)

// Every var(--mb-...) a surface uses must be defined in tokens.css.
for (const name of ['coordinator.css', 'popup.css', 'content.css']) {
    const usedTokens = [...readCss(name).matchAll(/var\(--(mb-[a-z0-9-]+)\)/g)].map(match => match[1])
    for (const token of usedTokens) {
        assert.ok(definedTokens.has(token), `${name} uses --${token}, which tokens.css does not define`)
    }
}

// The dashboard and popup use tokens only: no raw hex or rgb literals outside tokens.css.
for (const name of ['coordinator.css', 'popup.css']) {
    const literals = readCss(name).match(/#[0-9a-fA-F]{3,8}\b|rgba?\(\s*\d/g) || []
    assert.deepEqual(literals, [], `${name} has raw color literals; use a token from tokens.css`)
}

// The JS brand red must match the CSS brand red, since inline styles and the stylesheet both paint the progress bar.
assert.equal(
    colorTokens.BRAND_RED.toLowerCase(),
    definedTokens.get('mb-brand-red').toLowerCase(),
    'shared/js/colorTokens.js BRAND_RED must equal --mb-brand-red in shared/css/tokens.css'
)

// The running state is cyan, the same as the Runs list badge.
assert.match(readCss('coordinator.css'), /\.pause-state--running\s*\{[^}]*var\(--mb-cyan-800\)/)

console.log('ok - color tokens are defined once, used by every surface, and agree between CSS and JS')
