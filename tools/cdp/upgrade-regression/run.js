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
const PHASE = 'phase1-non-work-starting-smoke'
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

function parseArgs(argv) {
    const options = {
        host: DEFAULT_HOST,
        port: DEFAULT_PORT,
        extensionId: DEFAULT_EXTENSION_ID,
        profileLabel: DEFAULT_PROFILE_LABEL,
        writeBaseline: '',
        compareBaseline: '',
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
        else if(arg === '--verbose') options.verbose = true
        else if(arg === '--help' || arg === '-h') {
            printUsage()
            process.exit(0)
        }
        else throw new Error(`unknown argument: ${arg}`)
    }

    if(!options.extensionId) throw new Error('--extension-id is required')
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

function diffStorageKeys(before = [], after = []) {
    const beforeSet = new Set(before)
    const afterSet = new Set(after)
    const added = after.filter(key => !beforeSet.has(key)).sort()
    const removed = before.filter(key => !afterSet.has(key)).sort()
    const allowedAdded = added.filter(key => ALLOWED_ADDED_STORAGE_KEYS.has(key)).sort()
    const unexpectedAdded = added.filter(key => !ALLOWED_ADDED_STORAGE_KEYS.has(key)).sort()

    return {
        before,
        after,
        added,
        removed,
        allowedAdded,
        unexpectedAdded
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
    return {
        profileLabel: report.profileLabel,
        extension: report.extension,
        storageKeys: report.storageKeys,
        storageKeyDelta: report.storageKeyDelta,
        alarms: (report.alarms || []).map(alarm => alarm.name).sort(),
        currentActions: report.currentActions,
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
    const extension = await getExtensionInfo(extensionsPage, options.extensionId)
    if(!extension) fail('extension is not installed', {extensionId: options.extensionId})
    else {
        if(extension.id !== options.extensionId) fail('extension id mismatch', {expected: options.extensionId, actual: extension.id})
        if(extension.name !== 'Mute Block') fail('extension name mismatch', {expected: 'Mute Block', actual: extension.name})
        if(extension.version !== expectedVersion) fail('extension version mismatch', {expected: expectedVersion, actual: extension.version})
        if(extension.state !== 'ENABLED') fail('extension is not enabled', {actual: extension.state})
        if(extension.manifestErrors.length) fail('manifest errors are present', extension.manifestErrors)
        if(extension.runtimeErrors.length) fail('runtime errors are present', extension.runtimeErrors)
        if(extension.runtimeWarnings.length) fail('runtime warnings are present', extension.runtimeWarnings)
        if(extension.installWarnings.length) fail('install warnings are present', extension.installWarnings)
    }

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

    const storageAfter = await readStorage(context)
    const workStateAfter = summarizeWorkState(storageAfter)
    const alarmsResult = await readAlarms(context)
    const alarms = alarmsResult.alarms || []
    const alarmNames = alarms.map(alarm => alarm.name)

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

    const storageKeyDelta = diffStorageKeys(storageBefore.keys, storageAfter.keys)
    if(storageKeyDelta.unexpectedAdded.length) {
        fail('unexpected storage keys were created by phase 1 smoke', {
            unexpectedAdded: storageKeyDelta.unexpectedAdded,
            allowedAdded: Array.from(ALLOWED_ADDED_STORAGE_KEYS).sort()
        })
    }
    if(storageKeyDelta.removed.length) {
        warn('storage keys were removed during phase 1 smoke', {
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
        fail('phase 1 smoke appears to have started or queued work', {
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
        phase: PHASE,
        profileLabel: options.profileLabel,
        generatedAt: new Date().toISOString(),
        cdp: {
            host: options.host,
            port: options.port
        },
        extension,
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
        allowedAddedStorageKeys: Array.from(ALLOWED_ADDED_STORAGE_KEYS).sort(),
        alarms,
        legacyActions: legacyActionSummary,
        reconcileDisplayOnly: reconcileDisplayOnlySummary,
        currentActions: currentActionSummary,
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
