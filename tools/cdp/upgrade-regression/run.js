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
const PHASE3_SPACE = 'phase3-space-discovery-smoke'
const PHASE3_SEARCH = 'phase3-search-discovery-smoke'
const PHASE4_SPACE_MARK = 'phase4-space-mark-ui-smoke'
const PHASE5_DASHBOARD_AUTHORITY = 'phase5-dashboard-readonly-authority-smoke'
const ACTION_REASON = 'upgrade-regression-non-work-starting'
const SPACE_ASSET_URLS = [
    'https://theqdefensecrew.quora.com/',
    'https://instantblock.quora.com/'
]
const SPACE_TARGET_URLS = [
    'https://terryspcfreetopics.quora.com/',
    'https://jonspoliticalcorner29.quora.com/'
]
const DEFAULT_SEARCH_URL = 'https://www.quora.com/search?q=elon%20musk&type=profile'
const DEFAULT_SPACE_MARK_URL = 'https://instantblock.quora.com/'
const DEFAULT_SPACE_MARK_CATEGORY = 'asset'
const SUPPORTED_PHASES = [
    PHASE1,
    PHASE2,
    PHASE3_SPACE,
    PHASE3_SEARCH,
    PHASE4_SPACE_MARK,
    PHASE5_DASHBOARD_AUTHORITY
]

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
    /repair-/,
    /repair-coordinator-storage/,
    /mb-stored-work-repair/,
    /skipRepair/,
    /projectionRepairDelayMs/
]

const FORBIDDEN_DASHBOARD_MESSAGE_ACTION_PATTERNS = [
    /^resume-coordinator-queue$/,
    /^enqueue-coordinator-items$/,
    /^claim-tab-action$/,
    /^resolve-queued-profile-target/,
    /^promote-queued-tab$/,
    /^begin-profile-action$/,
    /action-lease$/,
    /^release-job-tab$/,
    /^record-job-/,
    /^settle-terminal-coordinator-items$/,
    /^pause-/,
    /^cancel-/,
    /^retry-/,
    /^requeue-/,
    /^reset-/,
    /^clear-profile-/,
    /^remove-pending-/,
    /^confirm-space-/,
    /^sweep-/,
    /^create-tab$/
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

const ALLOWED_PHASE3_ADDED_STORAGE_KEY_PATTERNS = [
    ...ALLOWED_PHASE2_ADDED_STORAGE_KEY_PATTERNS,
    /^mbSpaceRegistry$/
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
        searchUrl: DEFAULT_SEARCH_URL,
        spaceMarkUrl: DEFAULT_SPACE_MARK_URL,
        spaceMarkCategory: DEFAULT_SPACE_MARK_CATEGORY,
        spaceAssetUrls: SPACE_ASSET_URLS.slice(),
        spaceTargetUrls: SPACE_TARGET_URLS.slice(),
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
        else if(arg === '--write-baseline') {
            const next = argv[index + 1]
            if(next && !next.startsWith('--')) {
                index += 1
                options.writeBaseline = next
            }
            else options.writeBaseline = true
        }
        else if(arg.startsWith('--write-baseline=')) options.writeBaseline = arg.slice('--write-baseline='.length)
        else if(arg === '--compare-baseline') options.compareBaseline = readValue('')
        else if(arg.startsWith('--compare-baseline=')) options.compareBaseline = arg.slice('--compare-baseline='.length)
        else if(arg === '--phase') options.phase = readValue(options.phase)
        else if(arg.startsWith('--phase=')) options.phase = arg.slice('--phase='.length)
        else if(arg === '--quora-url') options.quoraUrl = readValue('')
        else if(arg.startsWith('--quora-url=')) options.quoraUrl = arg.slice('--quora-url='.length)
        else if(arg === '--search-url') options.searchUrl = readValue(options.searchUrl)
        else if(arg.startsWith('--search-url=')) options.searchUrl = arg.slice('--search-url='.length)
        else if(arg === '--space-mark-url') options.spaceMarkUrl = readValue(options.spaceMarkUrl)
        else if(arg.startsWith('--space-mark-url=')) options.spaceMarkUrl = arg.slice('--space-mark-url='.length)
        else if(arg === '--space-mark-category') options.spaceMarkCategory = readValue(options.spaceMarkCategory)
        else if(arg.startsWith('--space-mark-category=')) options.spaceMarkCategory = arg.slice('--space-mark-category='.length)
        else if(arg === '--space-asset-url') options.spaceAssetUrls.push(readValue(''))
        else if(arg.startsWith('--space-asset-url=')) options.spaceAssetUrls.push(arg.slice('--space-asset-url='.length))
        else if(arg === '--space-target-url') options.spaceTargetUrls.push(readValue(''))
        else if(arg.startsWith('--space-target-url=')) options.spaceTargetUrls.push(arg.slice('--space-target-url='.length))
        else if(arg === '--verbose') options.verbose = true
        else if(arg === '--help' || arg === '-h') {
            printUsage()
            process.exit(0)
        }
        else throw new Error(`unknown argument: ${arg}`)
    }

    if(!options.extensionId) throw new Error('--extension-id is required')
    if(!SUPPORTED_PHASES.includes(options.phase)) {
        throw new Error(`unsupported --phase ${options.phase}; expected one of ${SUPPORTED_PHASES.join(', ')}`)
    }
    options.spaceAssetUrls = dedupeStrings(options.spaceAssetUrls.filter(Boolean))
    options.spaceTargetUrls = dedupeStrings(options.spaceTargetUrls.filter(Boolean))
    if(!['asset', 'neutral', 'target'].includes(options.spaceMarkCategory)) {
        throw new Error('--space-mark-category must be one of asset, neutral, target')
    }
    if(options.writeBaseline === true) options.writeBaseline = defaultBaselinePath(options.profileLabel, options.phase)
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
        `  --phase ${SUPPORTED_PHASES.join('|')}`,
        '  --quora-url https://www.quora.com/',
        `  --search-url ${DEFAULT_SEARCH_URL}`,
        `  --space-mark-url ${DEFAULT_SPACE_MARK_URL}`,
        `  --space-mark-category ${DEFAULT_SPACE_MARK_CATEGORY}`,
        '  --space-asset-url https://theqdefensecrew.quora.com/',
        '  --space-target-url https://terryspcfreetopics.quora.com/',
        '  --write-baseline [path]',
        '  --compare-baseline path',
        '  --verbose'
    ].join('\n'))
}

