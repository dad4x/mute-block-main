#!/usr/bin/env node

const fs = require('fs')
const path = require('path')

const {
    cdpCommand,
    evaluate,
    getJson,
    getTargets,
    runMain,
    sleep
} = require('../lib/cdp')

const DEFAULT_EXTENSION_ID = 'nlmmkoljofpgbmlcojebolmniineboah'
const DEFAULT_PROFILE_LABEL = 'store-1.4-to-current'
const DEFAULT_HOST = '127.0.0.1'
const DEFAULT_PORT = 9223
const PHASE1 = 'phase1-non-work-starting-smoke'
const PHASE2 = 'phase2-content-smoke'
const ACTION_REASON = 'upgrade-regression-non-work-starting'

const LEGACY_ACTIONS = [
    'record-nuke-progress',
    'record-nuke-progress-batch',
    'repair-coordinator-storage'
]

const CURRENT_ACTIONS = [
    'get-coordinator-queue-accounting',
    'get-coordinator-why-not-running',
    'refresh-queue-wakeup-metrics-view'
]

const PREFERENCE_KEYS = new Set([
    'coordinatorAutoStartOnBrowserStart',
    'flipToAnswers',
    'fopDelay',
    'fopFlipDelay',
    'maxRememberedNukedPosts',
    'nukedPostRetentionDays',
    'profilesPerBatch'
])

const ALLOWED_STORAGE_KEY_PATTERNS = [
    /^mbProfileNukeProgressView$/,
    /^mbProfileNukeProgressShard\./,
    /^mbCoordinator/,
    /^mbQueueWakeupMetrics(?:View)?$/,
    /^mbSpace(?:Registry|PendingNukedPosts|NukedPosts)$/,
    /^mbOwnedTabIdsByParent$/,
    /^mbBrowserSessionMarker$/,
    /^mbQuoraRuntimeActivated$/,
    /^mbQueuedActionSurfaceState$/
]

const FORBIDDEN_STORAGE_KEY_PATTERNS = [
    /^mbProfileNukeProgress$/,
    /PROFILE_NUKE_PROGRESS_KEY/,
    /record-nuke-progress/,
    /record-nuke-progress-batch/,
    /legacyImport/,
    /importLegacy/,
    /repair-coordinator-storage/,
    /mb-stored-work-repair/,
    /skipRepair/,
    /projectionRepairDelayMs/
]

const ALLOWED_ADDED_STORAGE_KEYS = new Set([
    'mbCoordinatorQueueView',
    'mbQueueWakeupMetrics',
    'mbQueueWakeupMetricsView'
])

const ALLOWED_PHASE2_ADDED_STORAGE_KEY_PATTERNS = [
    /^mbCoordinatorQueueView$/,
    /^mbQueueWakeupMetrics(?:View)?$/,
    /^mbCoordinatorContentQueueIndex$/,
    /^mbCoordinatorContentSourceIndex\./,
    /^mbProfileNukeProgressView$/,
    /^mbProfileNukeProgressShard\./,
    /^mbBrowserSessionMarker$/,
    /^mbQuoraRuntimeActivated$/
]

