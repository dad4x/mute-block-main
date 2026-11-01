'use strict'

// Space classification sticks (29 Oct). The space page's writers (content.js) and the worker's registry write (sw.js) run here in
// separate vm contexts over one fake clock. A page's writes sit in an outbox, so a test can deliver them to the worker in any order,
// the way a delayed message or a second tab would.

const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')

const tunables = require('../shared/js/tunables.js')

const ROOT = path.join(__dirname, '..')

function readRepoFile(relativePath) {
    return fs.readFileSync(path.join(ROOT, relativePath), 'utf8')
}

// The function's source, from its signature to its closing brace (the same helper as p1-contract.test.js).
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
    throw new Error(`unclosed body for ${signature}`)
}

// What crosses the runtime-message boundary is a copy, never the same object.
function clone(value) {
    return JSON.parse(JSON.stringify(value))
}

const KEY_X = 'quora-space:https://trollsgalore.quora.com'
const KEY_Y = 'quora-space:https://other.quora.com'
const X_DESC = {key: KEY_X, url: 'https://trollsgalore.quora.com', slug: 'trollsgalore', name: 'Trolls galore'}
const X_NEUTRAL = {key: KEY_X, url: 'https://trollsgalore.quora.com', slug: 'trollsgalore', name: 'Trolls galore', category: 'neutral', collectCount: 100, updatedAt: 1}
const X_ASSET = {...X_NEUTRAL, category: 'asset', updatedAt: 1}
const Y_TARGET = {key: KEY_Y, url: 'https://other.quora.com', slug: 'other', name: 'Other', category: 'target', collectCount: 100, updatedAt: 1}
const Y_NEUTRAL = {...Y_TARGET, category: 'neutral'}