function dedupeStrings(values = []) {
    return Array.from(new Set((values || []).map(value => `${value || ''}`.trim()).filter(Boolean)))
}

function defaultBaselinePath(profileLabel, phase = PHASE1) {
    const safeLabel = `${profileLabel || DEFAULT_PROFILE_LABEL}`.replace(/[^a-z0-9._-]+/gi, '-')
    const safePhase = `${phase || PHASE1}`.replace(/[^a-z0-9._-]+/gi, '-')
    return path.join('tmp', 'upgrade-regression', `${safeLabel}.${safePhase}.json`)
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
    const candidates = [
        ...targets.filter(item => item.type === 'page' && item.url === dashboardUrl),
        ...targets.filter(item => item.type === 'page' && (item.url || '').startsWith(extensionPrefix) && item.url !== dashboardUrl),
        ...targets.filter(item => item.type === 'service_worker' && (item.url || '').startsWith(extensionPrefix))
    ]

    for(const candidate of candidates) {
        const availability = await inspectExtensionApiAvailability(candidate).catch(error => ({
            storage: false,
            runtime: false,
            error: error?.message || `${error || ''}`
        }))
        if(availability.storage && availability.runtime) return candidate
        warnings.push({
            message: 'skipped extension target without runtime/storage APIs',
            target: {
                id: candidate.id,
                type: candidate.type || '',
                url: candidate.url || ''
            },
            availability
        })
    }

    const versionInfo = await getJson('/json/version', config)
    await cdpCommand(versionInfo.webSocketDebuggerUrl, 'Target.createTarget', {
        url: dashboardUrl,
        background: true
    }, 10000)
    warnings.push('opened coordinator.html as a display-only extension context for storage and runtime probes')
    await sleep(1000)

    targets = await getTargets(config)
    const target = targets.find(item => item.type === 'page' && item.url === dashboardUrl) ||
        targets.find(item => item.type === 'page' && (item.url || '').startsWith(extensionPrefix)) ||
        targets.find(item => item.type === 'service_worker' && (item.url || '').startsWith(extensionPrefix))
    if(!target) throw new Error(`extension context not found for ${config.extensionId}`)
    const availability = await inspectExtensionApiAvailability(target).catch(error => ({
        storage: false,
        runtime: false,
        error: error?.message || `${error || ''}`
    }))
    if(!availability.storage || !availability.runtime) {
        throw new Error(`extension context lacks runtime/storage APIs: ${JSON.stringify({
            target: {id: target.id, type: target.type || '', url: target.url || ''},
            availability
        })}`)
    }
    return target
}

async function inspectExtensionApiAvailability(target) {
    return evaluate(target.webSocketDebuggerUrl, `(${function inspectApis() {
        return {
            href: `${globalThis.location?.href || ''}`,
            title: `${globalThis.document?.title || ''}`,
            bodyText: `${globalThis.document?.body?.innerText || ''}`.slice(0, 200),
            runtime: typeof globalThis.chrome?.runtime?.sendMessage === 'function',
            storage: typeof globalThis.chrome?.storage?.local?.get === 'function'
        }
    }})()`, 5000)
}

async function ensureDashboardPage(config, warnings) {
    const dashboardUrl = `chrome-extension://${config.extensionId}/coordinator.html`
    let targets = await getTargets(config)
    let target = targets.find(item => item.type === 'page' && item.url === dashboardUrl)
    if(target && await isDashboardDocument(target).catch(() => false)) return target

    const versionInfo = await getJson('/json/version', config)
    await cdpCommand(versionInfo.webSocketDebuggerUrl, 'Target.createTarget', {
        url: dashboardUrl,
        background: true
    }, 10000)
    warnings.push('opened coordinator.html for dashboard authority smoke')
    await sleep(1000)

    targets = await getTargets(config)
    target = targets.find(item => item.type === 'page' && item.url === dashboardUrl && item.id !== target?.id) ||
        targets.find(item => item.type === 'page' && item.url === dashboardUrl)
    if(!target) throw new Error('coordinator.html target not found')
    return target
}

async function isDashboardDocument(target) {
    const info = await evaluate(target.webSocketDebuggerUrl, `(${function inspectDashboardDocument() {
        return {
            title: `${document.title || ''}`,
            hasCoordinator: !!document.querySelector('main.coordinator'),
            blockedByClient: /ERR_BLOCKED_BY_CLIENT|blocked by Chrome|is blocked/i.test(`${document.body?.innerText || ''}`)
        }
    }})()`, 5000)
    return info.hasCoordinator && !info.blockedByClient
}

async function installDashboardMessageProbe(target) {
    await cdpCommand(target.webSocketDebuggerUrl, 'Page.addScriptToEvaluateOnNewDocument', {
        source: `(${function installMessageProbe() {
            const install = () => {
                globalThis.__mbUpgradeRegressionMessages = globalThis.__mbUpgradeRegressionMessages || []
                const runtime = globalThis.chrome?.runtime
                if(!runtime || typeof runtime.sendMessage !== 'function') return false
                if(runtime.sendMessage.__mbUpgradeRegressionWrapped) return true

                const originalSendMessage = runtime.sendMessage.bind(runtime)
                const wrappedSendMessage = function wrappedSendMessage(...args) {
                    const payload = args.find(arg => arg && typeof arg === 'object' && !Array.isArray(arg)) || null
                    globalThis.__mbUpgradeRegressionMessages.push({
                        action: `${payload?.action || ''}`,
                        reason: `${payload?.reason || ''}`,
                        userInitiated: payload?.userInitiated === true,
                        allowBeforeQuora: payload?.allowBeforeQuora === true,
                        at: Date.now()
                    })
                    return originalSendMessage(...args)
                }
                wrappedSendMessage.__mbUpgradeRegressionWrapped = true
                runtime.sendMessage = wrappedSendMessage
                return true
            }

            if(install()) return
            let attempts = 0
            const timer = setInterval(() => {
                attempts += 1
                if(install() || attempts > 50) clearInterval(timer)
            }, 20)
        }})()`
    }, 10000)
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
            let settled = false
            const finish = value => {
                if(settled) return
                settled = true
                resolve(value)
            }
            let attempts = 0
            const tryRead = () => {
                attempts += 1
                const localStorage = globalThis.chrome?.storage?.local
                if(typeof localStorage?.get !== 'function') {
                    if(attempts < 20) {
                        setTimeout(tryRead, 100)
                        return
                    }
                    finish({
                        keys: [],
                        data: {},
                        available: false,
                        error: 'chrome.storage.local unavailable in target context'
                    })
                    return
                }

                const complete = (data = {}) => {
                    const safeData = data && typeof data === 'object' ? data : {}
                    finish({
                        keys: Object.keys(safeData).sort(),
                        data: safeData,
                        available: true
                    })
                }

                const callbackTimer = setTimeout(() => finish({
                    keys: [],
                    data: {},
                    available: false,
                    error: 'chrome.storage.local.get did not return'
                }), 3000)

                try {
                    const maybePromise = localStorage.get.call(localStorage, null, data => {
                        clearTimeout(callbackTimer)
                        complete(data)
                    })
                    if(maybePromise && typeof maybePromise.then === 'function') {
                        maybePromise
                            .then(data => {
                                clearTimeout(callbackTimer)
                                complete(data)
                            })
                            .catch(error => {
                                clearTimeout(callbackTimer)
                                finish({
                                    keys: [],
                                    data: {},
                                    available: false,
                                    error: error?.message || `${error || ''}`
                                })
                            })
                    }
                }
                catch(error) {
                    clearTimeout(callbackTimer)
                    finish({
                        keys: [],
                        data: {},
                        available: false,
                        error: error?.message || `${error || ''}`
                    })
                }
            }
            tryRead()
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
    if(isNonWorkSpaceRegistryPhase(phase)) return ALLOWED_PHASE3_ADDED_STORAGE_KEY_PATTERNS.some(pattern => pattern.test(key))
    return false
}