function parseArgs(argv) {
    const options = {
        host: DEFAULT_HOST,
        port: DEFAULT_PORT,
        extensionId: DEFAULT_EXTENSION_ID,
        profileLabel: DEFAULT_PROFILE_LABEL,
        writeBaseline: '',
        compareBaseline: '',
        phase: PHASE1,
        quoraUrl: '',
        verbose: false
    }

    for(let index = 2; index < argv.length; index += 1) {
        const arg = argv[index]
        const readValue = defaultValue => {
            const next = argv[index + 1]
            if(next && !next.startsWith('--')) {
                index += 1
                return next
            }
            return defaultValue
        }

        if(arg === '--host') options.host = readValue(options.host)
        else if(arg.startsWith('--host=')) options.host = arg.slice('--host='.length)
        else if(arg === '--port') options.port = Number.parseInt(readValue(`${options.port}`), 10) || DEFAULT_PORT
        else if(arg.startsWith('--port=')) options.port = Number.parseInt(arg.slice('--port='.length), 10) || DEFAULT_PORT
        else if(arg === '--extension-id') options.extensionId = readValue(options.extensionId)
        else if(arg.startsWith('--extension-id=')) options.extensionId = arg.slice('--extension-id='.length)
        else if(arg === '--profile-label') options.profileLabel = readValue(options.profileLabel)
        else if(arg.startsWith('--profile-label=')) options.profileLabel = arg.slice('--profile-label='.length)
        else if(arg === '--write-baseline') options.writeBaseline = readValue(defaultBaselinePath(options.profileLabel))
        else if(arg.startsWith('--write-baseline=')) options.writeBaseline = arg.slice('--write-baseline='.length)
        else if(arg === '--compare-baseline') options.compareBaseline = readValue('')
        else if(arg.startsWith('--compare-baseline=')) options.compareBaseline = arg.slice('--compare-baseline='.length)
        else if(arg === '--phase') options.phase = readValue(options.phase)
        else if(arg.startsWith('--phase=')) options.phase = arg.slice('--phase='.length)
        else if(arg === '--quora-url') options.quoraUrl = readValue('')
        else if(arg.startsWith('--quora-url=')) options.quoraUrl = arg.slice('--quora-url='.length)
        else if(arg === '--verbose') options.verbose = true
        else if(arg === '--help' || arg === '-h') {
            printUsage()
            process.exit(0)
        }
        else throw new Error(`unknown argument: ${arg}`)
    }

    if(!options.extensionId) throw new Error('--extension-id is required')
    if(![PHASE1, PHASE2].includes(options.phase)) {
        throw new Error(`unsupported --phase ${options.phase}; expected ${PHASE1} or ${PHASE2}`)
    }
    if(options.compareBaseline === true || options.compareBaseline === '') {
        if(argv.includes('--compare-baseline')) throw new Error('--compare-baseline requires a path')
    }
    return options
}

function printUsage() {
    console.log([
        'Usage:',
        '  node tools/cdp/upgrade-regression/run.js --extension-id nlmmkoljofpgbmlcojebolmniineboah',
        '',
        'Options:',
        '  --host 127.0.0.1',
        '  --port 9223',
        '  --profile-label store-1.4-to-current',
        `  --phase ${PHASE1}|${PHASE2}`,
        '  --quora-url https://www.quora.com/',
        '  --write-baseline [path]',
        '  --compare-baseline path',
        '  --verbose'
    ].join('\n'))
}

function defaultBaselinePath(profileLabel) {
    const safeLabel = `${profileLabel || DEFAULT_PROFILE_LABEL}`.replace(/[^a-z0-9._-]+/gi, '-')
    return path.join('tmp', 'upgrade-regression', `${safeLabel}.phase1-non-work-starting-smoke.json`)
}

function readCurrentVersion() {
    const packagePath = path.resolve(__dirname, '..', '..', '..', 'package.json')
    return JSON.parse(fs.readFileSync(packagePath, 'utf8')).version
}

function validateExtensionInfo(extension, options, expectedVersion, fail, label = 'extension') {
    if(!extension) {
        fail(`${label} is not installed`, {extensionId: options.extensionId})
        return
    }

    if(extension.id !== options.extensionId) fail(`${label} id mismatch`, {expected: options.extensionId, actual: extension.id})
    if(extension.name !== 'Mute Block') fail(`${label} name mismatch`, {expected: 'Mute Block', actual: extension.name})
    if(extension.version !== expectedVersion) fail(`${label} version mismatch`, {expected: expectedVersion, actual: extension.version})
    if(extension.state !== 'ENABLED') fail(`${label} is not enabled`, {actual: extension.state})
    if(extension.manifestErrors.length) fail(`${label} manifest errors are present`, extension.manifestErrors)
    if(extension.runtimeErrors.length) fail(`${label} runtime errors are present`, extension.runtimeErrors)
    if(extension.runtimeWarnings.length) fail(`${label} runtime warnings are present`, extension.runtimeWarnings)
    if(extension.installWarnings.length) fail(`${label} install warnings are present`, extension.installWarnings)
}

async function ensureExtensionsPage(config, warnings) {
    let targets = await getTargets(config)
    let page = targets.find(target => target.url === 'chrome://extensions/')
    if(page) return page

    const versionInfo = await getJson('/json/version', config)
    await cdpCommand(versionInfo.webSocketDebuggerUrl, 'Target.createTarget', {
        url: 'chrome://extensions/',
        background: true
    }, 10000)
    warnings.push('opened chrome://extensions/ in the target browser to inspect extension metadata')
    await sleep(1000)
    targets = await getTargets(config)
    page = targets.find(target => target.url === 'chrome://extensions/')
    if(!page) throw new Error('chrome://extensions/ target not found')
    return page
}

