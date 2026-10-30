// Owner, 29 Oct: the Bad Links button on a space post opens a list of the failed profiles, each with its reason and a link to open it
// by hand. The list is built from shared/js/content.js; these tests run those functions against a small fake DOM.
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')

function readRepoFile(relativePath) {
    return fs.readFileSync(path.join(__dirname, '..', relativePath), 'utf8')
}

function extractFunction(source, signature) {
    const start = source.indexOf(signature)
    assert.notEqual(start, -1, `missing ${signature}`)
    const braceStart = source.indexOf('{', start + signature.length)
    assert.notEqual(braceStart, -1, `missing body for ${signature}`)

    let depth = 0
    for(let index = braceStart; index < source.length; index += 1) {
        if(source[index] === '{') depth += 1
        else if(source[index] === '}') {
            depth -= 1
            if(depth === 0) return source.slice(start, index + 1)
        }
    }
    throw new Error(`unterminated ${signature}`)
}

async function test(name, fn) {
    try {
        await fn()
        console.log(`ok - ${name}`)
    }
    catch(error) {
        console.error(`not ok - ${name}`)
        throw error
    }
}

const MAGA_PATRIOT = 'https://www.quora.com/profile/MagaPatriot'
const MAGA_DEVIL = 'https://www.quora.com/profile/MagaDevil'
const NICK_1147 = 'https://www.quora.com/profile/Nick-Davis-1147'
const WILL = 'https://www.quora.com/profile/Will-Fridolf-5'
const NICK_1145 = 'https://www.quora.com/profile/Nick-Davis-1145'

const content = readRepoFile('shared/js/content.js')

// Fake DOM: just what the list code touches (class names, direct children, hidden, dataset, attributes, listeners).
class FakeElement {
    constructor(tagName, registry) {
        this.tagName = tagName
        this.registry = registry
        this.children = []
        this.dataset = {}
        this.attributes = {}
        this.listeners = {}
        this.hidden = false
        this.parentElement = null
        this.className = ''
        this.title = ''
        this.text = ''
        registry.push(this)
    }

    get textContent() {
        return this.text
    }

    // Setting the text to nothing empties the element, as the browser does.
    set textContent(value) {
        this.text = `${value}`
        if(this.text === '') this.children = []
    }

    appendChild(child) {
        child.parentElement = this
        this.children.push(child)
        return child
    }

    setAttribute(name, value) {
        this.attributes[name] = `${value}`
        if(name === 'aria-label') this.ariaLabel = `${value}`
    }

    addEventListener(type, listener) {
        this.listeners[type] = listener
    }

    remove() {
        if(!this.parentElement) return
        this.parentElement.children = this.parentElement.children.filter(child => child !== this)
        this.parentElement = null
    }

    // Supports the one selector shape the list code uses: ':scope > .class' (a direct child with that class).
    querySelector(selector) {
        const className = selector.replace(/^:scope > /, '').replace(/^\./, '')
        return this.children.find(child => child.className === className) || null
    }
}

function createFakeDocument() {
    const registry = []
    const documentListeners = {}
    const document = {
        createElement(tagName) {
            return new FakeElement(tagName, registry)
        },
        addEventListener(type, listener) {
            documentListeners[type] = listener
        },
        querySelectorAll(selector) {
            const className = selector.replace(/^\./, '').replace(/:not\(\[hidden\]\)$/, '')
            return registry.filter(element => element.className === className && !element.hidden && element.parentElement)
        }
    }
    return {document, documentListeners, registry}
}