function isDiscoveryPhase(phase = '') {
    return phase === PHASE3_SPACE || phase === PHASE3_SEARCH
}

function isNonWorkSpaceRegistryPhase(phase = '') {
    return isDiscoveryPhase(phase) || phase === PHASE4_SPACE_MARK
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
    if(phase === PHASE2) {
        return {
            literal,
            patterns: ALLOWED_PHASE2_ADDED_STORAGE_KEY_PATTERNS.map(pattern => pattern.toString()).sort()
        }
    }
    if(isNonWorkSpaceRegistryPhase(phase)) {
        return {
            literal,
            patterns: ALLOWED_PHASE3_ADDED_STORAGE_KEY_PATTERNS.map(pattern => pattern.toString()).sort()
        }
    }
    return {
        literal,
        patterns: []
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

function failIfStorageUnavailable(storage, fail, label) {
    if(storage?.available === false) {
        fail(`${label} storage context did not expose chrome.storage.local`, {
            error: storage.error || '',
            keys: storage.keys || []
        })
    }
}

function stableJson(value) {
    if(value === null || typeof value !== 'object') return JSON.stringify(value)
    if(Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`
    return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${stableJson(value[key])}`).join(',')}}`
}

function countRecordMap(value = null) {
    if(!value || typeof value !== 'object') return 0
    const records = value.records && typeof value.records === 'object' ? value.records : value
    return Object.keys(records || {}).length
}

function summarizeAuthorityState(storage) {
    const data = storage?.data || {}
    const walKeys = Object.keys(data)
        .filter(key => key === 'mbCoordinatorQueueWal' || key.startsWith('mbCoordinatorQueueWal.'))
        .sort()
    const progressShardKeys = Object.keys(data)
        .filter(key => key.startsWith('mbProfileNukeProgressShard.'))
        .sort()
    const progressShardRecords = progressShardKeys
        .reduce((total, key) => total + countRecordMap(data[key]), 0)
    const queuedActionSurfaceState = data.mbQueuedActionSurfaceState && typeof data.mbQueuedActionSurfaceState === 'object'
        ? data.mbQueuedActionSurfaceState
        : {}

    return {
        work: summarizeWorkState(storage),
        walKeys,
        walSignature: stableJson(Object.fromEntries(walKeys.map(key => [key, data[key]]))),
        progressViewRecords: countRecordMap(data.mbProfileNukeProgressView),
        progressShardRecords,
        pendingSpacePostRecords: countRecordMap(data.mbSpacePendingNukedPosts),
        nukedSpacePostRecords: countRecordMap(data.mbSpaceNukedPosts),
        queuedActionSurfaceRecords: countRecordMap(queuedActionSurfaceState)
    }
}

function summarizeDashboardAuthoritySources(storage) {
    const data = storage?.data || {}
    const queueView = data.mbCoordinatorQueueView && typeof data.mbCoordinatorQueueView === 'object'
        ? data.mbCoordinatorQueueView
        : {}
    const metricsView = data.mbQueueWakeupMetricsView && typeof data.mbQueueWakeupMetricsView === 'object'
        ? data.mbQueueWakeupMetricsView
        : {}
    const rawQueue = data.mbCoordinatorQueue && typeof data.mbCoordinatorQueue === 'object'
        ? data.mbCoordinatorQueue
        : {}

    return {
        compactQueueViewPresent: hasCompactQueueViewShape(queueView),
        compactQueueViewVersion: Number.parseInt(queueView.version, 10) || 0,
        compactQueueViewRows: Array.isArray(queueView.items) ? queueView.items.length : 0,
        compactQueueViewTotal: Number.parseInt(queueView.total, 10) || 0,
        compactMetricsViewPresent: hasCompactMetricsViewShape(metricsView),
        compactMetricsViewVersion: Number.parseInt(metricsView.version, 10) || 0,
        compactMetricsViewEpochPresent: !!metricsView.currentEpoch,
        rawQueueRows: Object.keys(rawQueue).length,
        fullLegacyProgressPresent: Object.prototype.hasOwnProperty.call(data, 'mbProfileNukeProgress')
    }
}

function hasCompactQueueViewShape(value = {}) {
    return !!value &&
        typeof value === 'object' &&
        !Array.isArray(value) &&
        Number.parseInt(value.version, 10) >= 1 &&
        Array.isArray(value.items)
}

function hasCompactMetricsViewShape(value = {}) {
    return !!value &&
        typeof value === 'object' &&
        !Array.isArray(value) &&
        Number.parseInt(value.version, 10) >= 1 &&
        Number.parseInt(value.viewVersion, 10) >= 1 &&
        !!value.currentEpoch
}

function assertDiscoveryDidNotCreateAuthority(before = {}, after = {}, fail) {
    const changed = (name, details = {}) => fail(`non-work-starting smoke created ${name}`, details)
    if(after.work.rawQueueRows !== before.work.rawQueueRows || after.work.rawQueueRows !== 0) {
        changed('coordinator queue rows', {before: before.work.rawQueueRows, after: after.work.rawQueueRows})
    }
    if(after.work.viewRows !== before.work.viewRows || after.work.viewRows !== 0) {
        changed('coordinator queue view rows', {before: before.work.viewRows, after: after.work.viewRows})
    }
    if(after.walSignature !== before.walSignature) {
        changed('coordinator queue WAL changes', {
            beforeKeys: before.walKeys,
            afterKeys: after.walKeys
        })
    }
    if(after.progressViewRecords !== before.progressViewRecords || after.progressViewRecords !== 0) {
        changed('profile progress view records', {
            before: before.progressViewRecords,
            after: after.progressViewRecords
        })
    }
    if(after.progressShardRecords !== before.progressShardRecords || after.progressShardRecords !== 0) {
        changed('profile progress shard records', {
            before: before.progressShardRecords,
            after: after.progressShardRecords
        })
    }
    if(after.pendingSpacePostRecords !== before.pendingSpacePostRecords || after.pendingSpacePostRecords !== 0) {
        changed('pending space post records', {
            before: before.pendingSpacePostRecords,
            after: after.pendingSpacePostRecords
        })
    }
    if(after.nukedSpacePostRecords !== before.nukedSpacePostRecords || after.nukedSpacePostRecords !== 0) {
        changed('nuked space post records', {
            before: before.nukedSpacePostRecords,
            after: after.nukedSpacePostRecords
        })
    }
    if(after.queuedActionSurfaceRecords !== before.queuedActionSurfaceRecords || after.queuedActionSurfaceRecords !== 0) {
        changed('queued action surface records', {
            before: before.queuedActionSurfaceRecords,
            after: after.queuedActionSurfaceRecords
        })
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
        contentSmoke: comparableContentSmoke(report.contentSmoke),
        discoverySmoke: comparableDiscoverySmoke(report.discoverySmoke),
        ...(report.spaceMarkSmoke ? {spaceMarkSmoke: comparableSpaceMarkSmoke(report.spaceMarkSmoke)} : {}),
        ...(report.dashboardAuthoritySmoke
            ? {dashboardAuthoritySmoke: comparableDashboardAuthoritySmoke(report.dashboardAuthoritySmoke)}
            : {}),
        workStateAfter: report.workStateAfter
    }
}

function comparableContentSmoke(contentSmoke = null) {
    if(!contentSmoke) return null

    const page = contentSmoke.page || {}
    const coordinatorState = contentSmoke.coordinatorState || {}
    return {
        contentReadyPresent: !!page.contentReady,
        pageType: page.pageType || '',
        mbControlCount: Number(page.mbControlCount || 0) || 0,
        coordinatorState: {
            ok: coordinatorState.ok === true,
            scoped: coordinatorState.scoped === true,
            pageType: coordinatorState.pageType || '',
            queueRows: Number(coordinatorState.queueRows || 0) || 0,
            progressRows: Number(coordinatorState.progressRows || 0) || 0,
            responseKeys: Array.isArray(coordinatorState.responseKeys)
                ? coordinatorState.responseKeys.slice().sort()
                : []
        }
    }
}

function comparableDiscoverySmoke(discoverySmoke = null) {
    if(!discoverySmoke) return null
    return {
        kind: discoverySmoke.kind || '',
        pageCount: Array.isArray(discoverySmoke.pages) ? discoverySmoke.pages.length : 0,
        hasCandidates: (Number(discoverySmoke.totalCandidateCount || 0) || 0) > 0,
        pages: (discoverySmoke.pages || []).map(page => ({
            expectedCategory: page.expectedCategory || '',
            observedCategory: page.page?.spaceCategory || '',
            pageType: page.page?.pageType || '',
            contentReadyPresent: !!page.page?.contentReady,
            profileHrefsPresent: (Number(page.page?.profileHrefCount || 0) || 0) > 0,
            discoveryCandidatesPresent: (Number(page.page?.discoveryCandidateCount || 0) || 0) > 0,
            profileSearchToolbarPresent: page.page?.profileSearchToolbarPresent === true,
            spaceCategoryHostPresent: page.page?.spaceCategoryHostPresent === true,
            scoped: page.coordinatorState?.scoped === true,
            queueRows: Number(page.coordinatorState?.queueRows || 0) || 0,
            progressRows: Number(page.coordinatorState?.progressRows || 0) || 0
        }))
    }
}

function comparableSpaceMarkSmoke(spaceMarkSmoke = null) {
    if(!spaceMarkSmoke) return null
    return {
        kind: spaceMarkSmoke.kind || '',
        url: normalizeComparableUrl(spaceMarkSmoke.url || ''),
        desiredCategory: spaceMarkSmoke.desiredCategory || '',
        temporaryCategory: spaceMarkSmoke.temporaryCategory || '',
        beforeCategory: spaceMarkSmoke.before?.page?.spaceCategory || '',
        temporaryObservedCategory: spaceMarkSmoke.temporary?.page?.spaceCategory || '',
        finalObservedCategory: spaceMarkSmoke.final?.page?.spaceCategory || '',
        reloadedObservedCategory: spaceMarkSmoke.reloaded?.page?.spaceCategory || '',
        contentReadyAfterReload: !!spaceMarkSmoke.reloaded?.page?.contentReady,
        queueRowsAfterReload: Number(spaceMarkSmoke.reloaded?.coordinatorState?.queueRows || 0) || 0,
        progressRowsAfterReload: Number(spaceMarkSmoke.reloaded?.coordinatorState?.progressRows || 0) || 0
    }
}

function comparableDashboardAuthoritySmoke(dashboardAuthoritySmoke = null) {
    if(!dashboardAuthoritySmoke) return null
    const dashboard = dashboardAuthoritySmoke.dashboard || {}
    const authoritySources = dashboardAuthoritySmoke.authoritySources || {}
    return {
        kind: dashboardAuthoritySmoke.kind || '',
        dashboardReady: dashboard.ready === true,
        appVersion: dashboard.appVersion || '',
        refreshState: dashboard.refreshState || '',
        currentWorkSummary: dashboard.currentWorkSummary || '',
        queuedCount: Number(dashboard.queuedCount || 0) || 0,
        activeCount: Number(dashboard.activeCount || 0) || 0,
        terminalCount: Number(dashboard.terminalCount || 0) || 0,
        eventCount: Number(dashboard.eventCount || 0) || 0,
        queueListRows: Number(dashboard.queueListRows || 0) || 0,
        metricsGridItems: Number(dashboard.metricsGridItems || 0) || 0,
        compactQueueViewPresent: authoritySources.compactQueueViewPresent === true,
        compactMetricsViewPresent: authoritySources.compactMetricsViewPresent === true,
        fullLegacyProgressPresent: authoritySources.fullLegacyProgressPresent === true,
        capturedActions: (dashboardAuthoritySmoke.capturedActions || []).slice().sort(),
        forbiddenCapturedActions: (dashboardAuthoritySmoke.forbiddenCapturedActions || []).slice().sort(),
        queueRowsAfter: Number(dashboardAuthoritySmoke.workStateAfter?.rawQueueRows || 0) || 0,
        activeLikeAfter: Number(dashboardAuthoritySmoke.workStateAfter?.rawActiveLike || 0) || 0,
        queuedLikeAfter: Number(dashboardAuthoritySmoke.workStateAfter?.rawQueuedLike || 0) || 0
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

function normalizeComparableUrl(url = '') {
    try {
        const parsed = new URL(url)
        parsed.hash = ''
        if(parsed.pathname !== '/') parsed.pathname = parsed.pathname.replace(/\/+$/, '') || '/'
        return parsed.href
    }
    catch {
        return `${url || ''}`.trim()
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

async function findOrOpenPage(config, url, warnings, reason = 'page') {
    if(!url || !isQuoraUrl(url)) throw new Error(`${reason} URL must be an https Quora URL: ${url}`)

    const normalizedUrl = normalizeComparableUrl(url)
    let targets = await getTargets(config)
    let page = targets.find(target =>
        target.type === 'page' &&
        normalizeComparableUrl(target.url || '') === normalizedUrl)
    if(page) return page

    const versionInfo = await getJson('/json/version', config)
    const created = await cdpCommand(versionInfo.webSocketDebuggerUrl, 'Target.createTarget', {
        url,
        background: true
    }, 10000)
    warnings.push(`opened ${reason}: ${url}`)
    await sleep(4500)

    targets = await getTargets(config)
    page = targets.find(target => target.id === created.targetId) ||
        targets.find(target => target.type === 'page' && normalizeComparableUrl(target.url || '') === normalizedUrl)
    if(!page) throw new Error(`${reason} target not found after opening ${url}`)
    return page
}

function normalizeSpaceUrl(url = '') {
    try {
        const parsed = new URL(url)
        parsed.search = ''
        parsed.hash = ''

        if(parsed.hostname !== 'www.quora.com' && parsed.hostname.endsWith('.quora.com')) {
            return `${parsed.protocol}//${parsed.hostname}`
        }

        let pathname = parsed.pathname.replace(/\/+$/, '')
        if(!pathname) pathname = '/'
        return `${parsed.protocol}//${parsed.hostname}${pathname}`
    }
    catch {
        return ''
    }
}