async function getExtensionInfo(extensionsPage, extensionId) {
    return evaluate(extensionsPage.webSocketDebuggerUrl, `new Promise(resolve => {
        chrome.developerPrivate.getExtensionInfo(${JSON.stringify(extensionId)}, info => resolve(info ? {
            id: info.id,
            name: info.name,
            version: info.version,
            location: info.location,
            state: info.state,
            path: info.path || '',
            manifestErrors: (info.manifestErrors || []).map(error => error.message || error.description || String(error)),
            runtimeErrors: (info.runtimeErrors || []).map(error => error.message || error.description || String(error)),
            runtimeWarnings: (info.runtimeWarnings || []).map(error => error.message || error.description || String(error)),
            installWarnings: (info.installWarnings || []).map(error => error.message || error.description || String(error)),
            views: (info.views || []).map(view => ({type: view.type, url: view.url}))
        } : null))
    })`, 10000)
}

async function ensureExtensionContext(config, warnings) {
    const extensionPrefix = `chrome-extension://${config.extensionId}/`
    const dashboardUrl = `${extensionPrefix}coordinator.html`
    let targets = await getTargets(config)
    let target = targets.find(item => item.type === 'page' && item.url === dashboardUrl) ||
        targets.find(item => item.type === 'page' && (item.url || '').startsWith(extensionPrefix)) ||
        targets.find(item => item.type === 'service_worker' && (item.url || '').startsWith(extensionPrefix))

    if(target) return target

    const versionInfo = await getJson('/json/version', config)
    await cdpCommand(versionInfo.webSocketDebuggerUrl, 'Target.createTarget', {
        url: dashboardUrl,
        background: true
    }, 10000)
    warnings.push('opened coordinator.html as a display-only extension context for storage and runtime probes')
    await sleep(1000)

    targets = await getTargets(config)
    target = targets.find(item => item.type === 'page' && item.url === dashboardUrl) ||
        targets.find(item => item.type === 'page' && (item.url || '').startsWith(extensionPrefix)) ||
        targets.find(item => item.type === 'service_worker' && (item.url || '').startsWith(extensionPrefix))
    if(!target) throw new Error(`extension context not found for ${config.extensionId}`)
    return target
}

async function sendRuntimeMessage(target, payload, timeoutMs = 10000) {
    return evaluate(target.webSocketDebuggerUrl, `(${function sendMessage(message, timeout) {
        return new Promise(resolve => {
            const startedAt = Date.now()
            let settled = false
            const finish = value => {
                if(settled) return
                settled = true
                resolve({
                    elapsedMs: Date.now() - startedAt,
                    ...value
                })
            }

            setTimeout(() => finish({
                response: null,
                timedOut: true,
                lastError: ''
            }), timeout)

            chrome.runtime.sendMessage(message, response => finish({
                response: response || null,
                lastError: chrome.runtime.lastError ? chrome.runtime.lastError.message : ''
            }))
        })
    }})(${JSON.stringify(payload)}, ${JSON.stringify(timeoutMs)})`, timeoutMs + 5000)
}

async function readStorage(target) {
    return evaluate(target.webSocketDebuggerUrl, `(${function readLocalStorage() {
        return new Promise(resolve => {
            chrome.storage.local.get(null, data => {
                const keys = Object.keys(data || {}).sort()
                resolve({
                    keys,
                    data: data || {}
                })
            })
        })
    }})()`, 15000)
}

async function readAlarms(target) {
    return evaluate(target.webSocketDebuggerUrl, `(${function readExtensionAlarms() {
        return new Promise(resolve => {
            if(!chrome.alarms || typeof chrome.alarms.getAll !== 'function') {
                resolve({available: false, alarms: []})
                return
            }
            chrome.alarms.getAll(alarms => resolve({
                available: true,
                alarms: (alarms || []).map(alarm => ({
                    name: alarm.name,
                    scheduledTime: alarm.scheduledTime || 0,
                    periodInMinutes: alarm.periodInMinutes || 0
                })).sort((left, right) => left.name.localeCompare(right.name))
            }))
        })
    }})()`, 10000)
}