// spaceRegistry.js runs inside the context, so its Date is the test clock: the page's time and the worker's stamp come from one clock.
function loadRegistryModule(context) {
    const moduleShim = {exports: {}}
    // A vm context has no URL global, and normalizeSpaceUrl needs one.
    context.URL = URL
    context.module = moduleShim
    context.exports = moduleShim.exports
    context.require = name => require(path.join(ROOT, 'shared', 'js', name.replace(/^\.\//, '')))
    vm.runInContext(readRepoFile('shared/js/spaceRegistry.js'), context)
}

// One space page: the category click and the collect-count change, with the page's own copy of the registry.
function loadSpacePage(clock, descriptor, registryMap) {
    const source = readRepoFile('shared/js/content.js')
    const page = {outbox: []}
    const context = vm.createContext({
        Date: {now: () => clock.now},
        PROFILE_SEARCH_COLLECT_CHOICES: tunables.PROFILE_SEARCH_COLLECT_CHOICES,
        resolveCurrentSpaceDescriptor: () => descriptor,
        syncSpaceClassificationControls: () => {},
        scheduleSpaceAssetNukeControls: () => {},
        syncSpaceFeedCollectButton: () => {},
        safeSendRuntimeMessage: message => {
            page.outbox.push(clone(message))
            // With deliverTo set, the message reaches the worker at once and its reply comes back; otherwise it waits in the outbox.
            if(page.deliverTo) return page.deliverTo.receive(message)
            return Promise.resolve(null)
        }
    })
    loadRegistryModule(context)
    vm.runInContext([
        `let spaceRegistry = ${JSON.stringify(registryMap)}`,
        'let spaceFeedCollectLimit = 100',
        "let spaceFeedCollectKey = ''",
        'let spaceFeedCollecting = false',
        extractFunction(source, 'function getStoredSpaceRecord(space)'),
        extractFunction(source, 'function getStoredSpaceCategory(space)'),
        extractFunction(source, 'async function setCurrentSpaceCategory(space, category)'),
        extractFunction(source, 'async function persistSpaceFeedCollectCount(value)'),
        extractFunction(source, 'function setSpaceFeedCollectLimit(value)'),
        extractFunction(source, 'function syncSpaceFeedCollectLimitFromRecord()'),
        extractFunction(source, 'function mergeIncomingSpaceRecords(incoming)'),
        extractFunction(source, 'function applySpaceRecordReply(key, reply)')
    ].join('\n'), context)
    page.run = code => vm.runInContext(code, context)
    page.copy = () => clone(vm.runInContext('spaceRegistry', context))
    page.deliverTo = null
    return page
}

// The worker's registry write and the 1.5 import, from sw.js. The stored map is read as a copy, so a read can be taken before a write
// lands and used after it (the race the import has). `readGate`, when set, holds the next storage read after its snapshot is taken.
function loadWorker(clock, registryMap, legacyMap = null) {
    const source = readRepoFile('shared/js/sw.js')
    const worker = {
        stored: {mbSpaceRegistry: clone(registryMap)},
        legacy: legacyMap ? {mbSpaceRegistry: clone(legacyMap)} : {},
        readGate: null
    }
    const context = vm.createContext({
        Date: {now: () => clock.now},
        SPACE_REGISTRY_IMPORT_MARKER_KEY: 'mbSpaceRegistryImportedFromV15',
        incrementQueueWakeupMetric: () => {},
        browser: {},
        readPlainLocalNames: async () => clone(worker.legacy),
        metricStorageGet: async () => {
            const snapshot = clone(worker.stored)
            const gate = worker.readGate
            worker.readGate = null
            if(gate) await gate
            return snapshot
        },
        metricStorageSet: async payload => {
            Object.assign(worker.stored, clone(payload))
            return undefined
        }
    })
    loadRegistryModule(context)
    const spaceRegistryLet = source.match(/^let spaceRegistryWriteTail = .*$/m)
    vm.runInContext([
        spaceRegistryLet ? spaceRegistryLet[0] : '',
        extractFunction(source, 'function runSpaceRegistryExclusive(task)'),
        extractFunction(source, 'async function setSpaceRecordRequested(input = {})'),
        extractFunction(source, 'async function importSpaceRegistryFromVersion15()')
    ].join('\n'), context)
    // One message, dispatched the way swBootstrap.js does it.
    worker.receive = message => {
        context.__message = clone(message)
        return vm.runInContext('setSpaceRecordRequested(__message)', context)
    }
    worker.runImport = () => vm.runInContext('importSpaceRegistryFromVersion15()', context)
    worker.registry = () => clone(worker.stored.mbSpaceRegistry || {})
    return worker
}

const tests = []
function test(name, fn) {
    tests.push({name, fn})
}

// Reproduction: the owner clicked Asset, then a page whose copy was taken before the click has its count write arrive late.
// The late write carries that page's copy, with neutral for this space, and it must not put neutral back.
test('space classification sticks: a stale write sent after a category click does not revert it (29 Oct)', async () => {
    const clock = {now: 1000}
    const seeded = {[KEY_X]: X_NEUTRAL, [KEY_Y]: Y_TARGET}
    const stale = loadSpacePage(clock, X_DESC, seeded)
    const clicker = loadSpacePage(clock, X_DESC, seeded)
    const worker = loadWorker(clock, seeded)

    // The stale page changes the count at t=1000 while its copy still says neutral. Its message is delivered later.
    stale.run('setSpaceFeedCollectLimit(25)')
    clock.now = 2000
    await clicker.run(`setCurrentSpaceCategory(${JSON.stringify(X_DESC)}, 'asset')`)

    for(const message of clicker.outbox) await worker.receive(message)
    for(const message of stale.outbox) await worker.receive(message)

    assert.equal(worker.registry()[KEY_X].category, 'asset', 'the click stays in storage')
    assert.equal(worker.registry()[KEY_Y].category, 'target', 'the other space keeps its category')
})

// Two spaces: a page whose copy is stale for space Y changes the count on space X. Y must keep its stored category.
test('two spaces keep their categories after a collect-count change on one, when the page copy is stale for the other (29 Oct)', async () => {
    const clock = {now: 1000}
    const seeded = {[KEY_X]: X_NEUTRAL, [KEY_Y]: Y_TARGET}
    const stalePage = loadSpacePage(clock, X_DESC, {[KEY_X]: X_NEUTRAL, [KEY_Y]: Y_NEUTRAL})
    const worker = loadWorker(clock, seeded)

    await stalePage.run('setSpaceFeedCollectLimit(25)')
    for(const message of stalePage.outbox) await worker.receive(message)

    assert.equal(worker.registry()[KEY_Y].category, 'target', 'space Y is not written back from the stale copy')
    assert.equal(worker.registry()[KEY_X].category, 'neutral', 'space X keeps its category')
    assert.equal(worker.registry()[KEY_X].collectCount, 25, 'the count is kept on space X')
})

// The 1.5 import reads the registry, then writes the whole merged map. A click that lands between its read and its write must survive it.
test('the 1.5 import cannot put an older category back over a click that lands during its read (29 Oct)', async () => {
    const clock = {now: 1000}
    const worker = loadWorker(clock, {}, {[KEY_X]: X_NEUTRAL})
    const clicker = loadSpacePage(clock, X_DESC, {})

    let release
    worker.readGate = new Promise(resolve => { release = resolve })
    const importing = worker.runImport()
    await clicker.run(`setCurrentSpaceCategory(${JSON.stringify(X_DESC)}, 'asset')`)
    const clicking = worker.receive(clicker.outbox[0])
    clock.now = 2000
    release()
    await Promise.all([importing, clicking])

    assert.equal(worker.registry()[KEY_X].category, 'asset', 'the click is not overwritten by the imported neutral')
})

// A click the worker refuses (another tab changed the space later) shows the stored category on the page, not the refused click.
test('a refused click shows the stored category on the page, not the refused one (29 Oct)', async () => {
    const clock = {now: 4000}
    const seeded = {[KEY_X]: {...X_ASSET, updatedAt: 5000}}
    const worker = loadWorker(clock, seeded)
    const page = loadSpacePage(clock, X_DESC, seeded)
    page.deliverTo = worker

    await page.run(`setCurrentSpaceCategory(${JSON.stringify(X_DESC)}, 'neutral')`)

    assert.equal(worker.registry()[KEY_X].category, 'asset', 'storage keeps the newer category')
    assert.equal(page.copy()[KEY_X].category, 'asset', 'the page copy is the stored record')
})

// Two clicks, delivered in the order they were made, leave the later one stored and shown.
test('two clicks on one space, delivered in order, leave the later category stored (29 Oct)', async () => {
    const clock = {now: 1000}
    const seeded = {[KEY_X]: X_NEUTRAL}
    const worker = loadWorker(clock, seeded)
    const page = loadSpacePage(clock, X_DESC, seeded)
    page.deliverTo = worker

    await page.run(`setCurrentSpaceCategory(${JSON.stringify(X_DESC)}, 'asset')`)
    clock.now = 2000
    await page.run(`setCurrentSpaceCategory(${JSON.stringify(X_DESC)}, 'target')`)

    assert.equal(worker.registry()[KEY_X].category, 'target')
    assert.equal(page.copy()[KEY_X].category, 'target')
})

// Two clicks, both made before the worker applies either (the messages are delivered late, in order): the later click is stored.
test('two clicks delivered late, in order, keep the later one, because the order is the time the user acted (29 Oct)', async () => {
    const clock = {now: 1000}
    const seeded = {[KEY_X]: X_NEUTRAL}
    const page = loadSpacePage(clock, X_DESC, seeded)
    const worker = loadWorker(clock, seeded)

    await page.run(`setCurrentSpaceCategory(${JSON.stringify(X_DESC)}, 'asset')`)
    clock.now = 1003
    await page.run(`setCurrentSpaceCategory(${JSON.stringify(X_DESC)}, 'target')`)
    clock.now = 1010
    for(const message of page.outbox) await worker.receive(message)

    assert.equal(worker.registry()[KEY_X].category, 'target', 'the second click was made after the first, so it is kept')
})

// --- The category display, on a small fake DOM. Only the calls the sync and the refresh check make are implemented. ---

function fakeElement(tag) {
    const classes = new Set()
    const el = {
        tagName: String(tag).toUpperCase(),
        dataset: {},
        attributes: {},
        children: [],
        parentElement: null,
        style: {},
        textContent: '',
        offsetParent: {},
        get className() {
            return [...classes].join(' ')
        },
        set className(value) {
            classes.clear()
            for(const name of String(value).split(/\s+/).filter(Boolean)) classes.add(name)
        },
        classList: {
            contains: name => classes.has(name),
            add: name => { classes.add(name) },
            remove: name => { classes.delete(name) },
            toggle: (name, on) => {
                const want = on === undefined ? !classes.has(name) : !!on
                if(want) classes.add(name)
                else classes.delete(name)
                return want
            }
        },
        get nextElementSibling() {
            const parent = el.parentElement
            if(!parent) return null
            return parent.children[parent.children.indexOf(el) + 1] || null
        },
        _classes: classes,
        appendChild(child) {
            detachFake(child)
            child.parentElement = el
            el.children.push(child)
            return child
        },
        insertBefore(child, reference) {
            detachFake(child)
            child.parentElement = el
            const index = reference ? el.children.indexOf(reference) : -1
            if(index < 0) el.children.push(child)
            else el.children.splice(index, 0, child)
            return child
        },
        remove() {
            detachFake(el)
        },
        setAttribute(name, value) {
            el.attributes[name] = String(value)
        },
        getAttribute(name) {
            return Object.prototype.hasOwnProperty.call(el.attributes, name) ? el.attributes[name] : null
        },
        addEventListener() {},
        matches: selector => matchesFakeSelector(el, selector),
        closest(selector) {
            for(let node = el; node; node = node.parentElement) {
                if(matchesFakeSelector(node, selector)) return node
            }
            return null
        },
        querySelector(selector) {
            return fakeDescendants(el).find(node => matchesFakeSelector(node, selector)) || null
        },
        querySelectorAll(selector) {
            return fakeDescendants(el).filter(node => matchesFakeSelector(node, selector))
        }
    }
    return el
}

function detachFake(child) {
    const parent = child.parentElement
    if(!parent) return
    const index = parent.children.indexOf(child)
    if(index >= 0) parent.children.splice(index, 1)
    child.parentElement = null
}

function fakeDescendants(root) {
    const found = []
    const walk = node => {
        for(const child of node.children) {
            found.push(child)
            walk(child)
        }
    }
    walk(root)
    return found
}

// Compound selectors only (a tag, classes, and attribute equals), joined by commas. That is all the sync uses.
function matchesFakeSelector(el, selector) {
    return String(selector).split(',').some(part => {
        const compound = part.trim()
        const tag = compound.match(/^[a-zA-Z][\w-]*/)
        if(tag && el.tagName.toLowerCase() !== tag[0].toLowerCase()) return false
        for(const match of compound.matchAll(/\.([\w-]+)/g)) {
            if(!el._classes.has(match[1])) return false
        }
        for(const match of compound.matchAll(/\[([\w-]+)="([^"]*)"\]/g)) {
            const actual = match[1].startsWith('data-')
                ? el.dataset[match[1].slice(5).replace(/-([a-z])/g, (_, letter) => letter.toUpperCase())]
                : el.attributes[match[1]]
            if(String(actual ?? '') !== match[2]) return false
        }
        return true
    })
}

function fakeDocument() {
    const body = fakeElement('body')
    return {
        body,
        documentElement: body,
        createElement: tag => fakeElement(tag),
        querySelector: selector => fakeDescendants(body).find(node => matchesFakeSelector(node, selector)) || null,
        querySelectorAll: selector => fakeDescendants(body).filter(node => matchesFakeSelector(node, selector))
    }
}

function fakeSpaceHeader() {
    const header = fakeElement('div')
    header.className = 'puppeteer_test_tribe_info_header'
    return header
}

// The functions the category display runs, from content.js. A helper that does not exist yet is left out (extractIfPresent).
function extractIfPresent(source, signature) {
    return source.includes(signature) ? extractFunction(source, signature) : ''
}

function loadSpaceClassificationDisplay(doc, descriptor, registryMap, storageMap = registryMap, loaded = true, clock = {now: 0}) {
    const source = readRepoFile('shared/js/content.js')
    const pendingReplies = []
    const context = vm.createContext({
        Date: {now: () => clock.now},
        document: doc,
        resolveCurrentSpaceDescriptor: () => descriptor,
        setMuteBlockHelp: () => {},
        getElementText: element => element.textContent || '',
        scheduleSpaceClassificationControls: () => { vm.runInContext('syncSpaceClassificationControls()', context) },
        activateSpacePageControls: () => { vm.runInContext('syncSpaceClassificationControls()', context) },
        scheduleSpaceAssetNukeControls: () => {},
        syncSpaceFeedCollectLimitFromRecord: () => {},
        // A write the page sends waits for its reply, which the test delivers (resolveReply), so the reply can land before or after an event.
        safeSendRuntimeMessage: () => new Promise(resolve => { pendingReplies.push(resolve) }),
        safeStorageGet: async () => ({mbSpaceRegistry: clone(storageMap)}),
        getPageType: () => 'space',
        namespaceChanges: changes => changes,
        defaults: {},
        settings: {}
    })
    loadRegistryModule(context)
    vm.runInContext([
        `let spaceRegistry = ${JSON.stringify(registryMap)}`,
        `let spaceRegistryLoaded = ${loaded ? 'true' : 'false'}`,
        extractIfPresent(source, 'function mergeIncomingSpaceRecords(incoming)'),
        extractFunction(source, 'async function setCurrentSpaceCategory(space, category)'),
        extractFunction(source, 'function applySpaceRecordReply(key, reply)'),
        extractIfPresent(source, 'async function loadSpaceRegistryFromStorage()'),
        extractIfPresent(source, 'function activateSpacePageFromNavigation()'),
        extractFunction(source, 'function getSpaceHeaderContainer()'),
        extractFunction(source, 'function getSpaceHeaderActionControl(header = getSpaceHeaderContainer())'),
        extractFunction(source, 'function getSpaceHeaderActionRow(header = getSpaceHeaderContainer())'),
        extractFunction(source, 'function getSpaceHeaderActionInsertBefore(row)'),
        extractFunction(source, 'function getStoredSpaceRecord(space)'),
        extractFunction(source, 'function getStoredSpaceCategory(space)'),
        extractFunction(source, 'function getSpaceCategoryForButtonState(category, activeCategory)'),
        extractFunction(source, 'function getSpaceCategoryHelpText(category)'),
        extractIfPresent(source, 'function getSpaceHeaderContainers()'),
        extractFunction(source, 'function syncSpaceClassificationControls()'),
        extractIfPresent(source, 'function syncSpaceClassificationControlsInHeader(header, space)'),
        extractFunction(source, 'function shouldRefreshSpaceClassificationControls()'),
        extractIfPresent(source, 'function shouldRefreshSpaceClassificationControlsInHeader(header, space)'),
        extractFunction(source, 'function onStorageChanged(changes, areaName)')
    ].join('\n'), context)
    return {
        sync: () => vm.runInContext('syncSpaceClassificationControls()', context),
        shouldRefresh: () => vm.runInContext('shouldRefreshSpaceClassificationControls()', context),
        storageChanged: changes => {
            context.__changes = changes
            vm.runInContext("onStorageChanged(__changes, 'local')", context)
        },
        // The navigation into a space page. It must load the registry before it draws the controls (29 Oct).
        // The page's own click: the category write. The reply is delivered later with resolveReply.
        click: category => vm.runInContext(`setCurrentSpaceCategory(${JSON.stringify(descriptor)}, ${JSON.stringify(category)})`, context),
        resolveReply: reply => pendingReplies.shift()(reply),
        // The registry load alone, as init runs it (no navigation, no other call).
        loadRegistry: () => vm.runInContext('loadSpaceRegistryFromStorage()', context),
        enterSpacePage: () => {
            assert.ok(vm.runInContext("typeof activateSpacePageFromNavigation === 'function'", context),
                'entering a space page by navigation loads the registry first, then draws the controls')
            return vm.runInContext('activateSpacePageFromNavigation()', context)
        },
        copyIsLoaded: () => vm.runInContext('spaceRegistryLoaded', context)
    }
}

// The page's descriptor and the stored lookup, from content.js, on a given document. Used for the key variants.
function loadKeyReader(doc, registryMap) {
    const source = readRepoFile('shared/js/content.js')
    const href = doc.location?.href || ''
    const context = vm.createContext({
        Date: {now: () => 0},
        document: doc,
        location: {href, hostname: href ? new URL(href).hostname : ''}
    })
    loadRegistryModule(context)
    vm.runInContext([
        `let spaceRegistry = ${JSON.stringify(registryMap)}`,
        extractFunction(source, 'function getSpaceHeaderContainer()'),
        extractFunction(source, 'function getSpaceIdentityUrl()'),
        extractFunction(source, 'function resolveCurrentSpaceDescriptor()'),
        extractFunction(source, 'function getStoredSpaceRecord(space)'),
        extractFunction(source, 'function getStoredSpaceCategory(space)')
    ].join('\n'), context)
    return {
        key: () => vm.runInContext('resolveCurrentSpaceDescriptor().key', context),
        category: () => vm.runInContext('getStoredSpaceCategory(resolveCurrentSpaceDescriptor())', context)
    }
}

// The category each header copy shows: the buttons that are pressed in its own set, or null when the copy has no set.
function pressedCategoriesInCopy(header) {
    const host = header.querySelector('.mb-ext_space-category-host')
    if(!host) return null
    return host.querySelectorAll('.mb-ext_space-category-btn')
        .filter(button => button.getAttribute('aria-pressed') === 'true')
        .map(button => button.dataset.category)
}

function assertEveryCopyShows(doc, category, label) {
    const copies = doc.querySelectorAll('.puppeteer_test_tribe_info_header')
    assert.ok(copies.length >= 1, `${label}: the page has a header`)
    copies.forEach((copy, index) => {
        assert.deepEqual(pressedCategoriesInCopy(copy), [category], `${label}: header copy ${index + 1} shows ${category}`)
    })
}

// The display, with two copies of the space header on the page. The second copy was drawn first (a stale set, Neutral). Quora then draws
// a second copy above it, and a storage change moves the space to asset. The page must show asset in every copy, and keep showing it for
// 30 seconds of mutation-driven checks with no clicks.
test('space classification display: every copy of the header shows the stored category after a storage change, and holds it with no clicks (29 Oct)', () => {
    const clock = {now: 1000}
    const doc = fakeDocument()
    const second = fakeSpaceHeader()
    doc.body.appendChild(second)
    const page = loadSpaceClassificationDisplay(doc, X_DESC, {[KEY_X]: X_NEUTRAL})

    page.sync()
    assertEveryCopyShows(doc, 'neutral', 'before the storage change')

    const first = fakeSpaceHeader()
    doc.body.insertBefore(first, second)
    page.storageChanged({mbSpaceRegistry: {newValue: {[KEY_X]: X_ASSET}}})
    assertEveryCopyShows(doc, 'asset', 'after the storage change')

    for(let tick = 0; tick < 30; tick += 1) {
        clock.now += 1000
        if(page.shouldRefresh()) page.sync()
        assertEveryCopyShows(doc, 'asset', `${tick + 1} s with no clicks`)
    }
})

// The reader's key for the space page, for each form the og:url, the canonical link or the location takes. The click writes under the same
// key (both come from resolveCurrentSpaceDescriptor), so the lookup must find the record in every form.
test('space key: the reader finds the stored record whatever form the page URL takes (29 Oct)', () => {
    const forms = [
        {name: 'og:url with a trailing slash', og: 'https://trollsgalore.quora.com/'},
        {name: 'og:url without a slash', og: 'https://trollsgalore.quora.com'},
        {name: 'og:url with a query and a hash', og: 'https://trollsgalore.quora.com/?sort=recent#top'},
        {name: 'canonical link with a slash, no og:url', canonical: 'https://trollsgalore.quora.com/'},
        {name: 'the location, no tags', location: 'https://trollsgalore.quora.com/'}
    ]
    for(const form of forms) {
        const doc = fakeDocument()
        doc.location = {href: form.location || 'https://trollsgalore.quora.com/'}
        if(form.og) {
            const meta = fakeElement('meta')
            meta.setAttribute('property', 'og:url')
            meta.content = form.og
            doc.body.appendChild(meta)
        }
        if(form.canonical) {
            const link = fakeElement('link')
            link.setAttribute('rel', 'canonical')
            link.href = form.canonical
            doc.body.appendChild(link)
        }
        const reader = loadKeyReader(doc, {[KEY_X]: X_ASSET})
        assert.equal(reader.key(), KEY_X, form.name)
        assert.equal(reader.category(), 'asset', `${form.name}: the lookup finds the stored record`)
    }
})

// The owner's page can be entered by navigation (a profile-search page, then a space page in the same content script). Then the registry was
// never loaded: init returns before the load on the profile-search and redirect paths (content.js 418-422). The page draws the defaults
// (Neutral, unset) and does not reload the registry, so it shows Neutral while storage holds asset. Entering the space page must load it.
test('space page entered by navigation: the registry loads before the category is drawn, so the stored category shows (29 Oct)', async () => {
    const doc = fakeDocument()
    doc.body.appendChild(fakeSpaceHeader())
    const page = loadSpaceClassificationDisplay(doc, X_DESC, {}, {[KEY_X]: X_ASSET}, false)

    page.sync()
    assertNoCopyShowsDefault(doc, 'before the registry loads')

    await page.enterSpacePage()
    assert.equal(page.copyIsLoaded(), true, 'the registry is loaded on entry')
    assertEveryCopyShows(doc, 'asset', 'after entry loads the registry')
})

// A subdomain space page is the space the page is on. Its key must not follow an og:url or a canonical link that names another URL, which
// can change while the page is open (29 Oct). The owner's live page shows the category flipping with no clicks.
test('space key: a subdomain space page keeps its own key when og:url or the canonical link names another URL (29 Oct)', () => {
    const forms = [
        {name: 'og:url names www', og: 'https://www.quora.com/'},
        {name: 'og:url names another space', og: 'https://another-space.quora.com/'},
        {name: 'canonical link names www', canonical: 'https://www.quora.com/trollsgalore'}
    ]
    for(const form of forms) {
        const doc = fakeDocument()
        doc.location = {href: 'https://trollsgalore.quora.com/'}
        if(form.og) {
            const meta = fakeElement('meta')
            meta.setAttribute('property', 'og:url')
            meta.content = form.og
            doc.body.appendChild(meta)
        }
        if(form.canonical) {
            const link = fakeElement('link')
            link.setAttribute('rel', 'canonical')
            link.href = form.canonical
            doc.body.appendChild(link)
        }
        const reader = loadKeyReader(doc, {[KEY_X]: X_ASSET})
        assert.equal(reader.key(), KEY_X, form.name)
        assert.equal(reader.category(), 'asset', `${form.name}: the lookup finds the stored record`)
    }
})

// A draw must never show the default for a space that has a record. Before the registry has loaded, the copy is empty, so the draw must wait.
function assertNoCopyShowsDefault(doc, label) {
    doc.querySelectorAll('.puppeteer_test_tribe_info_header').forEach((copy, index) => {
        assert.notDeepEqual(pressedCategoriesInCopy(copy), ['neutral'], `${label}: header copy ${index + 1} does not show the default`)
    })
}

// Two kinds of draw: one before the registry loads (an observer check or a timer), and draws after it. The display never shows the default
// for this space, and the loaded flag is never reset (29 Oct).
test('space classification draw: no draw shows the default before the registry loads, and draws after the load keep the stored category (29 Oct)', async () => {
    const doc = fakeDocument()
    doc.body.appendChild(fakeSpaceHeader())
    const page = loadSpaceClassificationDisplay(doc, X_DESC, {}, {[KEY_X]: X_ASSET}, false)

    page.sync()
    assertNoCopyShowsDefault(doc, 'a draw before the registry loads')
    assert.equal(page.copyIsLoaded(), false)

    await page.enterSpacePage()
    assert.equal(page.copyIsLoaded(), true)
    assertEveryCopyShows(doc, 'asset', 'after the load')

    for(let tick = 0; tick < 10; tick += 1) {
        if(page.shouldRefresh()) page.sync()
        page.sync()
        assertEveryCopyShows(doc, 'asset', `draw ${tick + 1} after the load`)
    }
    assert.equal(page.copyIsLoaded(), true, 'the loaded flag is not reset by later draws')
})

// A fresh space page: the first render comes before the registry loads (nothing is drawn), and the load alone must draw the stored category.
// The live page showed Neutral after a fresh load with the record stored as asset, and no further event (29 Oct).
test('space page render: the registry loads after the first render, and the stored category shows with no further event (29 Oct)', async () => {
    const doc = fakeDocument()
    doc.body.appendChild(fakeSpaceHeader())
    const page = loadSpaceClassificationDisplay(doc, X_DESC, {}, {[KEY_X]: X_ASSET}, false)

    page.sync()
    assertNoCopyShowsDefault(doc, 'the first render')

    await page.loadRegistry()
    assert.equal(page.copyIsLoaded(), true)
    assertEveryCopyShows(doc, 'asset', 'after the load, with no further event')
})

// The page's own click, then the worker's reply and the storage event for it, in each order. A stale event (the Neutral record from before
// the click) arriving after the click must not put Neutral back. The owner's live page showed Asset, then Neutral about half a second later,
// with storage holding the new write (29 Oct).
test('space classification after the page writes: the reply and the storage event, in any order, leave the display on the clicked category (29 Oct)', async () => {
    const orders = [
        ['event', 'reply'],
        ['reply', 'event'],
        ['stale-event', 'event', 'reply'],
        ['reply', 'stale-event']
    ]
    for(const order of orders) {
        const label = order.join(' then ')
        const clock = {now: 1000}
        const doc = fakeDocument()
        doc.body.appendChild(fakeSpaceHeader())
        const page = loadSpaceClassificationDisplay(doc, X_DESC, {[KEY_X]: X_NEUTRAL}, {[KEY_X]: X_NEUTRAL}, true, clock)
        page.sync()
        assertEveryCopyShows(doc, 'neutral', `${label}: before the click`)

        clock.now = 2000
        const click = page.click('asset')
        assertEveryCopyShows(doc, 'asset', `${label}: the click draws asset`)

        const stored = {[KEY_X]: {...X_ASSET, updatedAt: 2000}}
        for(const step of order) {
            if(step === 'event') page.storageChanged({mbSpaceRegistry: {newValue: stored}})
            else if(step === 'stale-event') page.storageChanged({mbSpaceRegistry: {newValue: {[KEY_X]: X_NEUTRAL}}})
            else page.resolveReply({ok: true, refused: false, record: stored[KEY_X]})
            assertEveryCopyShows(doc, 'asset', `${label}: after ${step}`)
        }
        await click
        assertEveryCopyShows(doc, 'asset', `${label}: after the click completes`)
    }
})

// The first render presses no category button, because the stored category is not known yet. The next draw, after the load, presses the stored
// one. Neutral is never pressed as a default (the live page flashed Neutral for about half a second on a fresh load, 29 Oct).
test('space page first render presses no category button, and the next draw presses the stored one (29 Oct)', async () => {
    const doc = fakeDocument()
    doc.body.appendChild(fakeSpaceHeader())
    const page = loadSpaceClassificationDisplay(doc, X_DESC, {}, {[KEY_X]: X_ASSET}, false)

    page.sync()
    for(const copy of doc.querySelectorAll('.puppeteer_test_tribe_info_header')) {
        assert.deepEqual(pressedCategoriesInCopy(copy) ?? [], [], 'no category is pressed before the stored one is known')
    }

    await page.loadRegistry()
    assertEveryCopyShows(doc, 'asset', 'the next draw, after the load')
})

// A space with no record, once the registry has loaded: no category is pressed. Neutral is not the default for an unset space.
test('a space with no record, after the registry loads, presses no category button (29 Oct)', () => {
    const doc = fakeDocument()
    doc.body.appendChild(fakeSpaceHeader())
    const page = loadSpaceClassificationDisplay(doc, X_DESC, {}, {}, true)

    page.sync()
    for(const copy of doc.querySelectorAll('.puppeteer_test_tribe_info_header')) {
        assert.deepEqual(pressedCategoriesInCopy(copy) ?? [], [], 'an unset space presses no category button')
    }
})

// Every test runs, so one failure does not hide the others. Any failure makes the exit code 1.
async function main() {
    let failed = 0
    for(const {name, fn} of tests) {
        try {
            await fn()
            console.log(`ok - ${name}`)
        }
        catch(error) {
            failed += 1
            console.error(`not ok - ${name}`)
            console.error(error.message)
        }
    }
    if(failed) {
        console.error(`${failed} of ${tests.length} failed`)
        process.exitCode = 1
    }
}

main().catch(error => {
    console.error(error)
    process.exitCode = 1
})