function extractSpaceSlug(url = '') {
    try {
        const parsed = new URL(url)
        if(parsed.hostname !== 'www.quora.com') return parsed.hostname.replace(/\.quora\.com$/i, '')
        const parts = parsed.pathname.split('/').filter(Boolean)
        return parts[parts.length - 1] || parsed.hostname
    }
    catch {
        return ''
    }
}

function makeSpaceRegistryRecord(url = '', category = '') {
    const normalizedUrl = normalizeSpaceUrl(url)
    const slug = extractSpaceSlug(normalizedUrl)
    if(!normalizedUrl || !slug || !['asset', 'target'].includes(category)) return null
    return {
        key: `quora-space:${normalizedUrl}`,
        url: normalizedUrl,
        slug,
        name: slug.replace(/[-_]+/g, ' '),
        category,
        updatedAt: Date.now()
    }
}

async function classifySpacesForDiscovery(context, assetUrls = [], targetUrls = []) {
    const records = [
        ...assetUrls.map(url => makeSpaceRegistryRecord(url, 'asset')),
        ...targetUrls.map(url => makeSpaceRegistryRecord(url, 'target'))
    ].filter(Boolean)
    if(!records.length) return {updated: 0, records: []}

    return evaluate(context.webSocketDebuggerUrl, `(${function setSpaceRegistry(nextRecords) {
        return new Promise(resolve => {
            chrome.storage.local.get({mbSpaceRegistry: {}}, stored => {
                const registry = stored.mbSpaceRegistry && typeof stored.mbSpaceRegistry === 'object'
                    ? stored.mbSpaceRegistry
                    : {}
                let updated = 0
                for(const record of nextRecords || []) {
                    if(!record?.key) continue
                    const previous = registry[record.key] || null
                    registry[record.key] = {
                        ...previous,
                        ...record
                    }
                    updated += 1
                }
                chrome.storage.local.set({mbSpaceRegistry: registry}, () => resolve({
                    updated,
                    keys: nextRecords.map(record => record.key).filter(Boolean)
                }))
            })
        })
    }})(${JSON.stringify(records)})`, 10000)
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

async function inspectDiscoveryPage(target) {
    return evaluate(target.webSocketDebuggerUrl, `(${function inspectPage() {
        const normalizeProfileHref = href => {
            try {
                const url = new URL(href, location.href)
                if(!/^https:$/.test(url.protocol)) return ''
                if(!/(^|\.)quora\.com$/i.test(url.hostname)) return ''
                if(!/^\/profile\//i.test(url.pathname)) return ''
                url.hash = ''
                return `https://www.quora.com${url.pathname.replace(/\/+$/, '')}`
            }
            catch {
                return ''
            }
        }
        const profileHrefs = Array.from(new Set(Array.from(document.querySelectorAll('a[href]'))
            .map(anchor => normalizeProfileHref(anchor.getAttribute('href') || anchor.href || ''))
            .filter(Boolean)))
            .slice(0, 250)
        const pageType = /\/profile\//i.test(location.pathname)
            ? 'profile'
            : /\/search/i.test(location.pathname)
                ? 'profile-search'
                : location.hostname !== 'www.quora.com'
                    ? 'space'
                    : 'unknown'
        const profileSearchRows = Array.from(document.querySelectorAll('[data-mb-profile-search-href]'))
        const profileSearchButtons = Array.from(document.querySelectorAll('.mb-ext_profile-search-row-btn[data-mb-profile-search-href]'))
        const spaceFeedButtons = Array.from(document.querySelectorAll([
            '.mb-ext_space-feed-nuke-btn',
            '.mb-ext_space-feed-post-nuke-btn',
            '.mb-ext_space-feed-post-queue-btn',
            '.mb-ext_space-feed-post-single-nuke-btn'
        ].join(',')))
        const parseJsonArray = value => {
            try {
                const parsed = JSON.parse(value || '[]')
                return Array.isArray(parsed) ? parsed : []
            }
            catch {
                return []
            }
        }
        const spaceFeedCandidateHrefs = new Set()
        let spaceFeedEntryCount = 0
        for(const button of spaceFeedButtons) {
            for(const href of parseJsonArray(button.dataset.mbSpaceFeedUrls || '[]')) {
                const normalized = normalizeProfileHref(href)
                if(normalized) spaceFeedCandidateHrefs.add(normalized)
            }
            const entries = parseJsonArray(button.dataset.mbSpaceFeedEntries || '[]')
            spaceFeedEntryCount += entries.length
            for(const entry of entries) {
                for(const href of entry?.candidateUrls || []) {
                    const normalized = normalizeProfileHref(href)
                    if(normalized) spaceFeedCandidateHrefs.add(normalized)
                }
            }
        }
        const categoryHost = document.querySelector('.mb-ext_space-category-host')
        const activeCategoryButton = document.querySelector('.mb-ext_space-category-btn[data-active="true"]')
        const toolbar = document.querySelector('.mb-ext_profile-search-toolbar')
        const batchButton = document.querySelector('.mb-ext_profile-search-batch-btn')
        const statusButton = document.querySelector('.mb-ext_space-feed-status-btn')
        const batchText = `${batchButton?.innerText || batchButton?.textContent || ''}`.replace(/\s+/g, ' ').trim()
        const batchMatch = batchText.match(/\b(\d+)\b/)
        const profileSearchBatchCandidateCount = batchMatch ? Number.parseInt(batchMatch[1], 10) || 0 : 0
        const profileSearchExtensionCandidateCount = Math.max(
            profileSearchRows.length,
            profileSearchButtons.length,
            profileSearchBatchCandidateCount
        )
        const discoveryCandidateCount = pageType === 'space'
            ? Math.max(spaceFeedCandidateHrefs.size, profileHrefs.length)
            : pageType === 'profile-search'
                ? profileSearchExtensionCandidateCount
                : profileHrefs.length
        return {
            url: location.href,
            title: document.title,
            readyState: document.readyState,
            visibilityState: document.visibilityState,
            contentReady: document.documentElement?.getAttribute('data-mb-content-script-ready') || '',
            pageType,
            searchQuery: new URLSearchParams(location.search).get('q') || '',
            profileHrefCount: profileHrefs.length,
            profileHrefs,
            discoveryCandidateCount,
            profileSearchRowCount: profileSearchRows.length,
            profileSearchButtonCount: profileSearchButtons.length,
            profileSearchToolbarPresent: !!toolbar,
            profileSearchBatchText: batchText,
            profileSearchBatchCandidateCount,
            profileSearchExtensionCandidateCount,
            spaceCategory: activeCategoryButton?.dataset?.category || '',
            spaceCategoryHostPresent: !!categoryHost,
            spaceFeedButtonCount: spaceFeedButtons.length,
            spaceFeedEntryCount,
            spaceFeedCandidateCount: spaceFeedCandidateHrefs.size,
            spaceFeedStatusText: `${statusButton?.innerText || statusButton?.textContent || ''}`.replace(/\s+/g, ' ').trim(),
            timestampCount: document.querySelectorAll('a.post_timestamp').length
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
        profileHrefs: pageState.profileHrefs || [],
        sourcePageUrl: pageState.pageType === 'profile-search' ? pageState.url || '' : '',
        searchQuery: pageState.searchQuery || ''
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

async function inspectDiscoveryWithState(target, options, expectedPageType, fail, requireCandidates = true) {
    let pageState = await inspectDiscoveryPage(target)
    for(let attempt = 0; attempt < 4 && (!pageState.contentReady || pageState.discoveryCandidateCount <= 0); attempt += 1) {
        await evaluate(target.webSocketDebuggerUrl, `(${function nudgeDiscovery() {
            if(document.readyState !== 'complete') return
            window.scrollBy({top: Math.max(400, Math.floor((window.innerHeight || 800) * 0.75)), left: 0, behavior: 'auto'})
        }})()`, 5000).catch(() => null)
        await sleep(2000)
        pageState = await inspectDiscoveryPage(target)
    }

    const contentStateResult = await sendContentPageCoordinatorState(target, options.extensionId, pageState)
    const contentState = summarizeContentStateResult(contentStateResult)
    if(!pageState.contentReady) fail('content script ready marker is missing on discovery page', {url: pageState.url})
    if(pageState.pageType !== expectedPageType) fail('discovery page type mismatch', {
        expected: expectedPageType,
        actual: pageState.pageType,
        url: pageState.url
    })
    if(requireCandidates && pageState.discoveryCandidateCount <= 0) fail('discovery page has no visible candidates', {
        url: pageState.url,
        pageType: pageState.pageType,
        profileHrefCount: pageState.profileHrefCount,
        profileSearchButtonCount: pageState.profileSearchButtonCount,
        profileSearchBatchCandidateCount: pageState.profileSearchBatchCandidateCount,
        profileSearchExtensionCandidateCount: pageState.profileSearchExtensionCandidateCount,
        spaceFeedCandidateCount: pageState.spaceFeedCandidateCount,
        profileSearchRowCount: pageState.profileSearchRowCount
    })
    if(!contentState.ok) fail('discovery content state did not return from content script context', contentState)
    else {
        if(contentState.scoped !== true) fail('discovery content state is not scoped', contentState)
        if(contentState.queueRows !== 0) fail('discovery content state exposed queue rows', contentState)
        if(contentState.progressRows !== 0) fail('discovery content state exposed profile progress rows', contentState)
    }

    return {
        target: {
            id: target.id,
            type: target.type || '',
            url: target.url || ''
        },
        page: pageState,
        coordinatorState: contentState
    }
}

async function runSpaceDiscoverySmoke(config, options, context, warnings, fail) {
    const classified = await classifySpacesForDiscovery(context, options.spaceAssetUrls, options.spaceTargetUrls)
    const pages = []
    const pageInputs = [
        ...options.spaceAssetUrls.map(url => ({url, category: 'asset'})),
        ...options.spaceTargetUrls.map(url => ({url, category: 'target'}))
    ]

    for(const input of pageInputs) {
        const target = await findOrOpenPage(config, input.url, warnings, `phase 3 ${input.category} space`)
        const page = await inspectDiscoveryWithState(target, options, 'space', fail)
        if(page.page.spaceCategory && page.page.spaceCategory !== input.category) {
            fail('space discovery category mismatch', {
                url: page.page.url,
                expected: input.category,
                actual: page.page.spaceCategory
            })
        }
        pages.push({
            ...page,
            expectedCategory: input.category
        })
    }

    return {
        kind: PHASE3_SPACE,
        classified,
        totalCandidateCount: pages.reduce((total, page) => total + (Number(page.page.discoveryCandidateCount || 0) || 0), 0),
        pages
    }
}

async function runSearchDiscoverySmoke(config, options, warnings, fail) {
    const target = await findOrOpenPage(config, options.searchUrl, warnings, 'phase 3 profile search')
    const page = await inspectDiscoveryWithState(target, options, 'profile-search', fail)
    return {
        kind: PHASE3_SEARCH,
        totalCandidateCount: Number(page.page.discoveryCandidateCount || 0) || 0,
        pages: [page]
    }
}

async function clickSpaceCategory(target, category) {
    return evaluate(target.webSocketDebuggerUrl, `(${function clickCategory(nextCategory) {
        const categoriesBeforeClick = Array.from(document.querySelectorAll('.mb-ext_space-category-btn'))
            .map(candidate => ({
                category: candidate.dataset.category || '',
                active: candidate.dataset.active || '',
                text: `${candidate.innerText || candidate.textContent || ''}`.replace(/\s+/g, ' ').trim()
            }))
        const button = document.querySelector(`.mb-ext_space-category-btn[data-category="${nextCategory}"]`)
        if(!button) {
            return {
                clicked: false,
                reason: 'button-not-found',
                categoriesBeforeClick
            }
        }
        button.click()
        return {
            clicked: true,
            category: button.dataset.category || '',
            text: `${button.innerText || button.textContent || ''}`.replace(/\s+/g, ' ').trim(),
            categoriesBeforeClick
        }
    }})(${JSON.stringify(category)})`, 10000)
}

async function waitForSpaceCategory(target, options, category, fail, label) {
    let page = await inspectDiscoveryWithState(target, options, 'space', fail, false)
    for(let attempt = 0; attempt < 10 && page.page.spaceCategory !== category; attempt += 1) {
        await sleep(400)
        page = await inspectDiscoveryWithState(target, options, 'space', fail, false)
    }
    if(page.page.spaceCategory !== category) {
        fail(`space mark UI did not persist ${label} category`, {
            expected: category,
            actual: page.page.spaceCategory,
            url: page.page.url,
            spaceCategoryHostPresent: page.page.spaceCategoryHostPresent
        })
    }
    return page
}

async function reloadPageTarget(target) {
    await cdpCommand(target.webSocketDebuggerUrl, 'Page.reload', {ignoreCache: true}, 10000)
    await sleep(4500)
}

async function runSpaceMarkUiSmoke(config, options, warnings, fail) {
    const desiredCategory = options.spaceMarkCategory
    const temporaryCategory = desiredCategory === 'neutral' ? 'asset' : 'neutral'
    const target = await findOrOpenPage(config, options.spaceMarkUrl, warnings, 'phase 4 space mark UI')
    const before = await inspectDiscoveryWithState(target, options, 'space', fail, false)

    if(!before.page.spaceCategoryHostPresent) {
        fail('space mark UI category host is missing', {
            url: before.page.url,
            contentReady: before.page.contentReady,
            pageType: before.page.pageType
        })
    }

    const temporaryClick = await clickSpaceCategory(target, temporaryCategory)
    if(temporaryClick?.clicked !== true) {
        fail('space mark UI temporary category click failed', temporaryClick)
    }
    const temporary = await waitForSpaceCategory(target, options, temporaryCategory, fail, 'temporary')

    const finalClick = await clickSpaceCategory(target, desiredCategory)
    if(finalClick?.clicked !== true) {
        fail('space mark UI final category click failed', finalClick)
    }
    const final = await waitForSpaceCategory(target, options, desiredCategory, fail, 'final')

    await reloadPageTarget(target)
    const reloaded = await waitForSpaceCategory(target, options, desiredCategory, fail, 'reloaded')

    return {
        kind: PHASE4_SPACE_MARK,
        url: reloaded.page.url || options.spaceMarkUrl,
        desiredCategory,
        temporaryCategory,
        before,
        temporaryClick,
        temporary,
        finalClick,
        final,
        reloaded
    }
}

async function inspectDashboardPage(target) {
    return evaluate(target.webSocketDebuggerUrl, `(${function inspectDashboard() {
        const text = id => `${document.getElementById(id)?.textContent || ''}`.replace(/\s+/g, ' ').trim()
        const numericText = id => {
            const value = Number.parseInt(text(id), 10)
            return Number.isFinite(value) ? value : 0
        }
        const actions = (globalThis.__mbUpgradeRegressionMessages || [])
            .filter(entry => entry && typeof entry === 'object')
            .map(entry => ({
                action: `${entry.action || ''}`,
                reason: `${entry.reason || ''}`,
                userInitiated: entry.userInitiated === true,
                allowBeforeQuora: entry.allowBeforeQuora === true
            }))

        return {
            url: location.href,
            title: document.title,
            ready: text('appVersion') !== 'v0.0.0' && text('refreshState') !== 'Loading',
            appVersion: text('appVersion'),
            refreshState: text('refreshState'),
            pauseState: text('pauseCurrentWorkState'),
            currentWorkSummary: text('currentWorkReadyCount'),
            queueCount: text('queueCount'),
            queuedCount: numericText('queuedCount'),
            activeCount: numericText('activeCount'),
            terminalCount: numericText('terminalCount'),
            eventCount: numericText('eventCount'),
            runCount: text('runCount'),
            metricsUpdated: text('metricsUpdated'),
            queueListRows: document.querySelectorAll('#queueList > *').length,
            metricsGridItems: document.querySelectorAll('#metricsGrid > *').length,
            metricsJournalRows: document.querySelectorAll('#metricsJournal > *').length,
            runListRows: document.querySelectorAll('#runList > *').length,
            eventListRows: document.querySelectorAll('#eventList > *').length,
            startButtonHidden: document.getElementById('startCoordinatorButton')?.hidden === true,
            messageActions: actions
        }
    }})()`, 10000)
}

async function waitForDashboardReady(target, fail) {
    let dashboard = await inspectDashboardPage(target)
    for(let attempt = 0; attempt < 15 && !dashboard.ready; attempt += 1) {
        await sleep(400)
        dashboard = await inspectDashboardPage(target)
    }
    if(!dashboard.ready) {
        fail('dashboard did not render current authority state', dashboard)
    }
    return dashboard
}

async function runDashboardAuthoritySmoke(config, options, context, storageBefore, workStateBefore, warnings, fail) {
    const dashboardTarget = await ensureDashboardPage(config, warnings)
    await installDashboardMessageProbe(dashboardTarget)
    await reloadPageTarget(dashboardTarget)
    const dashboard = await waitForDashboardReady(dashboardTarget, fail)
    const storageAfterDashboard = await readStorage(context)
    failIfStorageUnavailable(storageAfterDashboard, fail, 'dashboard-smoke')
    const workStateAfterDashboard = summarizeWorkState(storageAfterDashboard)
    const authoritySources = summarizeDashboardAuthoritySources(storageAfterDashboard)
    const capturedActions = dashboard.messageActions.map(entry => entry.action).filter(Boolean)
    const forbiddenCapturedActions = capturedActions.filter(action =>
        FORBIDDEN_DASHBOARD_MESSAGE_ACTION_PATTERNS.some(pattern => pattern.test(action)))

    if(forbiddenCapturedActions.length) {
        fail('dashboard sent queue-starting or profile-mutating runtime actions', {
            forbiddenCapturedActions,
            messageActions: dashboard.messageActions
        })
    }
    if(!authoritySources.compactQueueViewPresent) {
        fail('dashboard authority smoke did not have compact coordinator queue view', authoritySources)
    }
    if(!authoritySources.compactMetricsViewPresent) {
        fail('dashboard authority smoke did not have compact wakeup metrics view', authoritySources)
    }
    if(authoritySources.fullLegacyProgressPresent) {
        fail('dashboard authority smoke revived full legacy progress storage', authoritySources)
    }
    if(workStateAfterDashboard.rawActiveLike > workStateBefore.rawActiveLike ||
            workStateAfterDashboard.rawQueuedLike > workStateBefore.rawQueuedLike ||
            workStateAfterDashboard.viewActiveLike > workStateBefore.viewActiveLike ||
            workStateAfterDashboard.viewQueuedLike > workStateBefore.viewQueuedLike) {
        fail('dashboard authority smoke started or queued work', {
            before: workStateBefore,
            after: workStateAfterDashboard
        })
    }

    return {
        kind: PHASE5_DASHBOARD_AUTHORITY,
        target: {
            id: dashboardTarget.id,
            type: dashboardTarget.type || '',
            url: dashboardTarget.url || ''
        },
        dashboard,
        capturedActions,
        forbiddenCapturedActions,
        authoritySources,
        storageKeysAfterDashboard: storageAfterDashboard.keys,
        workStateBefore,
        workStateAfter: workStateAfterDashboard
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
    if(!extensionBefore) {
        const report = {
            pass: false,
            phase: options.phase,
            profileLabel: options.profileLabel,
            generatedAt: new Date().toISOString(),
            cdp: {
                host: options.host,
                port: options.port
            },
            extension: null,
            extensionBefore: null,
            expectedVersion,
            storageKeys: [],
            storageKeysBefore: [],
            storageKeysAfter: [],
            storageKeyDelta: {
                before: [],
                after: [],
                added: [],
                removed: [],
                allowedAdded: [],
                unexpectedAdded: []
            },
            allowedAddedStorageKeys: allowedAddedStorageKeySummary(options.phase),
            alarms: [],
            legacyActions: {},
            reconcileDisplayOnly: null,
            currentActions: {},
            contentSmoke: null,
            discoverySmoke: null,
            spaceMarkSmoke: null,
            dashboardAuthoritySmoke: null,
            workStateBefore: null,
            workStateAfter: null,
            authorityStateBefore: null,
            authorityStateAfter: null,
            failures,
            warnings
        }
        const comparable = comparableReport(report)
        if(options.writeBaseline) writeJson(options.writeBaseline, {...report, comparable})
        console.log(JSON.stringify(options.verbose ? {...report, comparable} : report, null, 2))
        process.exit(1)
    }

    const context = await ensureExtensionContext(config, warnings)
    const storageBefore = await readStorage(context)
    failIfStorageUnavailable(storageBefore, fail, 'before-smoke')
    const workStateBefore = summarizeWorkState(storageBefore)
    const authorityStateBefore = summarizeAuthorityState(storageBefore)

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
    let discoverySmoke = null
    let spaceMarkSmoke = null
    let dashboardAuthoritySmoke = null
    if(options.phase === PHASE2) {
        contentSmoke = await runContentSmoke(config, options, warnings, fail)
        await sleep(500)
    }
    else if(options.phase === PHASE3_SPACE) {
        discoverySmoke = await runSpaceDiscoverySmoke(config, options, context, warnings, fail)
        await sleep(500)
    }
    else if(options.phase === PHASE3_SEARCH) {
        discoverySmoke = await runSearchDiscoverySmoke(config, options, warnings, fail)
        await sleep(500)
    }
    else if(options.phase === PHASE4_SPACE_MARK) {
        spaceMarkSmoke = await runSpaceMarkUiSmoke(config, options, warnings, fail)
        await sleep(500)
    }
    else if(options.phase === PHASE5_DASHBOARD_AUTHORITY) {
        dashboardAuthoritySmoke = await runDashboardAuthoritySmoke(
            config,
            options,
            context,
            storageBefore,
            workStateBefore,
            warnings,
            fail
        )
        await sleep(500)
    }

    const storageAfter = await readStorage(context)
    failIfStorageUnavailable(storageAfter, fail, 'after-smoke')
    const workStateAfter = summarizeWorkState(storageAfter)
    const authorityStateAfter = summarizeAuthorityState(storageAfter)
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
    if(isNonWorkSpaceRegistryPhase(options.phase) || options.phase === PHASE5_DASHBOARD_AUTHORITY) {
        assertDiscoveryDidNotCreateAuthority(authorityStateBefore, authorityStateAfter, fail)
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
        discoverySmoke,
        spaceMarkSmoke,
        dashboardAuthoritySmoke,
        workStateBefore,
        workStateAfter,
        authorityStateBefore,
        authorityStateAfter,
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