function isAllowedStorageKey(key) {
    return PREFERENCE_KEYS.has(key) || ALLOWED_STORAGE_KEY_PATTERNS.some(pattern => pattern.test(key))
}

function isAllowedAddedStorageKey(key, phase = PHASE1) {
    if(ALLOWED_ADDED_STORAGE_KEYS.has(key)) return true
    if(phase === PHASE2) return ALLOWED_PHASE2_ADDED_STORAGE_KEY_PATTERNS.some(pattern => pattern.test(key))
    return false
}

function diffStorageKeys(before = [], after = [], phase = PHASE1) {
    const beforeSet = new Set(before)
    const afterSet = new Set(after)
    const added = after.filter(key => !beforeSet.has(key)).sort()
    const removed = before.filter(key => !afterSet.has(key)).sort()
    const allowedAdded = added.filter(key => isAllowedAddedStorageKey(key, phase)).sort()
    const unexpectedAdded = added.filter(key => !isAllowedAddedStorageKey(key, phase)).sort()

    return {
        before,
        after,
        added,
        removed,
        allowedAdded,
        unexpectedAdded
    }
}

function allowedAddedStorageKeySummary(phase = PHASE1) {
    const literal = Array.from(ALLOWED_ADDED_STORAGE_KEYS).sort()
    if(phase !== PHASE2) return {literal, patterns: []}
    return {
        literal,
        patterns: ALLOWED_PHASE2_ADDED_STORAGE_KEY_PATTERNS.map(pattern => pattern.toString()).sort()
    }
}

function summarizeWorkState(storage) {
    const data = storage?.data || {}
    const queue = data.mbCoordinatorQueue && typeof data.mbCoordinatorQueue === 'object'
        ? data.mbCoordinatorQueue
        : {}
    const queueRows = Object.values(queue || {})
    const statusCounts = {}
    for(const row of queueRows) {
        const status = row?.status || row?.state || 'unknown'
        statusCounts[status] = (statusCounts[status] || 0) + 1
    }

    const view = data.mbCoordinatorQueueView && typeof data.mbCoordinatorQueueView === 'object'
        ? data.mbCoordinatorQueueView
        : {}
    const viewItems = Array.isArray(view.items) ? view.items :
        Array.isArray(view.rows) ? view.rows :
            Array.isArray(view.queue) ? view.queue : []
    const viewStatusCounts = {}
    for(const row of viewItems) {
        const status = row?.status || row?.state || 'unknown'
        viewStatusCounts[status] = (viewStatusCounts[status] || 0) + 1
    }

    const activeLike = row => /active|acting|opening|claim|running|pending/i.test(`${row?.status || row?.state || ''}`)
    const queuedLike = row => /queued|retry|waiting/i.test(`${row?.status || row?.state || ''}`)

    return {
        rawQueueRows: queueRows.length,
        rawStatusCounts: statusCounts,
        rawActiveLike: queueRows.filter(activeLike).length,
        rawQueuedLike: queueRows.filter(queuedLike).length,
        viewRows: viewItems.length,
        viewStatusCounts,
        viewActiveLike: viewItems.filter(activeLike).length,
        viewQueuedLike: viewItems.filter(queuedLike).length
    }
}

function comparableReport(report) {
    const extension = report.extension || {}
    const storageKeyDelta = report.storageKeyDelta || {}
    return {
        profileLabel: report.profileLabel,
        phase: report.phase,
        extension: {
            id: extension.id || '',
            name: extension.name || '',
            version: extension.version || '',
            location: extension.location || '',
            state: extension.state || '',
            manifestErrors: extension.manifestErrors || [],
            runtimeErrors: extension.runtimeErrors || [],
            runtimeWarnings: extension.runtimeWarnings || [],
            installWarnings: extension.installWarnings || []
        },
        storageKeys: report.storageKeys,
        storageKeyDelta: {
            unexpectedAdded: storageKeyDelta.unexpectedAdded || []
        },
        alarms: (report.alarms || []).map(alarm => alarm.name).sort(),
        legacyActions: report.legacyActions,
        reconcileDisplayOnly: report.reconcileDisplayOnly,
        workStateAfter: report.workStateAfter
    }
}