function loadBadLinkHarness() {
    const fake = createFakeDocument()
    const helpSource = readRepoFile('shared/js/muteBlockHelp.js')
    const calls = {batch: 0, storage: 0}
    const progress = {}
    const context = {
        document: fake.document,
        console,
        calls,
        progress,
        normalizeQuoraProfileHref(href = '') {
            const value = `${href || ''}`.split(/[?#]/)[0].replace(/\/+$/, '')
            return value.includes('/profile/') ? value : null
        },
        getProfileNukeProgressRecord(href) {
            return progress[href] || null
        }
    }
    vm.createContext(context)
    vm.runInContext(`(function() { const module = {exports: {}};\n${helpSource}\n;globalThis.setMuteBlockHelp = module.exports.setMuteBlockHelp })()`, context, {filename: 'muteBlockHelp.js'})

    const names = [
        'function getSpaceFeedBadLinkDetail(href, record = null)',
        'function syncSpaceFeedBadLinkList(host, details = [])',
        'function buildSpaceFeedBadLinkRow(detail)',
        'function toggleSpaceFeedBadLinkListFromClick(button)',
        'function bindSpaceFeedBadLinkEscape()'
    ]
    const source = names.map(signature => extractFunction(content, signature)).join('\n\n')
    vm.runInContext([
        'let spaceFeedBadLinkEscapeBound = false',
        source,
        // Stubs for the single-button click handler's other calls. Each one that would start a batch or write state is counted.
        'function nukeSpaceFeedEntries() { calls.batch += 1 }',
        'function getLatestSpaceFeedEntries() { return [] }',
        'function getQueueableSpaceFeedEntryUrls() { return [] }',
        'function isSpaceFeedPostNuked() { return false }',
        'function setNukeButtonDone() {}',
        'function isQueueableSpaceFeedResolverEntry() { return false }',
        'function recordProfileNukeProgress() { calls.storage += 1 }',
        'function setProfileNukeProgress() { calls.storage += 1 }',
        'function getSpaceFeedButtonUrls(button) { return JSON.parse(button.dataset.mbSpaceFeedUrls || "[]") }'
    ].join('\n\n'), context, {filename: 'bad-links-harness.js'})

    // The real single-button click handler, taken from the source, so the test runs the code the page runs.
    const handlerStart = content.indexOf("'space-feed-post-single', event => {")
    assert.notEqual(handlerStart, -1, 'missing the single-button click handler')
    // The arrow function ends at its closing brace; the ")" after it closes the ensureCurrentInstanceClickHandler call.
    const handlerEnd = content.indexOf('\n        })', handlerStart) + '\n        }'.length
    const handlerSource = content.slice(handlerStart + "'space-feed-post-single', ".length, handlerEnd)
    context.clickSingleButton = vm.runInContext(`(${handlerSource})`, context, {filename: 'single-button-handler.js'})

    return {context, fake, source, handlerSource}
}

function makeButton(context, state, host) {
    const button = new FakeElement('button', [])
    button.dataset.mbNukeState = state
    button.dataset.mbPostKey = 'post-a'
    button.dataset.mbSpaceFeedUrls = JSON.stringify([MAGA_PATRIOT])
    button.parentElement = host
    return button
}

test('the reason: a redirected profile says where Quora sent it, from the progress record', () => {
    const {context} = loadBadLinkHarness()
    const record = {
        status: 'profile-unavailable',
        resolvedProfileHref: MAGA_DEVIL,
        unavailableReason: `Queued profile redirected from ${MAGA_PATRIOT} to ${MAGA_DEVIL}`
    }
    const detail = context.getSpaceFeedBadLinkDetail(MAGA_PATRIOT, record)
    assert.deepEqual({...detail}, {href: MAGA_PATRIOT, name: 'MagaPatriot', reason: 'redirected to MagaDevil'})
})

test('the reason: a redirect is read from the reason text when the landing profile is not kept on the record', () => {
    const {context} = loadBadLinkHarness()
    const record = {status: 'profile-unavailable', unavailableReason: `Queued profile redirected from ${NICK_1147} to ${WILL}`}
    const detail = context.getSpaceFeedBadLinkDetail(NICK_1147, record)
    assert.equal(detail.name, 'Nick-Davis-1147')
    assert.equal(detail.reason, 'redirected to Will-Fridolf-5')
})

test('the reason: a profile that did not redirect, or has no record, is unavailable', () => {
    const {context} = loadBadLinkHarness()
    assert.equal(context.getSpaceFeedBadLinkDetail(NICK_1145, {status: 'profile-unavailable', unavailableReason: 'Profile unavailable'}).reason, 'unavailable')
    assert.equal(context.getSpaceFeedBadLinkDetail(NICK_1145, null).reason, 'unavailable')
    // A landing profile that is the same as the requested one is not a redirect.
    assert.equal(context.getSpaceFeedBadLinkDetail(NICK_1145, {resolvedProfileHref: NICK_1145}).reason, 'unavailable')
    assert.equal(context.getSpaceFeedBadLinkDetail(NICK_1145, null).name, 'Nick-Davis-1145')
})

test('the list: one line per failed profile, each with the name, the reason and a link to the profile the row targeted', () => {
    const {context, fake} = loadBadLinkHarness()
    const host = fake.document.createElement('div')
    context.syncSpaceFeedBadLinkList(host, [
        context.getSpaceFeedBadLinkDetail(MAGA_PATRIOT, {resolvedProfileHref: MAGA_DEVIL}),
        context.getSpaceFeedBadLinkDetail(NICK_1147, {resolvedProfileHref: WILL}),
        context.getSpaceFeedBadLinkDetail(NICK_1145, null)
    ])

    const list = host.querySelector(':scope > .mb-ext_space-feed-bad-links')
    assert.ok(list, 'the list is a child of the post host')
    assert.equal(list.hidden, true, 'the list starts closed')
    assert.equal(list.children.length, 3)

    const [patriot, nick1147, nick1145] = list.children
    const linkOf = row => row.children[0]
    const reasonOf = row => row.children[1].textContent
    assert.equal(linkOf(patriot).textContent, 'MagaPatriot')
    assert.equal(linkOf(patriot).href, MAGA_PATRIOT)
    assert.equal(linkOf(patriot).target, '_blank')
    assert.equal(reasonOf(patriot), 'redirected to MagaDevil')
    assert.equal(linkOf(nick1147).href, NICK_1147)
    assert.equal(reasonOf(nick1147), 'redirected to Will-Fridolf-5')
    assert.equal(linkOf(nick1145).href, NICK_1145)
    assert.equal(reasonOf(nick1145), 'unavailable')
})

test('contract: every link in the list has a hover that starts with "Mute Block extension: " and names the profile', () => {
    const {context, fake} = loadBadLinkHarness()
    const host = fake.document.createElement('div')
    context.syncSpaceFeedBadLinkList(host, [context.getSpaceFeedBadLinkDetail(NICK_1145, null)])
    const link = host.querySelector(':scope > .mb-ext_space-feed-bad-links').children[0].children[0]
    assert.equal(link.title, 'Mute Block extension: Open Nick-Davis-1145 on Quora to block it by hand')
    assert.ok(link.title.startsWith('Mute Block extension: '))
    assert.equal(link.attributes['aria-label'], link.title)
})

test('the list is rebuilt only when its rows change, so an open list stays open across syncs', () => {
    const {context, fake} = loadBadLinkHarness()
    const host = fake.document.createElement('div')
    const details = [context.getSpaceFeedBadLinkDetail(NICK_1145, null)]
    context.syncSpaceFeedBadLinkList(host, details)
    const list = host.querySelector(':scope > .mb-ext_space-feed-bad-links')
    const firstRow = list.children[0]
    context.toggleSpaceFeedBadLinkListFromClick({dataset: {mbNukeState: 'bad-links'}, parentElement: host})
    assert.equal(list.hidden, false)

    context.syncSpaceFeedBadLinkList(host, details)
    assert.equal(list.children[0], firstRow, 'same rows are not rebuilt')
    assert.equal(list.hidden, false, 'the open list stays open')

    context.syncSpaceFeedBadLinkList(host, [])
    assert.equal(host.querySelector(':scope > .mb-ext_space-feed-bad-links'), null, 'no bad links, no list')
})

test('a click on Bad Links opens the list, a second click closes it, and Escape closes it', () => {
    const {context, fake, handlerSource} = loadBadLinkHarness()
    const host = fake.document.createElement('div')
    context.syncSpaceFeedBadLinkList(host, [context.getSpaceFeedBadLinkDetail(MAGA_PATRIOT, null)])
    const list = host.querySelector(':scope > .mb-ext_space-feed-bad-links')
    const button = makeButton(context, 'bad-links', host)
    context.progress[MAGA_PATRIOT] = {status: 'profile-unavailable'}
    const before = JSON.stringify(context.progress)

    context.clickSingleButton({currentTarget: button})
    assert.equal(list.hidden, false, 'first click opens')
    context.clickSingleButton({currentTarget: button})
    assert.equal(list.hidden, true, 'second click closes')

    context.clickSingleButton({currentTarget: button})
    assert.equal(list.hidden, false)
    fake.documentListeners.keydown({key: 'Enter'})
    assert.equal(list.hidden, false, 'other keys leave it open')
    fake.documentListeners.keydown({key: 'Escape'})
    assert.equal(list.hidden, true, 'Escape closes it')

    assert.ok(handlerSource.indexOf('toggleSpaceFeedBadLinkListFromClick(activeButton)') < handlerSource.indexOf('nukeSpaceFeedEntries('), 'the toggle is checked before any batch call')
    assert.equal(context.calls.batch, 0, 'clicking Bad Links does not start a batch')
    assert.equal(context.calls.storage, 0, 'clicking Bad Links does not write queue or storage state')
    assert.equal(JSON.stringify(context.progress), before, 'progress is unchanged')
})

test('a click on a button that is not Bad Links still goes on to the batch path, so the toggle is only for Bad Links', () => {
    const {context, fake} = loadBadLinkHarness()
    const host = fake.document.createElement('div')
    context.syncSpaceFeedBadLinkList(host, [context.getSpaceFeedBadLinkDetail(MAGA_PATRIOT, null)])
    const button = makeButton(context, 'idle', host)
    button.dataset.mbSpaceFeedUrls = JSON.stringify([NICK_1145])
    context.clickSingleButton({currentTarget: button})
    assert.equal(context.calls.batch, 1, 'the ordinary path is unchanged')
    assert.equal(host.querySelector(':scope > .mb-ext_space-feed-bad-links').hidden, true, 'the list is not opened by it')
})

test('a Bad Links list is not opened from a button that is not in the bad-links state', () => {
    const {context, fake} = loadBadLinkHarness()
    const host = fake.document.createElement('div')
    context.syncSpaceFeedBadLinkList(host, [context.getSpaceFeedBadLinkDetail(NICK_1145, null)])
    const list = host.querySelector(':scope > .mb-ext_space-feed-bad-links')
    assert.equal(context.toggleSpaceFeedBadLinkListFromClick({dataset: {mbNukeState: 'idle'}, parentElement: host}), false)
    assert.equal(list.hidden, true)
})

test('the list code only shows links: it does not queue, change progress or write storage', () => {
    const {source} = loadBadLinkHarness()
    assert.doesNotMatch(source, /nukeSpaceFeedEntries|recordProfileNukeProgress|setProfileNukeProgress|chrome\.|browser\.|sendMessage|storage\./)
})

test('contract: the Bad Links button stays clickable, and its hover names the failed profiles with their reasons', () => {
    assert.match(content, /else if\(hasBadLinks\) \{\n\s+setNukeButtonBadLinks\(singleButton\)\n(?:\s+\/\/[^\n]*\n)?\s+singleButton\.disabled = false\n\s+setMuteBlockHelp\(singleButton, `\$\{postLabel\}Bad Links/)
    assert.match(content, /singleButton\.disabled = false\n\s+setMuteBlockHelp\(singleButton, `\$\{postLabel\}Bad Links: nothing here can be queued\. Failed: \$\{badLinkDetails\.map\(detail => `\$\{detail\.name\} \(\$\{detail\.reason\}\)`\)\.join\(', '\)\}\. Click for the links to block by hand\.`\)/)
    assert.match(content, /syncSpaceFeedBadLinkList\(host, hasBadLinks && !postBusy \? badLinkDetails : \[\]\)/)
})

test('contract: the list styling uses existing tokens only, and a hidden list is not shown', () => {
    const css = readRepoFile('shared/css/content.css')
    const rules = [...css.matchAll(/\.mb-ext_space-feed-bad-links[^{]*\{[^}]*\}/g)].map(match => match[0])
    assert.ok(rules.length >= 5, 'the list rules are present')
    for(const rule of rules) {
        assert.doesNotMatch(rule, /#[0-9a-fA-F]{3,8}\b|rgba?\(/, `no hard-coded colour: ${rule}`)
    }
    assert.match(css, /\.mb-ext_space-feed-bad-links\[hidden\] \{\n\s+display: none;/)
})