function summarizeMessageResult(result = {}) {
    const response = result.response || null
    return {
        ok: !result.timedOut && !result.lastError && response !== null,
        timedOut: result.timedOut === true,
        lastError: result.lastError || '',
        responseKeys: response && typeof response === 'object' ? Object.keys(response).sort() : [],
        readOnly: response?.readOnly === true,
        reason: response?.reason || '',
        displayOnly: response?.displayOnly === true,
        consistent: response?.consistent === true,
        refreshed: response?.refreshed === true,
        active: Number(response?.currentWork?.active || response?.durable?.durableActiveRows || 0) || 0,
        queued: Number(response?.currentWork?.ready || response?.durable?.durableQueuedRows || 0) || 0
    }
}

function summarizeLegacyMessageResult(result = {}) {
    return {
        accepted: result.response !== null,
        timedOut: result.timedOut === true,
        lastError: result.lastError || '',
        responseKeys: result.response && typeof result.response === 'object'
            ? Object.keys(result.response).sort()
            : []
    }
}

function summarizeContentStateResult(result = {}) {
    const value = result.value || {}
    const response = value.response || null
    return {
        ok: result.ok === true && !value.lastError && response !== null,
        probeOk: result.ok === true,
        error: result.error || '',
        lastError: value.lastError || '',
        responseKeys: response && typeof response === 'object' ? Object.keys(response).sort() : [],
        scoped: response?.scoped === true,
        pageType: response?.pageType || '',
        profileHrefCount: Number(response?.profileHrefCount || 0) || 0,
        queueRows: Number(response?.queueRows || 0) || 0,
        progressRows: Number(response?.progressRows || 0) || 0,
        senderTabId: response?.senderTabId || null,
        context: result.context || null,
        contexts: result.contexts || undefined
    }
}

function isQuoraUrl(url = '') {
    try {
        const parsed = new URL(url)
        return /^https:$/.test(parsed.protocol) && /(^|\.)quora\.com$/i.test(parsed.hostname)
    }
    catch {
        return false
    }
}

async function findOrOpenQuoraPage(config, quoraUrl, warnings) {
    if(quoraUrl && !isQuoraUrl(quoraUrl)) throw new Error(`--quora-url must be an https Quora URL: ${quoraUrl}`)

    let targets = await getTargets(config)
    let page = quoraUrl
        ? targets.find(target => target.type === 'page' && target.url === quoraUrl)
        : targets.find(target => target.type === 'page' && isQuoraUrl(target.url || ''))
    if(page) return page

    if(!quoraUrl) throw new Error('no Quora page target found; pass --quora-url for phase 2')

    const versionInfo = await getJson('/json/version', config)
    const created = await cdpCommand(versionInfo.webSocketDebuggerUrl, 'Target.createTarget', {
        url: quoraUrl,
        background: true
    }, 10000)
    warnings.push(`opened Quora URL for phase 2 content smoke: ${quoraUrl}`)
    await sleep(4000)

    targets = await getTargets(config)
    page = targets.find(target => target.id === created.targetId) ||
        targets.find(target => target.type === 'page' && isQuoraUrl(target.url || ''))
    if(!page) throw new Error(`Quora page target not found after opening ${quoraUrl}`)
    return page
}

async function evaluateInExtensionIsolatedWorld(target, extensionId, expression, timeoutMs = 15000) {
    const ws = new WebSocket(target.webSocketDebuggerUrl)
    const contexts = []
    let nextId = 1
    const pending = new Map()

    const send = (method, params = {}, commandTimeoutMs = timeoutMs) => {
        const id = nextId++
        ws.send(JSON.stringify({id, method, params}))
        return new Promise((resolve, reject) => {
            const timeout = setTimeout(() => {
                pending.delete(id)
                reject(new Error(`${method} timed out after ${commandTimeoutMs}ms`))
            }, commandTimeoutMs)
            pending.set(id, {resolve, reject, timeout})
        })
    }

    try {
        await new Promise((resolve, reject) => {
            const timeout = setTimeout(() => reject(new Error(`WebSocket timeout opening ${target.webSocketDebuggerUrl}`)), 5000)
            ws.addEventListener('open', () => {
                clearTimeout(timeout)
                resolve()
            }, {once: true})
            ws.addEventListener('error', event => {
                clearTimeout(timeout)
                reject(event.error || new Error(`WebSocket error for ${target.webSocketDebuggerUrl}`))
            }, {once: true})
        })

        ws.addEventListener('message', event => {
            const message = JSON.parse(event.data)
            if(message.method === 'Runtime.executionContextCreated') {
                contexts.push(message.params?.context || {})
                return
            }
            if(message.id && pending.has(message.id)) {
                const pendingCommand = pending.get(message.id)
                pending.delete(message.id)
                clearTimeout(pendingCommand.timeout)
                if(message.error) pendingCommand.reject(new Error(JSON.stringify(message.error)))
                else pendingCommand.resolve(message.result || {})
            }
        })

        await send('Runtime.enable', {}, 5000)
        await sleep(500)

        const extensionOrigin = `chrome-extension://${extensionId}`
        const context = contexts.find(candidate => candidate.origin === extensionOrigin) ||
            contexts.find(candidate => `${candidate.name || ''}`.includes(extensionId)) ||
            contexts.find(candidate => `${candidate.origin || ''}`.startsWith(extensionOrigin))

        const contextSummary = contexts.map(candidate => ({
            id: candidate.id,
            origin: candidate.origin || '',
            name: candidate.name || '',
            type: candidate.auxData?.type || '',
            isDefault: candidate.auxData?.isDefault === true
        }))

        if(!context) {
            return {
                ok: false,
                error: 'extension isolated world not found',
                contexts: contextSummary
            }
        }

        const result = await send('Runtime.evaluate', {
            expression,
            awaitPromise: true,
            returnByValue: true,
            contextId: context.id
        }, timeoutMs)

        if(result.exceptionDetails) {
            return {
                ok: false,
                error: JSON.stringify(result.exceptionDetails),
                context: {
                    id: context.id,
                    origin: context.origin || '',
                    name: context.name || ''
                },
                contexts: contextSummary
            }
        }

        return {
            ok: true,
            value: result.result?.value,
            context: {
                id: context.id,
                origin: context.origin || '',
                name: context.name || ''
            }
        }
    }
    finally {
        for(const pendingCommand of pending.values()) clearTimeout(pendingCommand.timeout)
        try { ws.close() } catch {}
    }
}

async function inspectQuoraPage(target) {
    return evaluate(target.webSocketDebuggerUrl, `(${function inspectPage() {
        const attr = document.documentElement?.getAttribute('data-mb-content-script-ready') || ''
        const hrefs = Array.from(document.querySelectorAll('a[href]'))
            .map(anchor => {
                try { return new URL(anchor.getAttribute('href') || '', location.href).href }
                catch { return '' }
            })
            .filter(href => /^https:\/\/www\.quora\.com\/profile\//i.test(href))
        const profileHrefs = Array.from(new Set(hrefs)).slice(0, 100)
        const mbControls = Array.from(document.querySelectorAll([
            '[data-mb-profile-btn-kind]',
            '[data-mb-nuke-state]',
            '[data-mb-profile-search-href]',
            '.mb-ext_space-feed-post-nuke-btn',
            '.mb-ext_space-feed-nuke-btn',
            '.mb-ext_profile-action-btn'
        ].join(',')))
        const pageType = /\/profile\//i.test(location.pathname)
            ? 'profile'
            : /\/search/i.test(location.pathname)
                ? 'profile-search'
                : location.hostname !== 'www.quora.com'
                    ? 'space'
                    : 'unknown'
        return {
            url: location.href,
            title: document.title,
            readyState: document.readyState,
            visibilityState: document.visibilityState,
            contentReady: attr,
            pageType,
            profileHrefCount: profileHrefs.length,
            profileHrefs,
            mbControlCount: mbControls.length,
            mbControlLabels: mbControls.map(node => `${node.innerText || node.textContent || node.getAttribute('aria-label') || ''}`.replace(/\s+/g, ' ').trim()).filter(Boolean).slice(0, 20)
        }
    }})()`, 15000)
}

async function sendContentPageCoordinatorState(target, extensionId, pageState) {
    return evaluateInExtensionIsolatedWorld(target, extensionId, `(${function requestContentState(request) {
        return new Promise(resolve => {
            chrome.runtime.sendMessage(request, response => resolve({
                response: response || null,
                lastError: chrome.runtime.lastError ? chrome.runtime.lastError.message : ''
            }))
        })
    }})(${JSON.stringify({
        action: 'get-content-page-coordinator-state',
        pageType: pageState.pageType || '',
        url: pageState.url || '',
        profileHrefs: pageState.profileHrefs || []
    })})`, 15000)
}

async function runContentSmoke(config, options, warnings, fail) {
    const quoraPage = await findOrOpenQuoraPage(config, options.quoraUrl, warnings)
    const pageState = await inspectQuoraPage(quoraPage)
    const contentStateResult = await sendContentPageCoordinatorState(quoraPage, options.extensionId, pageState)
    const contentState = summarizeContentStateResult(contentStateResult)

    if(!pageState.contentReady) {
        fail('content script ready marker is missing on Quora page', {
            url: pageState.url,
            readyState: pageState.readyState,
            title: pageState.title
        })
    }
    if(!contentState.ok) {
        fail('get-content-page-coordinator-state did not return from content script context', contentState)
    }
    else {
        if(contentState.scoped !== true) fail('content page coordinator state is not scoped', contentState)
        if(contentState.queueRows !== 0) fail('content page coordinator state exposed queue rows during smoke', contentState)
    }

    return {
        target: {
            id: quoraPage.id,
            type: quoraPage.type || '',
            url: quoraPage.url || ''
        },
        page: {
            url: pageState.url,
            title: pageState.title,
            readyState: pageState.readyState,
            visibilityState: pageState.visibilityState,
            contentReady: pageState.contentReady,
            pageType: pageState.pageType,
            profileHrefCount: pageState.profileHrefCount,
            mbControlCount: pageState.mbControlCount,
            mbControlLabels: pageState.mbControlLabels
        },
        coordinatorState: contentState
    }
}

function writeJson(pathname, value) {
    fs.mkdirSync(path.dirname(pathname), {recursive: true})
    fs.writeFileSync(pathname, `${JSON.stringify(value, null, 2)}\n`)
}

runMain(async () => {
    const options = parseArgs(process.argv)
    const config = {
        host: options.host,
        port: options.port,
        extensionId: options.extensionId
    }
    const expectedVersion = readCurrentVersion()
    const failures = []
    const warnings = []

    const fail = (message, details = null) => failures.push(details ? {message, details} : {message})
    const warn = (message, details = null) => warnings.push(details ? {message, details} : {message})

    await getJson('/json/version', config, 5000).catch(error => {
        throw new Error(`CDP endpoint ${config.host}:${config.port} is not reachable: ${error.message}`)
    })

    const extensionsPage = await ensureExtensionsPage(config, warnings)
    const extensionBefore = await getExtensionInfo(extensionsPage, options.extensionId)
    validateExtensionInfo(extensionBefore, options, expectedVersion, fail)

    const context = await ensureExtensionContext(config, warnings)
    const storageBefore = await readStorage(context)
    const workStateBefore = summarizeWorkState(storageBefore)

    const legacyActions = {}
    for(const action of LEGACY_ACTIONS) {
        const result = await sendRuntimeMessage(context, {action}, 5000)
        legacyActions[action] = result
        if(result.response !== null) fail(`legacy action returned a response: ${action}`, result)
    }

    const reconcileDisplayOnly = await sendRuntimeMessage(context, {action: 'reconcile-coordinator-storage'}, 10000)
    if(reconcileDisplayOnly.response?.displayOnly !== true ||
            reconcileDisplayOnly.response?.reason !== 'display-only-reconcile-disabled') {
        fail('non-user reconcile did not return display-only disabled result', reconcileDisplayOnly)
    }

    const currentActions = {}
    for(const action of CURRENT_ACTIONS) {
        const result = await sendRuntimeMessage(context, {action, reason: ACTION_REASON}, 15000)
        currentActions[action] = result
        if(result.timedOut) fail(`current action timed out: ${action}`, result)
        else if(result.lastError) fail(`current action returned lastError: ${action}`, result)
        else if(result.response === null) fail(`current action returned no response: ${action}`, result)
    }

    let contentSmoke = null
    if(options.phase === PHASE2) {
        contentSmoke = await runContentSmoke(config, options, warnings, fail)
        await sleep(500)
    }

    const storageAfter = await readStorage(context)
    const workStateAfter = summarizeWorkState(storageAfter)
    const alarmsResult = await readAlarms(context)
    const alarms = alarmsResult.alarms || []
    const alarmNames = alarms.map(alarm => alarm.name)
    const extensionAfter = await getExtensionInfo(extensionsPage, options.extensionId)
    validateExtensionInfo(extensionAfter, options, expectedVersion, fail, 'extension after smoke')

    const observedStorageKeys = Array.from(new Set([
        ...storageBefore.keys,
        ...storageAfter.keys
    ])).sort()
    for(const key of observedStorageKeys) {
        if(FORBIDDEN_STORAGE_KEY_PATTERNS.some(pattern => pattern.test(key))) {
            fail('forbidden legacy storage key is present', {key})
        }
        else if(!isAllowedStorageKey(key)) {
            warn('unrecognized storage key present', {key})
        }
    }

    const storageKeyDelta = diffStorageKeys(storageBefore.keys, storageAfter.keys, options.phase)
    if(storageKeyDelta.unexpectedAdded.length) {
        fail(`unexpected storage keys were created by ${options.phase}`, {
            unexpectedAdded: storageKeyDelta.unexpectedAdded,
            allowedAdded: allowedAddedStorageKeySummary(options.phase)
        })
    }
    if(storageKeyDelta.removed.length) {
        warn(`storage keys were removed during ${options.phase}`, {
            removed: storageKeyDelta.removed
        })
    }

    if(alarmNames.some(name => /repair|mb-stored-work-repair|legacyImport|importLegacy/i.test(name))) {
        fail('legacy repair/import alarm is visible', alarmNames.filter(name => /repair|mb-stored-work-repair|legacyImport|importLegacy/i.test(name)))
    }

    if(workStateAfter.rawActiveLike > workStateBefore.rawActiveLike ||
            workStateAfter.rawQueuedLike > workStateBefore.rawQueuedLike ||
            workStateAfter.viewActiveLike > workStateBefore.viewActiveLike ||
            workStateAfter.viewQueuedLike > workStateBefore.viewQueuedLike) {
        fail(`${options.phase} appears to have started or queued work`, {
            before: workStateBefore,
            after: workStateAfter
        })
    }

    const legacyActionSummary = Object.fromEntries(Object.entries(legacyActions)
        .map(([action, result]) => [action, summarizeLegacyMessageResult(result)]))
    const currentActionSummary = Object.fromEntries(Object.entries(currentActions)
        .map(([action, result]) => [action, summarizeMessageResult(result)]))
    const reconcileDisplayOnlySummary = summarizeMessageResult(reconcileDisplayOnly)

    const report = {
        pass: failures.length === 0,
        phase: options.phase,
        profileLabel: options.profileLabel,
        generatedAt: new Date().toISOString(),
        cdp: {
            host: options.host,
            port: options.port
        },
        extension: extensionAfter || extensionBefore,
        extensionBefore,
        expectedVersion,
        context: {
            id: context.id,
            type: context.type || '',
            url: context.url || ''
        },
        storageKeys: storageAfter.keys,
        storageKeysBefore: storageBefore.keys,
        storageKeysAfter: storageAfter.keys,
        storageKeyDelta,
        allowedAddedStorageKeys: allowedAddedStorageKeySummary(options.phase),
        alarms,
        legacyActions: legacyActionSummary,
        reconcileDisplayOnly: reconcileDisplayOnlySummary,
        currentActions: currentActionSummary,
        contentSmoke,
        workStateBefore,
        workStateAfter,
        failures,
        warnings
    }

    if(options.verbose) {
        report.details = {
            legacyActions,
            reconcileDisplayOnly,
            currentActions
        }
    }

    const comparable = comparableReport(report)

    if(options.compareBaseline) {
        const baseline = JSON.parse(fs.readFileSync(options.compareBaseline, 'utf8'))
        const expected = baseline.comparable || comparableReport(baseline)
        const actual = comparable
        if(JSON.stringify(actual) !== JSON.stringify(expected)) {
            fail('baseline comparison mismatch', {
                baseline: options.compareBaseline
            })
            report.pass = false
        }
    }

    if(options.writeBaseline) {
        writeJson(options.writeBaseline, {
            ...report,
            comparable
        })
        report.baselineWritten = options.writeBaseline
    }

    if(options.verbose) report.comparable = comparable

    report.pass = failures.length === 0
    console.log(JSON.stringify(report, null, 2))
    if(!report.pass) process.exitCode = 1
})
