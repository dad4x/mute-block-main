#!/usr/bin/env node

const crypto = require('crypto')
const fs = require('fs')
const path = require('path')

const {
    cdpCommand,
    DEFAULT_REMOTE_CHROME_DEV_PATH,
    evaluate,
    getJson,
    getTargets,
    resolveCdpConfig,
    runMain,
    sleep
} = require('../lib/cdp')
const {
    hydrateSegmentedWalStore,
    isSegmentedWalStorageMeta,
    recoverProjectedState
} = require('../../../shared/js/walSnapshotStore')

const DEFAULT_EXTENSION_ID = 'auto'
const DEFAULT_PROFILE_LABEL = 'dev-current'
const DEFAULT_HOST = '127.0.0.1'
const DEFAULT_PORT = 9223
const PHASE1 = 'phase1-non-work-starting-smoke'
const PHASE2 = 'phase2-content-smoke'
const PHASE3_SPACE = 'phase3-space-discovery-smoke'
const PHASE3_SEARCH = 'phase3-search-discovery-smoke'
const PHASE4_SPACE_MARK = 'phase4-space-mark-ui-smoke'
const PHASE5_DASHBOARD_AUTHORITY = 'phase5-dashboard-readonly-authority-smoke'
const PHASE6_STALE_CONTENT_REFRESH = 'phase6-stale-content-refresh-reinject-smoke'
const PHASE7_DISCOVERY_RELOAD = 'phase7-discovery-reload-stability-smoke'
const PHASE8_ONE_ITEM_QUEUE = 'phase8-one-item-queue-authority-smoke'
const PHASE9_SMALL_BATCH_QUEUE = 'phase9-small-batch-queue-authority-smoke'
const PHASE10_MEDIUM_BATCH_QUEUE = 'phase10-medium-batch-queue-authority-smoke'
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
const PHASE10_SEARCH_FALLBACK_URLS = [
    'https://www.quora.com/search?q=john%20smith&type=profile',
    'https://www.quora.com/search?q=michael%20johnson&type=profile',
    'https://www.quora.com/search?q=david%20smith&type=profile',
    'https://www.quora.com/search?q=james%20smith&type=profile',
    'https://www.quora.com/search?q=robert%20smith&type=profile',
    'https://www.quora.com/search?q=william%20smith&type=profile',
    'https://www.quora.com/search?q=michael%20brown&type=profile',
    'https://www.quora.com/search?q=david%20johnson&type=profile',
    'https://www.quora.com/search?q=marie%20curie&type=profile',
    'https://www.quora.com/search?q=katherine%20johnson&type=profile',
    'https://www.quora.com/search?q=alan%20turing&type=profile',
    'https://www.quora.com/search?q=grace%20hopper&type=profile',
    'https://www.quora.com/search?q=ada%20lovelace&type=profile',
    'https://www.quora.com/search?q=claude%20shannon&type=profile',
    'https://www.quora.com/search?q=norbert%20wiener&type=profile',
    'https://www.quora.com/search?q=john%20mccarthy&type=profile',
    'https://www.quora.com/search?q=marvin%20minsky&type=profile',
    'https://www.quora.com/search?q=herbert%20simon&type=profile',
    'https://www.quora.com/search?q=allen%20newell&type=profile',
    'https://www.quora.com/search?q=margaret%20hamilton&type=profile',
    'https://www.quora.com/search?q=barbara%20liskov&type=profile',
    'https://www.quora.com/search?q=frances%20allen&type=profile',
    'https://www.quora.com/search?q=sundar%20pichai&type=profile',
    'https://www.quora.com/search?q=jensen%20huang&type=profile'
]
const DEFAULT_BENIGN_QUORA_URL = 'https://www.quora.com/'
const DEFAULT_SPACE_MARK_URL = 'https://instantblock.quora.com/'
const DEFAULT_SPACE_MARK_CATEGORY = 'asset'
const DEFAULT_WINDOWS_UNPACKED_EXTENSION_PATH = DEFAULT_REMOTE_CHROME_DEV_PATH
const PHASE10_HARNESS_WATCHDOG_MS = 180000
const PHASE10_TARGET_SELECTION_TIMEOUT_MS = 180000
const PHASE10_FLIGHT_RECORDER_LIMIT = 2000
const EXPECTED_EXTENSION_NAMES = new Set(['Mute Block', 'Mute Block Dev'])
const COORDINATOR_QUEUE_KEY = 'mbCoordinatorQueue'
const COORDINATOR_QUEUE_WAL_KEY = 'mbCoordinatorQueueWal'
const COORDINATOR_QUEUE_WAL_META_KEY = `${COORDINATOR_QUEUE_WAL_KEY}.meta`
const SUPPORTED_PHASES = [
    PHASE1,
    PHASE2,
    PHASE3_SPACE,
    PHASE3_SEARCH,
    PHASE4_SPACE_MARK,
    PHASE5_DASHBOARD_AUTHORITY,
    PHASE6_STALE_CONTENT_REFRESH,
    PHASE7_DISCOVERY_RELOAD,
    PHASE8_ONE_ITEM_QUEUE,
    PHASE9_SMALL_BATCH_QUEUE,
    PHASE10_MEDIUM_BATCH_QUEUE
]

const LEGACY_RECORD_PROGRESS_ACTION = ["record", "nuke", "progress"].join("-")
const LEGACY_RECORD_PROGRESS_BATCH_ACTION = ["record", "nuke", "progress", "batch"].join("-")
const LEGACY_REPAIR_COORDINATOR_STORAGE_ACTION = ["repair", "coordinator", "storage"].join("-")
const LEGACY_FULL_PROGRESS_KEY = ["mb", "Profile", "Nuke", "Progress"].join("")
const LEGACY_REPAIR_ALARM_NAME = ["mb", "stored", "work", "repair"].join("-")
const LEGACY_IMPORT_CAMEL = ["legacy", "Import"].join("")
const IMPORT_LEGACY_CAMEL = ["import", "Legacy"].join("")
const LEGACY_ACTIONS = [
    LEGACY_RECORD_PROGRESS_ACTION,
    LEGACY_RECORD_PROGRESS_BATCH_ACTION,
    LEGACY_REPAIR_COORDINATOR_STORAGE_ACTION
]

const CURRENT_ACTIONS = [
    'get-coordinator-queue-accounting',
    'get-coordinator-why-not-running',
    'refresh-queue-wakeup-metrics-view'
]

const OPERATOR_LOAD_UNPACKED_PROMPT =
    `>>>>>> OPERATOR INTERVENTION: do open chrome://extensions, enable Developer mode, click Load unpacked, select ${DEFAULT_WINDOWS_UNPACKED_EXTENSION_PATH}, and report the listed extension ID/version or the exact visible Chrome error text.`
const OPERATOR_QUORA_LOGIN_PROMPT =
    '>>>>>> OPERATOR INTERVENTION: do sign in to Quora in the visible regression Chrome profile, then rerun the requested non-work-starting smoke.'

function addOperatorIntervention(interventions, prompt) {
    if(prompt && !interventions.includes(prompt)) interventions.push(prompt)
}

function printOperatorInterventions(interventions = []) {
    for(const prompt of interventions) {
        console.error(prompt)
    }
}

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
    new RegExp("^" + LEGACY_FULL_PROGRESS_KEY + "\x24"),
    new RegExp(["PROFILE", "NUKE", "PROGRESS", "KEY"].join("_")),
    new RegExp(LEGACY_RECORD_PROGRESS_ACTION),
    new RegExp(LEGACY_RECORD_PROGRESS_BATCH_ACTION),
    new RegExp(LEGACY_IMPORT_CAMEL),
    new RegExp(IMPORT_LEGACY_CAMEL),
    new RegExp(["repair", ""].join("-")),
    new RegExp(LEGACY_REPAIR_COORDINATOR_STORAGE_ACTION),
    new RegExp(LEGACY_REPAIR_ALARM_NAME),
    new RegExp(["skip", "Repair"].join("")),
    new RegExp(["projection", "Repair", "DelayMs"].join(""))
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
    'mbCoordinatorTabId',
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

const ALLOWED_PHASE8_ADDED_STORAGE_KEY_PATTERNS = [
    /^mbCoordinator/,
    /^mbProfileNukeProgressView$/,
    /^mbProfileNukeProgressShard\./,
    /^mbQueueWakeupMetrics(?:View)?$/,
    /^mbOwnedTabIdsByParent$/,
    /^mbBrowserSessionMarker$/,
    /^mbQuoraRuntimeActivated$/,
    /^mbQueuedActionSurfaceState$/
]

function parseArgs(argv) {
    const options = {
        host: DEFAULT_HOST,
        port: DEFAULT_PORT,
        extensionId: DEFAULT_EXTENSION_ID,
        extensionPath: DEFAULT_WINDOWS_UNPACKED_EXTENSION_PATH,
        extensionVersion: '',
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
        phase8TargetProfileHref: '',
        phase8TimeoutMs: 120000,
        phase9TargetCount: 3,
        phase9TimeoutMs: 600000,
        phase10TargetCount: 10,
        phase10TimeoutMs: 1200000,
        phase10Concurrency: 2,
        phase10IdleMs: 20000,
        phase10SearchAttemptLimit: 20,
        phase10WatchdogSelfTest: false,
        allowWorkProducing: false,
        includeFlightRecorder: false,
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
        else if(arg === '--extension-path') options.extensionPath = readValue(options.extensionPath)
        else if(arg.startsWith('--extension-path=')) options.extensionPath = arg.slice('--extension-path='.length)
        else if(arg === '--extension-version') options.extensionVersion = readValue(options.extensionVersion)
        else if(arg.startsWith('--extension-version=')) options.extensionVersion = arg.slice('--extension-version='.length)
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
        else if(arg === '--phase8-target-profile-href') options.phase8TargetProfileHref = readValue('')
        else if(arg.startsWith('--phase8-target-profile-href=')) options.phase8TargetProfileHref = arg.slice('--phase8-target-profile-href='.length)
        else if(arg === '--phase8-timeout-ms') options.phase8TimeoutMs = Number.parseInt(readValue(`${options.phase8TimeoutMs}`), 10) || options.phase8TimeoutMs
        else if(arg.startsWith('--phase8-timeout-ms=')) options.phase8TimeoutMs = Number.parseInt(arg.slice('--phase8-timeout-ms='.length), 10) || options.phase8TimeoutMs
        else if(arg === '--phase9-target-count') options.phase9TargetCount = Number.parseInt(readValue(`${options.phase9TargetCount}`), 10) || options.phase9TargetCount
        else if(arg.startsWith('--phase9-target-count=')) options.phase9TargetCount = Number.parseInt(arg.slice('--phase9-target-count='.length), 10) || options.phase9TargetCount
        else if(arg === '--phase9-timeout-ms') options.phase9TimeoutMs = Number.parseInt(readValue(`${options.phase9TimeoutMs}`), 10) || options.phase9TimeoutMs
        else if(arg.startsWith('--phase9-timeout-ms=')) options.phase9TimeoutMs = Number.parseInt(arg.slice('--phase9-timeout-ms='.length), 10) || options.phase9TimeoutMs
        else if(arg === '--phase10-target-count') options.phase10TargetCount = Number.parseInt(readValue(`${options.phase10TargetCount}`), 10) || options.phase10TargetCount
        else if(arg.startsWith('--phase10-target-count=')) options.phase10TargetCount = Number.parseInt(arg.slice('--phase10-target-count='.length), 10) || options.phase10TargetCount
        else if(arg === '--phase10-timeout-ms') options.phase10TimeoutMs = Number.parseInt(readValue(`${options.phase10TimeoutMs}`), 10) || options.phase10TimeoutMs
        else if(arg.startsWith('--phase10-timeout-ms=')) options.phase10TimeoutMs = Number.parseInt(arg.slice('--phase10-timeout-ms='.length), 10) || options.phase10TimeoutMs
        else if(arg === '--phase10-concurrency') options.phase10Concurrency = Number.parseInt(readValue(`${options.phase10Concurrency}`), 10) || options.phase10Concurrency
        else if(arg.startsWith('--phase10-concurrency=')) options.phase10Concurrency = Number.parseInt(arg.slice('--phase10-concurrency='.length), 10) || options.phase10Concurrency
        else if(arg === '--phase10-idle-ms') options.phase10IdleMs = Number.parseInt(readValue(`${options.phase10IdleMs}`), 10) || options.phase10IdleMs
        else if(arg.startsWith('--phase10-idle-ms=')) options.phase10IdleMs = Number.parseInt(arg.slice('--phase10-idle-ms='.length), 10) || options.phase10IdleMs
        else if(arg === '--phase10-search-attempt-limit') options.phase10SearchAttemptLimit = Number.parseInt(readValue(`${options.phase10SearchAttemptLimit}`), 10) || options.phase10SearchAttemptLimit
        else if(arg.startsWith('--phase10-search-attempt-limit=')) options.phase10SearchAttemptLimit = Number.parseInt(arg.slice('--phase10-search-attempt-limit='.length), 10) || options.phase10SearchAttemptLimit
        else if(arg === '--phase10-watchdog-self-test') options.phase10WatchdogSelfTest = true
        else if(arg === '--allow-work-producing') options.allowWorkProducing = true
        else if(arg === '--include-flight-recorder') options.includeFlightRecorder = true
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
    if(options.phase === PHASE8_ONE_ITEM_QUEUE && options.allowWorkProducing !== true) {
        throw new Error(`${PHASE8_ONE_ITEM_QUEUE} intentionally creates queue/profile work; rerun with --allow-work-producing in a disposable logged-in profile`)
    }
    if(options.phase === PHASE9_SMALL_BATCH_QUEUE && options.allowWorkProducing !== true) {
        throw new Error(`${PHASE9_SMALL_BATCH_QUEUE} intentionally creates queue/profile work; rerun with --allow-work-producing in a disposable logged-in profile`)
    }
    if(options.phase === PHASE10_MEDIUM_BATCH_QUEUE && options.allowWorkProducing !== true) {
        throw new Error(`${PHASE10_MEDIUM_BATCH_QUEUE} intentionally creates queue/profile work; rerun with --allow-work-producing in a disposable logged-in profile`)
    }
    if(options.phase === PHASE9_SMALL_BATCH_QUEUE) {
        options.phase9TargetCount = Math.max(3, Math.min(Number.parseInt(options.phase9TargetCount, 10) || 3, 5))
    }
    if(options.phase === PHASE10_MEDIUM_BATCH_QUEUE) {
        options.phase10TargetCount = Math.max(1, Math.min(Number.parseInt(options.phase10TargetCount, 10) || 10, 12))
        options.phase10Concurrency = Math.max(1, Math.min(Number.parseInt(options.phase10Concurrency, 10) || 2, 3))
        options.phase10IdleMs = Math.max(5000, Math.min(Number.parseInt(options.phase10IdleMs, 10) || 20000, 60000))
        options.phase10SearchAttemptLimit = Math.max(1, Math.min(Number.parseInt(options.phase10SearchAttemptLimit, 10) || 20, 20))
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
        '  node tools/cdp/upgrade-regression/run.js --extension-id auto --extension-path "C:\\\\Users\\\\DBROWER\\\\Documents\\\\src\\\\mute-block-main\\\\chrome-dev"',
        '',
        'Options:',
        '  --host 127.0.0.1',
        '  --port 9223',
        '  --extension-id auto',
        `  --extension-path ${DEFAULT_WINDOWS_UNPACKED_EXTENSION_PATH}`,
        '  --extension-version 1.6.x',
        '  --profile-label store-1.4-to-current',
        `  --phase ${SUPPORTED_PHASES.join('|')}`,
        `  --quora-url ${DEFAULT_BENIGN_QUORA_URL}`,
        `  --search-url ${DEFAULT_SEARCH_URL}`,
        `  --space-mark-url ${DEFAULT_SPACE_MARK_URL}`,
        `  --space-mark-category ${DEFAULT_SPACE_MARK_CATEGORY}`,
        '  --space-asset-url https://theqdefensecrew.quora.com/',
        '  --space-target-url https://terryspcfreetopics.quora.com/',
        '  --phase8-target-profile-href https://www.quora.com/profile/example',
        '  --phase8-timeout-ms 120000',
        '  --phase9-target-count 3',
        '  --phase9-timeout-ms 600000',
        '  --phase10-target-count 10',
        '  --phase10-timeout-ms 1200000',
        '  --phase10-concurrency 2',
        '  --phase10-idle-ms 20000',
        '  --phase10-search-attempt-limit 20',
        '  --phase10-watchdog-self-test',
        '  --allow-work-producing',
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
    if(!EXPECTED_EXTENSION_NAMES.has(extension.name)) {
        fail(`${label} name mismatch`, {expected: Array.from(EXPECTED_EXTENSION_NAMES), actual: extension.name})
    }
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
        ...targets.filter(item => item.type === 'page' && (item.url || '').startsWith(extensionPrefix) && item.url !== dashboardUrl)
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
        targets.find(item => item.type === 'page' && (item.url || '').startsWith(extensionPrefix))
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


async function readFlightRecorder(target, request = {}) {
    const result = await sendRuntimeMessage(target, {
        action: "get-flight-recorder",
        limit: 2000,
        ...request
    }, 10000)
    return {
        ok: !result.timedOut && !result.lastError && result.response?.readOnly === true,
        timedOut: result.timedOut === true,
        lastError: result.lastError || "",
        response: result.response || null
    }
}

async function readQueueRuntimeState(target, targetProfileHrefs = []) {
    const result = await sendRuntimeMessage(target, {
        action: "get-coordinator-queue-runtime-state",
        targetProfileHrefs
    }, 10000)
    return {
        ok: !result.timedOut && !result.lastError && result.response?.readOnly === true,
        timedOut: result.timedOut === true,
        lastError: result.lastError || "",
        response: result.response || null
    }
}

async function readExecutorClassification(target) {
    const result = await sendRuntimeMessage(target, {
        action: "get-coordinator-why-not-running",
        reason: "phase10-diagnostic"
    }, 15000)
    return {
        ok: !result.timedOut && !result.lastError && result.response?.readOnly === true,
        timedOut: result.timedOut === true,
        lastError: result.lastError || "",
        response: result.response?.executor || null
    }
}

async function readCoordinatorWhyNotRunning(target, reason = "phase10-diagnostic") {
    const result = await sendRuntimeMessage(target, {
        action: "get-coordinator-why-not-running",
        reason
    }, 15000)
    return {
        ok: !result.timedOut && !result.lastError && result.response?.readOnly === true,
        timedOut: result.timedOut === true,
        lastError: result.lastError || "",
        response: result.response || null
    }
}

function hasCoordinatorRecoverySignal(whyNotRunning = null) {
    const response = whyNotRunning?.response || whyNotRunning || {}
    const scheduler = response.scheduler || {}
    const storage = response.storage || {}
    const promises = response.promises || {}
    if(Number.parseInt(scheduler.coordinatorQueueResumeDueAt, 10) > 0) return true
    if(Number.parseInt(scheduler.coordinatorReconcileDueAt, 10) > 0) return true
    if(scheduler.coordinatorQueueResumeTimeout === true) return true
    if(scheduler.coordinatorReconcileTimeout === true) return true
    if(promises.queuedTabFillPromise === true) return true
    if(promises.coordinatorResumePromise === true) return true
    if(promises.coordinatorReconcilePromise === true) return true
    if(storage.active === true) return true
    if(Number.parseInt(storage.depth, 10) > 0) return true
    return false
}

function isBenignIdleFlightRecorderEntry(entry = null) {
    const kind = `${entry?.kind || ''}`
    const reason = `${entry?.reason || ''}`
    if(kind === 'executor-classification' && reason === 'idle-no-work') return true
    if(kind === 'start-resume' &&
            reason === 'dashboard-resume' &&
            entry?.accepted === true &&
            entry?.durable !== true) {
        return true
    }
    return false
}

async function readIdleFlightRecorderDelta(target, idleMs = 20000) {
    const before = await readFlightRecorder(target, {limit: 1})
    const beforeSeq = Number.parseInt(before.response?.newestSeq, 10) || 0
    await sleep(Math.max(1000, Number.parseInt(idleMs, 10) || 20000))
    const after = await readFlightRecorder(target, {
        sinceSeq: beforeSeq,
        limit: 200
    })
    const entries = Array.isArray(after.response?.entries) ? after.response.entries : []
    const benignEntries = entries.filter(isBenignIdleFlightRecorderEntry)
    const noisyEntries = entries.filter(entry => !isBenignIdleFlightRecorderEntry(entry))
    return {
        idleMs: Math.max(1000, Number.parseInt(idleMs, 10) || 20000),
        beforeSeq,
        ok: before.ok === true && after.ok === true,
        before,
        after,
        entryCount: entries.length,
        benignEntryCount: benignEntries.length,
        noisyEntryCount: noisyEntries.length,
        noisyEntries,
        entries
    }
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
    }})()`, 60000)
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

async function setStorageValues(target, values = {}) {
    return evaluate(target.webSocketDebuggerUrl, `(${function writeLocalStorage(nextValues) {
        return new Promise(resolve => {
            const localStorage = globalThis.chrome?.storage?.local
            if(typeof localStorage?.set !== 'function') {
                resolve({ok: false, reason: 'storage-set-unavailable'})
                return
            }
            localStorage.set(nextValues, () => resolve({
                ok: !chrome.runtime.lastError,
                lastError: chrome.runtime.lastError ? chrome.runtime.lastError.message : ''
            }))
        })
    }})(${JSON.stringify(values || {})})`, 10000)
}

function isAllowedStorageKey(key) {
    return PREFERENCE_KEYS.has(key) || ALLOWED_STORAGE_KEY_PATTERNS.some(pattern => pattern.test(key))
}

function isAllowedAddedStorageKey(key, phase = PHASE1) {
    if(ALLOWED_ADDED_STORAGE_KEYS.has(key)) return true
    if(isWorkProducingPhase(phase)) return ALLOWED_PHASE8_ADDED_STORAGE_KEY_PATTERNS.some(pattern => pattern.test(key))
    if(isContentRefreshPhase(phase)) return ALLOWED_PHASE2_ADDED_STORAGE_KEY_PATTERNS.some(pattern => pattern.test(key))
    if(isNonWorkSpaceRegistryPhase(phase)) return ALLOWED_PHASE3_ADDED_STORAGE_KEY_PATTERNS.some(pattern => pattern.test(key))
    return false
}

function isDiscoveryPhase(phase = '') {
    return phase === PHASE3_SPACE || phase === PHASE3_SEARCH || phase === PHASE7_DISCOVERY_RELOAD
}

function isNonWorkSpaceRegistryPhase(phase = '') {
    return isDiscoveryPhase(phase) || phase === PHASE4_SPACE_MARK
}

function isContentRefreshPhase(phase = '') {
    return phase === PHASE2 || phase === PHASE6_STALE_CONTENT_REFRESH
}

function isWorkProducingPhase(phase = '') {
    return phase === PHASE8_ONE_ITEM_QUEUE ||
        phase === PHASE9_SMALL_BATCH_QUEUE ||
        phase === PHASE10_MEDIUM_BATCH_QUEUE
}

function summarizeStorageKeyList(keys = []) {
    const sortedKeys = Array.isArray(keys) ? keys.slice().sort() : []
    return {
        count: sortedKeys.length,
        digest: stableDigest(sortedKeys)
    }
}

function diffStorageKeys(before = [], after = [], phase = PHASE1) {
    const beforeSet = new Set(before)
    const afterSet = new Set(after)
    const added = after.filter(key => !beforeSet.has(key)).sort()
    const removed = before.filter(key => !afterSet.has(key)).sort()
    const allowedAdded = added.filter(key => isAllowedAddedStorageKey(key, phase)).sort()
    const unexpectedAdded = added.filter(key => !isAllowedAddedStorageKey(key, phase)).sort()

    return {
        before: summarizeStorageKeyList(before),
        after: summarizeStorageKeyList(after),
        added,
        removed,
        allowedAdded,
        unexpectedAdded
    }
}

function allowedAddedStorageKeySummary(phase = PHASE1) {
    const literal = Array.from(ALLOWED_ADDED_STORAGE_KEYS).sort()
    if(isWorkProducingPhase(phase)) {
        return {
            literal,
            patterns: ALLOWED_PHASE8_ADDED_STORAGE_KEY_PATTERNS.map(pattern => pattern.toString()).sort()
        }
    }
    if(isContentRefreshPhase(phase)) {
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


function stableDigest(value) {
    return crypto.createHash('sha256').update(stableJson(value)).digest('hex')
}

function summarizeStorageKeys(keys = []) {
    const sortedKeys = Array.isArray(keys) ? keys.slice().sort() : []
    const prefixCounts = {}
    for(const key of sortedKeys) {
        const prefix = `${key || ''}`.split('.')[0] || ''
        prefixCounts[prefix] = (prefixCounts[prefix] || 0) + 1
    }
    return {
        count: sortedKeys.length,
        digest: stableDigest(sortedKeys),
        prefixCounts
    }
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
        walKeyCount: walKeys.length,
        walKeyDigest: stableDigest(walKeys),
        walSignature: stableDigest(Object.fromEntries(walKeys.map(key => [key, data[key]]))),
        walKeys: walKeys.slice(-8),
        progressViewRecords: countRecordMap(data.mbProfileNukeProgressView),
        progressShardRecords,
        pendingSpacePostRecords: countRecordMap(data.mbSpacePendingNukedPosts),
        nukedSpacePostRecords: countRecordMap(data.mbSpaceNukedPosts),
        queuedActionSurfaceRecords: countRecordMap(queuedActionSurfaceState)
    }
}

function getSelectedProgressRecords(storage, targetProfileHrefs = [], selectedSummary = null) {
    const data = storage?.data || {}
    const targets = Array.from(new Set((targetProfileHrefs || [])
        .map(target => normalizeComparableUrl(target || ''))
        .filter(Boolean)))
    const viewRecords = data.mbProfileNukeProgressView?.records &&
        typeof data.mbProfileNukeProgressView.records === 'object'
        ? data.mbProfileNukeProgressView.records
        : {}
    const shardRecords = Object.entries(data)
        .filter(([key, value]) => key.startsWith('mbProfileNukeProgressShard.') &&
            value?.records && typeof value.records === 'object')
        .flatMap(([key, value]) => Object.entries(value.records)
            .map(([profileHref, record]) => ({key, profileHref, record})))
    const authorityByTarget = new Map((selectedSummary?.selected || [])
        .map(item => [
            normalizeComparableUrl(item?.targetProfileHref || ''),
            (item?.rows || [])[0] || null
        ])
        .filter(([target]) => !!target))

    return targets.map(target => {
        const matchesTarget = (profileHref = '') => normalizeComparableUrl(profileHref || '') === target
        const viewEntry = Object.entries(viewRecords)
            .find(([profileHref]) => matchesTarget(profileHref))
        const shardEntries = shardRecords
            .filter(entry => matchesTarget(entry.profileHref))
        const authorityRow = authorityByTarget.get(target) || null
        const authorityAttemptId = getAttemptIdFromValue(authorityRow)
        const authorityAttemptNumber = getAttemptNumberFromValue(authorityRow)
        const withAttemptMatch = record => {
            const recordAttemptId = getAttemptIdFromValue(record)
            const recordAttemptNumber = getAttemptNumberFromValue(record)
            return {
                record,
                attemptMatchesAuthority: !!authorityRow &&
                    (!authorityAttemptId ? !recordAttemptId : !recordAttemptId || recordAttemptId === authorityAttemptId) &&
                    (!authorityAttemptNumber ? !recordAttemptNumber : !recordAttemptNumber || recordAttemptNumber === authorityAttemptNumber)
            }
        }
        return {
            targetProfileHref: target,
            authorityRow,
            terminalStatus: authorityRow?.status || '',
            terminalOutcome: authorityRow?.outcome || '',
            terminalError: authorityRow?.error || '',
            authorityAttemptId,
            authorityAttemptNumber,
            view: viewEntry ? withAttemptMatch(viewEntry[1]) : null,
            shards: shardEntries.map(entry => ({
                key: entry.key,
                profileHref: entry.profileHref,
                ...withAttemptMatch(entry.record)
            }))
        }
    })
}

function getAttemptIdFromValue(value = null) {
    return `${value?.attemptId || value?.attempt?.id || ''}`.trim()
}

function getAttemptNumberFromValue(value = null) {
    return Number.parseInt(value?.attemptNumber || value?.attempt?.number || value?.attempt || 0, 10) || 0
}

function getCoordinatorQueueRows(storage) {
    const queue = storage?.data?.mbCoordinatorQueue && typeof storage.data.mbCoordinatorQueue === 'object'
        ? storage.data.mbCoordinatorQueue
        : {}
    return Object.entries(queue)
        .map(([key, row]) => ({
            key,
            status: `${row?.status || row?.state || ''}`,
            outcome: `${row?.outcome || ''}`,
            error: `${row?.error || ''}`.slice(0, 240),
            targetProfileHref: `${row?.targetProfileHref || row?.requestedUrl || row?.dedupeKey || ''}`,
            requestedUrl: `${row?.requestedUrl || ''}`,
            actionKind: `${row?.actionKind || ''}`,
            executorTabAction: `${row?.executorTabAction || ''}`,
            runId: `${row?.runId || ''}`,
            tabId: row?.tabId || null,
            attempt: Number.parseInt(row?.attempt, 10) || 0,
            createdAt: Number.parseInt(row?.createdAt, 10) || 0,
            updatedAt: Number.parseInt(row?.updatedAt, 10) || 0,
            terminalAt: Number.parseInt(row?.terminalAt, 10) || 0
        }))
        .sort((left, right) => left.key.localeCompare(right.key))
}

function getCoordinatorQueueViewRows(storage) {
    const view = storage?.data?.mbCoordinatorQueueView && typeof storage.data.mbCoordinatorQueueView === 'object'
        ? storage.data.mbCoordinatorQueueView
        : {}
    const rows = Array.isArray(view.items) ? view.items :
        Array.isArray(view.rows) ? view.rows :
            Array.isArray(view.queue) ? view.queue : []
    return rows.map((row, index) => ({
        index,
        key: `${row?.coordinatorKey || row?.dedupeKey || row?.key || row?.targetProfileHref || row?.requestedUrl || ''}`,
        status: `${row?.status || row?.state || ''}`,
        outcome: `${row?.outcome || ''}`,
        targetProfileHref: `${row?.targetProfileHref || row?.requestedUrl || row?.dedupeKey || ''}`,
        runId: `${row?.runId || ''}`
    }))
}

function recoverCoordinatorQueueFromWal(storage) {
    const data = storage?.data || {}
    const rawQueue = data[COORDINATOR_QUEUE_KEY] || {}
    const meta = data[COORDINATOR_QUEUE_WAL_META_KEY] || null
    let store = null
    let hydrate = null
    if(isSegmentedWalStorageMeta(meta)) {
        hydrate = hydrateSegmentedWalStore(data, {
            baseKey: COORDINATOR_QUEUE_WAL_KEY,
            fallbackStore: data[COORDINATOR_QUEUE_WAL_KEY] || null
        })
        if(hydrate?.ok === true) store = hydrate.store
        else return {
            queue: rawQueue,
            recovered: false,
            reason: hydrate?.reason || 'segmented-hydrate-failed',
            hydrate
        }
    }
    else if(data[COORDINATOR_QUEUE_WAL_KEY]) {
        store = data[COORDINATOR_QUEUE_WAL_KEY]
    }

    if(!store) return {queue: rawQueue, recovered: false, reason: 'missing-wal'}
    const recovered = recoverProjectedState(store)
    if(recovered?.recovered !== true) {
        return {
            queue: rawQueue,
            recovered: false,
            reason: recovered?.reason || 'wal-recovery-failed',
            wal: recovered,
            hydrate
        }
    }
    return {
        queue: recovered?.projected?.state?.queue || recovered?.state?.queue || {},
        recovered: true,
        reason: '',
        hydrate,
        wal: {
            generationId: recovered.generationId,
            applied: recovered?.projected?.applied?.length || 0,
            ignored: recovered?.projected?.ignored?.length || 0,
            checkpointSeq: recovered?.checkpoint?.snapshotSeq || 0,
            nextSeq: store?.meta?.nextSeq || 0,
            activeGenerationId: store?.meta?.activeCheckpoint || ''
        }
    }
}

function summarizeQueueAuthority(storage, options = {}) {
    const rawRows = getCoordinatorQueueRows(storage)
    const viewRows = getCoordinatorQueueViewRows(storage)
    const recovered = recoverCoordinatorQueueFromWal(storage)
    const recoveredRows = getCoordinatorQueueRows({data: {[COORDINATOR_QUEUE_KEY]: recovered.queue || {}}})
    const preferRecovered = options.preferRecovered === true && recovered.recovered === true
    const allowViewFallback = options.allowViewFallback !== false
    const rows = preferRecovered
        ? recoveredRows
        : rawRows.length
        ? rawRows
        : allowViewFallback
        ? viewRows.map(row => ({
            ...row,
            raw: false,
            requestedUrl: row.targetProfileHref || row.key || ''
        }))
        : []
    const terminalStatuses = new Set(['succeeded', 'success', 'skipped', 'failed', 'canceled', 'cancelled', 'terminal'])
    const isTerminal = row => terminalStatuses.has(`${row.status || ''}`.toLowerCase()) ||
        !!row.terminalAt ||
        /succeeded|success|skipped|failed|canceled|cancelled|terminal/i.test(`${row.status || ''}`)
    return {
        rows,
        rawRows,
        recoveredRows,
        viewRows,
        recovered: recovered.recovered === true,
        recoveryReason: recovered.reason || '',
        wal: recovered.wal || null,
        rowCount: rows.length,
        rawRowCount: rawRows.length,
        recoveredRowCount: recoveredRows.length,
        viewRowCount: viewRows.length,
        activeRows: rows.filter(row => /active|acting|opening|claim|running|pending/i.test(row.status)).length,
        queuedRows: rows.filter(row => /queued|retry|waiting/i.test(row.status)).length,
        terminalRows: rows.filter(isTerminal).length,
        statusCounts: rows.reduce((counts, row) => {
            const status = row.status || 'unknown'
            counts[status] = (counts[status] || 0) + 1
            return counts
        }, {}),
        viewStatusCounts: viewRows.reduce((counts, row) => {
            const status = row.status || 'unknown'
            counts[status] = (counts[status] || 0) + 1
            return counts
        }, {})
    }
}

function filterQueueAuthoritySummary(summary = {}, targetProfileHref = '', options = {}) {
    const target = normalizeComparableUrl(targetProfileHref || '')
    const matches = row => {
        const candidates = [
            row?.targetProfileHref,
            row?.requestedUrl,
            row?.key
        ].map(value => normalizeComparableUrl(value || '')).filter(Boolean)
        return candidates.includes(target)
    }
    const storageLike = {
        data: {
            mbCoordinatorQueue: Object.fromEntries((summary.rows || [])
                .filter(matches)
                .map(row => [row.key || row.targetProfileHref || row.requestedUrl, row])),
            mbCoordinatorQueueView: {
                version: 1,
                items: (summary.viewRows || []).filter(matches)
            }
        }
    }
    const filtered = summarizeQueueAuthority(storageLike, {
        allowViewFallback: options.allowViewFallback !== false
    })
    return {
        ...filtered,
        recovered: summary.recovered === true,
        recoveryReason: summary.recoveryReason || '',
        wal: summary.wal || null
    }
}

function safeArtifactPart(value = '') {
    const cleaned = `${value || ''}`
        .replace(/[^a-z0-9._-]+/ig, '-')
        .replace(/^-+|-+$/g, '')
        .slice(0, 140)
    return cleaned || 'upgrade-regression'
}

function getDiagnosticArtifactPath(options = {}, suffix = 'diagnostic') {
    return path.join(
        'tmp',
        'upgrade-regression',
        `${safeArtifactPart(options.profileLabel)}.${safeArtifactPart(options.phase)}.${safeArtifactPart(suffix)}.json`
    )
}

function summarizeWalEvidence(storage = null) {
    const recovered = recoverCoordinatorQueueFromWal(storage)
    const data = storage?.data || {}
    const walKeys = Object.keys(data)
        .filter(key => key === COORDINATOR_QUEUE_WAL_KEY || key.startsWith(`${COORDINATOR_QUEUE_WAL_KEY}.`))
        .sort()
    return {
        recovered: recovered.recovered === true,
        reason: recovered.reason || '',
        wal: recovered.wal || null,
        hydrate: recovered.hydrate || null,
        walKeys,
        queueRowCount: Object.keys(recovered.queue || {}).length
    }
}

async function readVisibleTargetTabs(config, targetProfileHrefs = []) {
    const normalizedTargets = new Set((targetProfileHrefs || [])
        .map(target => normalizeComparableUrl(target || ''))
        .filter(Boolean))
    const targets = await getTargets(config)
    const pages = targets
        .filter(target => target.type === 'page')
        .map(target => ({
            id: target.id || '',
            title: target.title || '',
            url: target.url || ''
        }))
    const isProfile = target => {
        try {
            const parsed = new URL(target.url || '')
            return /^https:$/.test(parsed.protocol) &&
                /(^|\.)quora\.com$/i.test(parsed.hostname) &&
                /^\/profile\//i.test(parsed.pathname)
        }
        catch {
            return false
        }
    }
    const profileTabs = pages
        .filter(isProfile)
        .map(target => ({
            ...target,
            normalizedUrl: normalizeComparableUrl(target.url || ''),
            selectedTarget: normalizedTargets.has(normalizeComparableUrl(target.url || ''))
        }))
    return {
        profileTabs,
        selectedProfileTabs: profileTabs.filter(target => target.selectedTarget),
        extensionPages: pages.filter(target => /^chrome-extension:\/\//i.test(target.url || '')),
        quoraPages: pages.filter(target => isQuoraUrl(target.url || ''))
    }
}

function buildTabAuthorityInvariant(visibleTabs = {}, fullSummary = {}, selectedTargets = []) {
    const selectedSet = new Set((selectedTargets || [])
        .map(target => normalizeComparableUrl(target || ''))
        .filter(Boolean))
    const selectedProfileTabs = Array.isArray(visibleTabs.selectedProfileTabs)
        ? visibleTabs.selectedProfileTabs
        : []
    const violations = selectedProfileTabs
        .filter(tab => selectedSet.has(tab.normalizedUrl || normalizeComparableUrl(tab.url || '')))
        .map(tab => {
            const target = tab.normalizedUrl || normalizeComparableUrl(tab.url || '')
            const targetSummary = filterQueueAuthoritySummary(fullSummary, target)
            const violated = targetSummary.rowCount <= 0 &&
                targetSummary.rawRowCount <= 0 &&
                targetSummary.recoveredRowCount <= 0 &&
                targetSummary.viewRowCount <= 0
            return {
                tab,
                targetProfileHref: target,
                rowCount: targetSummary.rowCount,
                rawRowCount: targetSummary.rawRowCount,
                recoveredRowCount: targetSummary.recoveredRowCount,
                viewRowCount: targetSummary.viewRowCount,
                rows: targetSummary.rows,
                violated,
                classification: violated ? 'tab-open-without-authority-evidence' : ''
            }
        })
        .filter(item => item.violated)
    return {
        ok: violations.length === 0,
        violations
    }
}

function isPhase10TerminalQueueRow(row = null) {
    const status = `${row?.status || ''}`.toLowerCase()
    if(row?.terminalAt) return true
    return /^(succeeded|success|failed|skipped|canceled|cancelled|terminal)$/.test(status)
}

function getFirstSelectedNonterminalRow(selectedQueue = {}) {
    for(const item of selectedQueue?.selected || []) {
        for(const row of item.rows || []) {
            if(!isPhase10TerminalQueueRow(row)) {
                return {
                    targetProfileHref: item.targetProfileHref || row.targetProfileHref || row.requestedUrl || row.key || '',
                    key: row.key || '',
                    status: row.status || '',
                    outcome: row.outcome || '',
                    error: row.error || '',
                    tabId: row.tabId ?? null,
                    attempt: row.attempt ?? null,
                    runId: row.runId || '',
                    executorTabAction: row.executorTabAction || '',
                    updatedAt: row.updatedAt || 0,
                    createdAt: row.createdAt || 0
                }
            }
        }
    }
    return null
}

function selectedQueueFromAuthoritativeRows(sourceConsistency = null) {
    const perTarget = Array.isArray(sourceConsistency?.targets)
        ? sourceConsistency.targets
        : []
    const selected = perTarget.map(item => {
        const row = item.authoritativeCurrentRow || null
        const rows = row ? [row] : []
        return {
            targetProfileHref: item.targetProfileHref || row?.targetProfileHref || row?.requestedUrl || row?.key || '',
            rowCount: rows.length,
            rawRowCount: item.rawAuthorityRow ? 1 : 0,
            recoveredRowCount: item.recoveredAuthorityRow ? 1 : 0,
            viewRowCount: item.compactQueueViewRow ? 1 : 0,
            queuedRows: rows.filter(candidate => /queued|retry|waiting/i.test(`${candidate?.status || ''}`)).length,
            activeRows: rows.filter(candidate => /active|acting|opening|claim|running|pending/i.test(`${candidate?.status || ''}`)).length,
            terminalRows: rows.filter(isPhase10TerminalQueueRow).length,
            statuses: Array.from(new Set(rows.map(candidate => candidate?.status || 'unknown'))).sort(),
            rows
        }
    })
    return {
        source: 'authoritative-source-consistency',
        authoritativeSource: sourceConsistency?.authoritativeSource || '',
        capturedAt: sourceConsistency?.capturedAt || '',
        selectedCount: selected.length,
        rowCount: selected.reduce((total, item) => total + item.rowCount, 0),
        rawRowCount: selected.reduce((total, item) => total + item.rawRowCount, 0),
        recoveredRowCount: selected.reduce((total, item) => total + item.recoveredRowCount, 0),
        viewRowCount: selected.reduce((total, item) => total + item.viewRowCount, 0),
        queuedRows: selected.reduce((total, item) => total + item.queuedRows, 0),
        activeRows: selected.reduce((total, item) => total + item.activeRows, 0),
        terminalRows: selected.reduce((total, item) => total + item.terminalRows, 0),
        selected,
        unrelatedActiveQueuedCount: 0,
        unrelatedActiveQueued: []
    }
}

function summarizeSelectedRowDistribution(selectedQueue = {}) {
    const rows = (selectedQueue?.selected || []).flatMap(item => item.rows || [])
    return rows.reduce((counts, row) => {
        const status = `${row?.status || ''}`.toLowerCase()
        if(/hard-fail|hardfail|fatal/i.test(`${row?.outcome || ''} ${row?.error || ''}`)) counts.hardFailed += 1
        else if(/^(succeeded|success|skipped|canceled|cancelled)$/.test(status)) counts.succeeded += 1
        else if(status === 'failed') counts.softFailed += 1
        else if(/queued|retry|waiting/i.test(status)) counts.queued += 1
        else if(/active|acting|opening|claim|running|pending/i.test(status)) counts.active += 1
        else counts.other += 1
        return counts
    }, {
        succeeded: 0,
        softFailed: 0,
        hardFailed: 0,
        queued: 0,
        active: 0,
        other: 0
    })
}

function rowMatchesTarget(row = null, targetProfileHref = '') {
    const target = normalizeComparableUrl(targetProfileHref || '')
    if(!target) return false
    return [
        row?.targetProfileHref,
        row?.requestedUrl,
        row?.key,
        row?.rowKey,
        row?.targetUrl,
        row?.coordinatorKey,
        row?.profileHref,
        row?.url
    ].map(value => normalizeComparableUrl(value || '')).filter(Boolean).includes(target)
}

function getRowsForTarget(rows = [], targetProfileHref = '') {
    return (Array.isArray(rows) ? rows : []).filter(row => rowMatchesTarget(row, targetProfileHref))
}

function getSelectedSummaryRowForTarget(selectedQueue = {}, targetProfileHref = '') {
    const target = normalizeComparableUrl(targetProfileHref || '')
    const selected = (selectedQueue?.selected || []).find(item =>
        normalizeComparableUrl(item?.targetProfileHref || '') === target)
    return (selected?.rows || [])[0] || null
}

function summarizeRowSource(row = null, source = '', capturedAt = '', extra = {}) {
    if(!row) return null
    return {
        source,
        capturedAt,
        key: row.key || row.targetProfileHref || row.requestedUrl || '',
        status: row.status || '',
        outcome: row.outcome || '',
        error: row.error || '',
        targetProfileHref: row.targetProfileHref || row.requestedUrl || row.key || '',
        requestedUrl: row.requestedUrl || '',
        tabId: row.tabId ?? null,
        attemptId: getAttemptIdFromValue(row),
        attemptNumber: getAttemptNumberFromValue(row),
        runId: row.runId || '',
        updatedAt: Number.parseInt(row.updatedAt, 10) || 0,
        createdAt: Number.parseInt(row.createdAt, 10) || 0,
        terminalAt: Number.parseInt(row.terminalAt, 10) || 0,
        row,
        ...extra
    }
}

function runtimeSurfaceMatchesTarget(surface = null, targetProfileHref = '') {
    const runtime = surface?.runtime || surface || {}
    return rowMatchesTarget({
        targetProfileHref: runtime.profileHref || runtime.targetProfileHref || runtime.targetUrl || '',
        requestedUrl: runtime.requestedUrl || runtime.url || '',
        key: runtime.coordinatorKey || ''
    }, targetProfileHref)
}

function buildRuntimeSourceSummary(runtimeState = null, targetProfileHref = '') {
    const response = runtimeState?.response || {}
    return {
        capturedAt: runtimeState?.generatedAt || '',
        activeTabs: (response.activeTabs || []).filter(item => runtimeSurfaceMatchesTarget(item, targetProfileHref)),
        queuedActions: (response.queuedActions || []).filter(item => runtimeSurfaceMatchesTarget(item, targetProfileHref)),
        pendingActions: (response.pendingActions || []).filter(item => runtimeSurfaceMatchesTarget(item, targetProfileHref)),
        matchedCounts: {
            activeQueuedTabs: Number.parseInt(response.matchedActiveQueuedTabs, 10) || 0,
            queuedTabActions: Number.parseInt(response.matchedQueuedTabActions, 10) || 0,
            pendingTabActions: Number.parseInt(response.matchedPendingTabActions, 10) || 0
        }
    }
}

function buildSelectedSourceConsistencyReport(snapshot = {}) {
    const capturedAt = snapshot.generatedAt || new Date().toISOString()
    const selectedTargets = Array.isArray(snapshot.selectedTargets) ? snapshot.selectedTargets : []
    const fullQueue = snapshot.fullQueue || {}
    const executorResponse = snapshot.executorClassification?.response || snapshot.executorClassification || {}
    const lastApplyResult = executorResponse.lastApplyResult || {}
    const lastApplyCases = [
        ...(lastApplyResult.consumedExecutorCases || []).map(item => ({...item, applyDisposition: 'consumed'})),
        ...(lastApplyResult.unresolvedExecutorCases || []).map(item => ({...item, applyDisposition: 'unresolved'}))
    ]
    const currentCases = (executorResponse.cases || []).map(item => ({...item, classificationDisposition: 'current'}))
    const targetReports = selectedTargets.map(target => {
        const terminalSelectedRow = summarizeRowSource(
            getSelectedSummaryRowForTarget(snapshot.queue, target),
            'terminal-selected-summary',
            capturedAt
        )
        const recoveredAuthorityRow = summarizeRowSource(
            getRowsForTarget(fullQueue.recoveredRows, target)[0] || null,
            'recovered-wal-authority',
            capturedAt,
            {wal: fullQueue.wal || null}
        )
        const rawAuthorityRow = summarizeRowSource(
            getRowsForTarget(fullQueue.rawRows, target)[0] || null,
            'raw-local-storage-authority',
            capturedAt
        )
        const compactQueueViewRow = summarizeRowSource(
            getRowsForTarget(fullQueue.viewRows, target)[0] || null,
            'compact-queue-view',
            capturedAt
        )
        const lastApplyGenerationCases = lastApplyCases.filter(item => rowMatchesTarget(item, target))
        const currentClassificationCases = currentCases.filter(item => rowMatchesTarget(item, target))
        const authoritativeCurrentRow = recoveredAuthorityRow ||
            rawAuthorityRow ||
            terminalSelectedRow ||
            compactQueueViewRow ||
            null
        const statuses = [
            terminalSelectedRow,
            recoveredAuthorityRow,
            rawAuthorityRow,
            compactQueueViewRow,
            ...(lastApplyGenerationCases || [])
        ].filter(Boolean).map(item => `${item.source || item.applyDisposition || 'case'}:${item.status || ''}:${item.case || ''}`)
        const distinctStates = Array.from(new Set([
            terminalSelectedRow?.status ? `row-status:${terminalSelectedRow.status}` : '',
            recoveredAuthorityRow?.status ? `row-status:${recoveredAuthorityRow.status}` : '',
            rawAuthorityRow?.status ? `row-status:${rawAuthorityRow.status}` : '',
            compactQueueViewRow?.status ? `row-status:${compactQueueViewRow.status}` : '',
            ...lastApplyGenerationCases.map(item => `apply-status:${item.status || ''}:case:${item.case || ''}`)
        ].filter(Boolean)))
        return {
            targetProfileHref: normalizeComparableUrl(target || ''),
            capturedAt,
            authoritativeSource: authoritativeCurrentRow?.source || '',
            authoritativeCurrentRow,
            terminalSelectedRow,
            recoveredAuthorityRow,
            rawAuthorityRow,
            compactQueueViewRow,
            residentAuthorityRow: null,
            residentAuthoritySource: 'not-exposed',
            currentClassificationCases,
            lastApplyGeneration: {
                executorClassificationId: lastApplyResult.executorClassificationId || '',
                classificationGeneratedAt: lastApplyResult.classificationGeneratedAt || 0,
                reason: lastApplyResult.reason || '',
                changed: lastApplyResult.changed === true,
                cases: lastApplyGenerationCases
            },
            runtime: buildRuntimeSourceSummary(snapshot.runtimeState, target),
            visibleTabs: {
                selectedProfileTabs: (snapshot.visibleTabs?.selectedProfileTabs || [])
                    .filter(tab => normalizeComparableUrl(tab?.url || tab?.normalizedUrl || '') === normalizeComparableUrl(target || ''))
            },
            sourceStates: statuses,
            sourceDisagreement: distinctStates.length > 1,
            distinctStates
        }
    })
    const firstAuthoritativeNonterminalTarget = targetReports.find(item =>
        item.authoritativeCurrentRow && !isPhase10TerminalQueueRow(item.authoritativeCurrentRow.row || item.authoritativeCurrentRow)
    ) || null
    const report = {
        capturedAt,
        authoritativeSource: fullQueue.recovered === true
            ? 'recovered-wal-authority'
            : fullQueue.rawRowCount > 0
            ? 'raw-local-storage-authority'
            : 'terminal-selected-summary',
        recoveredAuthorityAvailable: fullQueue.recovered === true,
        wal: fullQueue.wal || null,
        targets: targetReports,
        firstAuthoritativeNonterminalRow: firstAuthoritativeNonterminalTarget?.authoritativeCurrentRow || null,
        firstAuthoritativeNonterminalTarget: firstAuthoritativeNonterminalTarget?.targetProfileHref || ''
    }
    report.authoritativeSelectedQueueSummary = selectedQueueFromAuthoritativeRows(report)
    return report
}

function buildPhase10ArtifactReport(snapshot = {}) {
    const sourceConsistency = snapshot.sourceConsistency || buildSelectedSourceConsistencyReport(snapshot)
    const authoritativeQueue = sourceConsistency.authoritativeSelectedQueueSummary || null
    const queue = authoritativeQueue || snapshot.queue || {}
    const selectedRowDistribution = summarizeSelectedRowDistribution(queue)
    const primaryReducerCase = snapshot.executorClassification?.response?.primaryUnresolvedCase?.case ||
        snapshot.executorClassification?.primaryUnresolvedCase?.case ||
        snapshot.executorClassification?.response?.reason ||
        ''
    const firstSelectedNonterminalRow = sourceConsistency.firstAuthoritativeNonterminalRow ||
        getFirstSelectedNonterminalRow(queue)
    const runtimeResponse = snapshot.runtimeState?.response || {}
    const runtimeCounts = {
        matchedActiveQueuedTabs: Number.parseInt(runtimeResponse.matchedActiveQueuedTabs, 10) || 0,
        matchedQueuedTabActions: Number.parseInt(runtimeResponse.matchedQueuedTabActions, 10) || 0,
        matchedPendingTabActions: Number.parseInt(runtimeResponse.matchedPendingTabActions, 10) || 0
    }
    const flightEntries = Array.isArray(snapshot.flightRecorder?.response?.entries)
        ? snapshot.flightRecorder.response.entries
        : []
    const drainPass = Number(queue.queuedRows || 0) === 0 &&
        Number(queue.activeRows || 0) === 0 &&
        runtimeCounts.matchedActiveQueuedTabs === 0 &&
        runtimeCounts.matchedQueuedTabActions === 0 &&
        runtimeCounts.matchedPendingTabActions === 0
    const qualityPass = drainPass &&
        Number(selectedRowDistribution.softFailed || 0) === 0 &&
        Number(selectedRowDistribution.hardFailed || 0) === 0 &&
        Number(selectedRowDistribution.other || 0) === 0
    return {
        loadedExtensionVersion: snapshot.loadedExtensionVersion || '',
        drainPass,
        qualityPass,
        selectedRowDistribution,
        selectedCounts: selectedRowDistribution,
        queuedRows: Number(queue.queuedRows || 0) || 0,
        activeRows: Number(queue.activeRows || 0) || 0,
        terminalRows: Number(queue.terminalRows || 0) || 0,
        runtimeCounts,
        primaryReducerCase,
        primaryUnresolvedCase: snapshot.executorClassification?.response?.primaryUnresolvedCase || null,
        firstSelectedNonterminalRow,
        authoritativeCurrentRowState: firstSelectedNonterminalRow,
        sourceConsistency,
        selectedTargets: snapshot.selectedTargets || [],
        currentSelectedQueueSummary: queue,
        terminalSelectedQueueSummary: snapshot.queue || null,
        recoveredAuthoritySummary: snapshot.fullQueue || null,
        runtimeState: snapshot.runtimeState || null,
        executorClassification: snapshot.executorClassification || null,
        flightRecorderTail: {
            ok: snapshot.flightRecorder?.ok === true,
            timedOut: snapshot.flightRecorder?.timedOut === true,
            lastError: snapshot.flightRecorder?.lastError || '',
            newestSeq: snapshot.flightRecorder?.response?.newestSeq || null,
            entries: flightEntries.slice(-100)
        },
        visibleTabs: snapshot.visibleTabs || null
    }
}

function runPhase10WatchdogSelfTest() {
    const snapshot = {
        loadedExtensionVersion: 'self-test',
        selectedTargets: ['https://www.quora.com/profile/example'],
        queue: {
            selectedCount: 1,
            rowCount: 1,
            queuedRows: 0,
            activeRows: 1,
            terminalRows: 0,
            selected: [{
                targetProfileHref: 'https://www.quora.com/profile/example',
                rows: [{
                    key: 'https://www.quora.com/profile/example',
                    status: 'active',
                    tabId: 123,
                    attempt: 1,
                    runId: 'self-test-run',
                    executorTabAction: 'nuke'
                }]
            }]
        },
        fullQueue: {
            recovered: true,
            rowCount: 1,
            recoveredRows: [{
                key: 'https://www.quora.com/profile/example',
                status: 'queued',
                tabId: null,
                attemptId: 'attempt-self-test-recovered',
                attemptNumber: 2,
                updatedAt: 2000,
                runId: 'self-test-run'
            }],
            rawRows: [],
            viewRows: [{
                key: 'https://www.quora.com/profile/example',
                status: 'active',
                tabId: 123,
                updatedAt: 1000,
                runId: 'self-test-run'
            }],
            wal: {
                nextSeq: 2
            }
        },
        runtimeState: {
            ok: true,
            response: {
                matchedActiveQueuedTabs: 0,
                matchedQueuedTabActions: 0,
                matchedPendingTabActions: 0
            }
        },
        executorClassification: {
            ok: true,
            response: {
                cases: [{
                    case: 'active-missing-tab',
                    rowKey: 'https://www.quora.com/profile/example',
                    status: 'active',
                    tabId: 123,
                    attemptId: 'attempt-self-test-terminal',
                    attemptNumber: 1
                }],
                primaryUnresolvedCase: {
                    case: 'active-missing-tab'
                }
            }
        },
        flightRecorder: {
            ok: true,
            response: {
                newestSeq: 2,
                entries: [{seq: 1}, {seq: 2}]
            }
        },
        visibleTabs: {
            profileTabs: [],
            selectedProfileTabs: [],
            extensionPages: [],
            quoraPages: []
        }
    }
    snapshot.watchdogReport = buildPhase10ArtifactReport(snapshot)
    const report = snapshot.watchdogReport
    const required = [
        'loadedExtensionVersion',
        'drainPass',
        'qualityPass',
        'selectedRowDistribution',
        'selectedTargets',
        'currentSelectedQueueSummary',
        'recoveredAuthoritySummary',
        'runtimeState',
        'executorClassification',
        'primaryReducerCase',
        'firstSelectedNonterminalRow',
        'flightRecorderTail',
        'visibleTabs'
    ]
    const missing = required.filter(key => !(key in report))
    if(missing.length) throw new Error(`phase10 watchdog self-test missing fields: ${missing.join(', ')}`)
    if(report.primaryReducerCase !== 'active-missing-tab') {
        throw new Error(`phase10 watchdog self-test primary reducer mismatch: ${report.primaryReducerCase}`)
    }
    if(report.firstSelectedNonterminalRow?.status !== 'queued' ||
        report.firstSelectedNonterminalRow?.source !== 'recovered-wal-authority') {
        throw new Error('phase10 watchdog self-test did not use recovered authority for first selected nonterminal row')
    }
    if(report.sourceConsistency?.targets?.[0]?.sourceDisagreement !== true) {
        throw new Error('phase10 watchdog self-test did not retain source disagreement evidence')
    }
    if(report.sourceConsistency?.targets?.[0]?.currentClassificationCases?.[0]?.case !== 'active-missing-tab') {
        throw new Error('phase10 watchdog self-test did not attach current classification case by rowKey')
    }
    return {
        ok: true,
        report
    }
}

async function readLoadedExtensionManifest(context) {
    try {
        const result = await evaluate(context.webSocketDebuggerUrl, `(() => {
            const manifest = chrome.runtime.getManifest()
            return {
                id: chrome.runtime.id || '',
                name: manifest.name || '',
                version: manifest.version || ''
            }
        })()`, 5000)
        return {
            ok: true,
            ...result
        }
    }
    catch(error) {
        return {
            ok: false,
            id: '',
            name: '',
            version: '',
            error: error.message
        }
    }
}

async function buildPhase10DiagnosticSnapshot(config, context, options, state = {}, reason = 'diagnostic', details = null) {
    const selectedTargets = Array.isArray(state.selectedTargets) ? state.selectedTargets : []
    const generatedAt = new Date().toISOString()
    let storage = null
    let fullQueue = null
    let selectedQueue = null
    let authority = null
    let runtimeState = null
    let executorClassification = null
    let flightRecorder = null
    let visibleTabs = null
    let tabAuthorityInvariant = null
    let selectedProgressRecords = null
    let loadedExtension = null
    let snapshotError = null
    try {
        storage = await readStorage(context)
        fullQueue = summarizeQueueAuthority(storage, {preferRecovered: true})
        selectedQueue = summarizeSelectedQueueAuthority(fullQueue, selectedTargets)
        authority = summarizeAuthorityState(storage)
        runtimeState = await readQueueRuntimeState(context, selectedTargets)
        executorClassification = await readExecutorClassification(context)
        flightRecorder = await readFlightRecorder(context, {limit: PHASE10_FLIGHT_RECORDER_LIMIT})
        visibleTabs = await readVisibleTargetTabs(config, selectedTargets)
        tabAuthorityInvariant = buildTabAuthorityInvariant(visibleTabs, fullQueue, selectedTargets)
        selectedProgressRecords = getSelectedProgressRecords(storage, selectedTargets, selectedQueue)
        loadedExtension = await readLoadedExtensionManifest(context)
    }
    catch(error) {
        snapshotError = {
            message: error.message,
            stack: error.stack
        }
    }
    return {
        kind: 'phase10-diagnostic-snapshot',
        reason,
        details,
        generatedAt,
        phase: options.phase,
        profileLabel: options.profileLabel,
        currentStep: state.currentStep || '',
        selectedTargets,
        queueClicks: state.queueClicks || [],
        incrementalEnqueue: state.incrementalEnqueue || [],
        storageKeys: storage?.keys || [],
        queue: selectedQueue,
        fullQueue,
        authority,
        walEvidence: summarizeWalEvidence(storage),
        runtimeState,
        executorClassification,
        selectedProgressRecords,
        flightRecorder,
        visibleTabs,
        tabAuthorityInvariant,
        loadedExtension,
        loadedExtensionVersion: loadedExtension?.version || '',
        sourceConsistency: buildSelectedSourceConsistencyReport({
            generatedAt,
            selectedTargets,
            queue: selectedQueue,
            fullQueue,
            runtimeState,
            executorClassification,
            visibleTabs
        }),
        watchdogReport: null,
        snapshotError
    }
}

async function writePhase10DiagnosticArtifact(config, context, options, state, reason, details = null) {
    const snapshot = await buildPhase10DiagnosticSnapshot(config, context, options, state, reason, details)
    snapshot.watchdogReport = buildPhase10ArtifactReport(snapshot)
    const artifactPath = getDiagnosticArtifactPath(options, reason)
    writeJson(artifactPath, snapshot)
    return {
        artifactPath,
        snapshot
    }
}

function assertOneItemQueueAuthorityConsistent(summary = {}, fail, label = 'queue authority') {
    if(summary.rowCount !== 1) {
        fail(`${label} expected exactly one durable queue row`, {
            rowCount: summary.rowCount,
            rows: summary.rows
        })
    }
    if(summary.viewRowCount !== 1) {
        fail(`${label} expected exactly one compact queue view row`, {
            viewRowCount: summary.viewRowCount,
            viewRows: summary.viewRows
        })
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
        fullLegacyProgressPresent: Object.prototype.hasOwnProperty.call(data, LEGACY_FULL_PROGRESS_KEY)
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
    if(after.work.rawQueueRows !== before.work.rawQueueRows) {
        changed('coordinator queue rows', {before: before.work.rawQueueRows, after: after.work.rawQueueRows})
    }
    if(after.work.viewRows !== before.work.viewRows) {
        changed('coordinator queue view rows', {before: before.work.viewRows, after: after.work.viewRows})
    }
    if(after.walSignature !== before.walSignature) {
        changed('coordinator queue WAL changes', {
            beforeKeys: before.walKeys,
            afterKeys: after.walKeys
        })
    }
    if(after.progressViewRecords !== before.progressViewRecords) {
        changed('profile progress view records', {
            before: before.progressViewRecords,
            after: after.progressViewRecords
        })
    }
    if(after.progressShardRecords !== before.progressShardRecords) {
        changed('profile progress shard records', {
            before: before.progressShardRecords,
            after: after.progressShardRecords
        })
    }
    if(after.pendingSpacePostRecords !== before.pendingSpacePostRecords) {
        changed('pending space post records', {
            before: before.pendingSpacePostRecords,
            after: after.pendingSpacePostRecords
        })
    }
    if(after.nukedSpacePostRecords !== before.nukedSpacePostRecords) {
        changed('nuked space post records', {
            before: before.nukedSpacePostRecords,
            after: after.nukedSpacePostRecords
        })
    }
    if(after.queuedActionSurfaceRecords !== before.queuedActionSurfaceRecords) {
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
        storageKeySummary: report.storageKeySummary,
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
        ...(report.contentRefreshSmoke
            ? {contentRefreshSmoke: comparableContentRefreshSmoke(report.contentRefreshSmoke)}
            : {}),
        ...(report.discoveryReloadSmoke
            ? {discoveryReloadSmoke: comparableDiscoveryReloadSmoke(report.discoveryReloadSmoke)}
            : {}),
        ...(report.oneItemQueueSmoke
            ? {oneItemQueueSmoke: comparableOneItemQueueSmoke(report.oneItemQueueSmoke)}
            : {}),
        ...(report.smallBatchQueueSmoke
            ? {smallBatchQueueSmoke: comparableSmallBatchQueueSmoke(report.smallBatchQueueSmoke)}
            : {}),
        ...(report.mediumBatchQueueSmoke
            ? {mediumBatchQueueSmoke: comparableSmallBatchQueueSmoke(report.mediumBatchQueueSmoke)}
            : {}),
        workStateAfter: report.workStateAfter
    }
}


function consoleReport(report, comparable = comparableReport(report)) {
    return {
        pass: report.pass === true,
        phase: report.phase,
        profileLabel: report.profileLabel,
        generatedAt: report.generatedAt || "",
        reportArtifactPath: report.reportArtifactPath || "",
        extension: comparable.extension,
        storageKeySummary: comparable.storageKeySummary,
        storageKeyDelta: comparable.storageKeyDelta,
        alarms: comparable.alarms,
        failures: (report.failures || []).map(failure => ({
            message: failure?.message || String(failure || ""),
            diagnosticArtifactPath: failure?.details?.diagnosticArtifactPath || failure?.diagnosticArtifactPath || "",
            reason: failure?.details?.reason || failure?.reason || "",
            requested: failure?.details?.requested || undefined,
            selectedCount: Array.isArray(failure?.details?.selectedTargets)
                ? failure.details.selectedTargets.length
                : undefined
        })),
        warnings: (report.warnings || []).slice(0, 20),
        ...(comparable.oneItemQueueSmoke ? {oneItemQueueSmoke: comparable.oneItemQueueSmoke} : {}),
        ...(comparable.smallBatchQueueSmoke ? {smallBatchQueueSmoke: comparable.smallBatchQueueSmoke} : {}),
        ...(comparable.mediumBatchQueueSmoke ? {mediumBatchQueueSmoke: comparable.mediumBatchQueueSmoke} : {}),
        workStateAfter: comparable.workStateAfter
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

function comparableContentRefreshSmoke(contentRefreshSmoke = null) {
    if(!contentRefreshSmoke) return null
    const final = contentRefreshSmoke.final || {}
    const page = final.page || {}
    const coordinatorState = final.coordinatorState || {}
    return {
        kind: contentRefreshSmoke.kind || '',
        url: normalizeComparableUrl(page.url || ''),
        reloaded: contentRefreshSmoke.reloaded === true,
        reinjected: contentRefreshSmoke.reinjected === true,
        reinjectionMatched: Number(contentRefreshSmoke.reinjection?.matched || 0) || 0,
        reinjectionInjected: Number(contentRefreshSmoke.reinjection?.injected || 0) || 0,
        contentReadyPresent: !!page.contentReady,
        pageType: page.pageType || '',
        scoped: coordinatorState.scoped === true,
        queueRows: Number(coordinatorState.queueRows || 0) || 0,
        progressRows: Number(coordinatorState.progressRows || 0) || 0,
        responseKeys: Array.isArray(coordinatorState.responseKeys)
            ? coordinatorState.responseKeys.slice().sort()
            : []
    }
}

function comparableDiscoveryReloadSmoke(discoveryReloadSmoke = null) {
    if(!discoveryReloadSmoke) return null
    const summarizePage = page => ({
        kind: page.kind || '',
        expectedCategory: page.expectedCategory || '',
        beforeUrl: normalizeComparableUrl(page.before?.page?.url || ''),
        afterUrl: normalizeComparableUrl(page.afterReload?.page?.url || ''),
        beforePageType: page.before?.page?.pageType || '',
        afterPageType: page.afterReload?.page?.pageType || '',
        beforeCandidateCount: Number(page.before?.page?.discoveryCandidateCount || 0) || 0,
        afterCandidateCount: Number(page.afterReload?.page?.discoveryCandidateCount || 0) || 0,
        beforeSearchRows: Number(page.before?.page?.profileSearchRowCount || 0) || 0,
        afterSearchRows: Number(page.afterReload?.page?.profileSearchRowCount || 0) || 0,
        beforeSearchButtons: Number(page.before?.page?.profileSearchButtonCount || 0) || 0,
        afterSearchButtons: Number(page.afterReload?.page?.profileSearchButtonCount || 0) || 0,
        beforeSpaceCategory: page.before?.page?.spaceCategory || '',
        afterSpaceCategory: page.afterReload?.page?.spaceCategory || '',
        afterScoped: page.afterReload?.coordinatorState?.scoped === true,
        afterQueueRows: Number(page.afterReload?.coordinatorState?.queueRows || 0) || 0,
        afterProgressRows: Number(page.afterReload?.coordinatorState?.progressRows || 0) || 0
    })
    return {
        kind: discoveryReloadSmoke.kind || '',
        classifiedCount: Number(discoveryReloadSmoke.classified?.updated || 0) || 0,
        search: summarizePage(discoveryReloadSmoke.search || {}),
        spaces: (discoveryReloadSmoke.spaces || []).map(summarizePage)
    }
}

function comparableOneItemQueueSmoke(oneItemQueueSmoke = null) {
    if(!oneItemQueueSmoke) return null
    const summarizeQueue = queue => ({
        rowCount: Number(queue?.rowCount || 0) || 0,
        viewRowCount: Number(queue?.viewRowCount || 0) || 0,
        queuedRows: Number(queue?.queuedRows || 0) || 0,
        activeRows: Number(queue?.activeRows || 0) || 0,
        terminalRows: Number(queue?.terminalRows || 0) || 0,
        statuses: Object.keys(queue?.statusCounts || {}).sort()
    })
    const summarizeAuthority = authority => ({
        walKeys: (authority?.walKeys || []).slice().sort(),
        progressViewRecords: Number(authority?.progressViewRecords || 0) || 0,
        progressShardRecords: Number(authority?.progressShardRecords || 0) || 0,
        queuedActionSurfaceRecords: Number(authority?.queuedActionSurfaceRecords || 0) || 0
    })
    return {
        kind: oneItemQueueSmoke.kind || '',
        targetProfileHrefPresent: !!oneItemQueueSmoke.targetProfileHref,
        queueClickClicked: oneItemQueueSmoke.queueClick?.clicked === true,
        afterEnqueue: {
            queue: summarizeQueue(oneItemQueueSmoke.afterEnqueue?.queue),
            authority: summarizeAuthority(oneItemQueueSmoke.afterEnqueue?.authority)
        },
        afterRestartBeforeStart: {
            queue: summarizeQueue(oneItemQueueSmoke.afterRestartBeforeStart?.queue),
            authority: summarizeAuthority(oneItemQueueSmoke.afterRestartBeforeStart?.authority)
        },
        start: {
            ok: oneItemQueueSmoke.start?.ok === true,
            reason: oneItemQueueSmoke.start?.reason || '',
            active: Number(oneItemQueueSmoke.start?.active || 0) || 0,
            queued: Number(oneItemQueueSmoke.start?.queued || 0) || 0
        },
        terminal: {
            timedOut: oneItemQueueSmoke.terminal?.timedOut === true,
            queue: summarizeQueue(oneItemQueueSmoke.terminal?.queue),
            authority: summarizeAuthority(oneItemQueueSmoke.terminal?.authority)
        },
        afterRestartAfterTerminal: {
            queue: summarizeQueue(oneItemQueueSmoke.afterRestartAfterTerminal?.queue),
            authority: summarizeAuthority(oneItemQueueSmoke.afterRestartAfterTerminal?.authority)
        }
    }
}

function comparableSmallBatchQueueSmoke(smallBatchQueueSmoke = null) {
    if(!smallBatchQueueSmoke) return null
    const summarizeQueue = queue => ({
        selectedCount: Number(queue?.selectedCount || 0) || 0,
        rowCount: Number(queue?.rowCount || 0) || 0,
        viewRowCount: Number(queue?.viewRowCount || 0) || 0,
        queuedRows: Number(queue?.queuedRows || 0) || 0,
        activeRows: Number(queue?.activeRows || 0) || 0,
        terminalRows: Number(queue?.terminalRows || 0) || 0,
        unrelatedActiveQueuedCount: Number(queue?.unrelatedActiveQueuedCount || 0) || 0,
        selectedStatuses: (queue?.selected || []).map(item => item.statuses || []).flat().sort()
    })
    const summarizeAuthority = authority => ({
        walKeys: (authority?.walKeys || []).slice().sort(),
        progressViewRecords: Number(authority?.progressViewRecords || 0) || 0,
        progressShardRecords: Number(authority?.progressShardRecords || 0) || 0,
        queuedActionSurfaceRecords: Number(authority?.queuedActionSurfaceRecords || 0) || 0
    })
    return {
        kind: smallBatchQueueSmoke.kind || '',
        selectedCount: Number(smallBatchQueueSmoke.selectedTargets?.length || 0) || 0,
        queueClicksClicked: (smallBatchQueueSmoke.queueClicks || []).filter(click => click.clicked === true).length,
        lowConcurrencyPreference: {
            requestedValue: Number(smallBatchQueueSmoke.lowConcurrencyPreference?.requestedValue || 0) || 0,
            setOk: smallBatchQueueSmoke.lowConcurrencyPreference?.set?.ok === true,
            restoredOk: smallBatchQueueSmoke.lowConcurrencyPreference?.restored?.ok === true
        },
        afterEnqueue: {
            queue: summarizeQueue(smallBatchQueueSmoke.afterEnqueue?.queue),
            authority: summarizeAuthority(smallBatchQueueSmoke.afterEnqueue?.authority)
        },
        afterRestartBeforeStart: {
            queue: summarizeQueue(smallBatchQueueSmoke.afterRestartBeforeStart?.queue),
            authority: summarizeAuthority(smallBatchQueueSmoke.afterRestartBeforeStart?.authority)
        },
        start: {
            ok: smallBatchQueueSmoke.start?.ok === true,
            reason: smallBatchQueueSmoke.start?.reason || '',
            active: Number(smallBatchQueueSmoke.start?.active || 0) || 0,
            queued: Number(smallBatchQueueSmoke.start?.queued || 0) || 0
        },
        terminal: {
            timedOut: smallBatchQueueSmoke.terminal?.timedOut === true,
            queue: summarizeQueue(smallBatchQueueSmoke.terminal?.queue),
            authority: summarizeAuthority(smallBatchQueueSmoke.terminal?.authority)
        },
        afterRestartAfterTerminal: {
            queue: summarizeQueue(smallBatchQueueSmoke.afterRestartAfterTerminal?.queue),
            authority: summarizeAuthority(smallBatchQueueSmoke.afterRestartAfterTerminal?.authority)
        },
        idleFlightRecorder: {
            ok: smallBatchQueueSmoke.idleFlightRecorder?.ok === true,
            entryCount: Number(smallBatchQueueSmoke.idleFlightRecorder?.entryCount || 0) || 0,
            noisyEntryCount: Number(smallBatchQueueSmoke.idleFlightRecorder?.noisyEntryCount || 0) || 0
        }
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

async function findOrOpenQuoraPage(config, quoraUrl, warnings, reason = 'content smoke') {
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
    warnings.push(`opened Quora URL for ${reason}: ${quoraUrl}`)
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


function getWebSocketState(ws) {
    if(!ws) return -1
    if(typeof ws.readyState === 'number') return ws.readyState
    return -1
}

function safeCloseWebSocket(ws, reason = 'cleanup') {
    if(!ws) return false
    try {
        const noop = () => {}
        if(typeof ws.addEventListener === 'function') {
            ws.addEventListener('error', noop)
            ws.addEventListener('close', noop)
        }
        else if(typeof ws.on === 'function') {
            ws.on('error', noop)
            ws.on('close', noop)
        }
    }
    catch {}

    const state = getWebSocketState(ws)
    const openState = typeof WebSocket !== 'undefined' ? WebSocket.OPEN : 1
    const closingState = typeof WebSocket !== 'undefined' ? WebSocket.CLOSING : 2
    if(state !== openState && state !== closingState) return false

    try {
        ws.close(1000, `${reason || 'cleanup'}`.slice(0, 120))
        return true
    }
    catch {
        return false
    }
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
            let settled = false
            const finishReject = error => {
                if(settled) return
                settled = true
                clearTimeout(timeout)
                reject(error)
            }
            const timeout = setTimeout(() => {
                finishReject(new Error(`WebSocket timeout opening ${target.webSocketDebuggerUrl}`))
                safeCloseWebSocket(ws, 'isolated-world-connect-timeout')
            }, 5000)
            ws.addEventListener('open', () => {
                if(settled) {
                    safeCloseWebSocket(ws, 'isolated-world-late-open-after-timeout')
                    return
                }
                settled = true
                clearTimeout(timeout)
                resolve()
            }, {once: true})
            ws.addEventListener('error', event => {
                finishReject(event.error || new Error(`WebSocket error for ${target.webSocketDebuggerUrl}`))
            }, {once: true})
            ws.addEventListener('close', () => {
                finishReject(new Error(`WebSocket closed before opening ${target.webSocketDebuggerUrl}`))
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
        safeCloseWebSocket(ws, 'isolated-world-cleanup')
    }
}

async function inspectQuoraPage(target) {
    return evaluate(target.webSocketDebuggerUrl, `(${function inspectPage() {
        const attr = document.documentElement?.getAttribute('data-mb-content-script-ready') || ''
        const bodyText = `${document.body?.innerText || ''}`.replace(/\s+/g, ' ').slice(0, 5000)
        const quoraLoginLikely = /log in|sign in|continue with google|continue with facebook/i.test(bodyText) &&
            /email|password|log in|sign in/i.test(bodyText)
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
            quoraLoginLikely,
            mbControlLabels: mbControls.map(node => `${node.innerText || node.textContent || node.getAttribute('aria-label') || ''}`.replace(/\s+/g, ' ').trim()).filter(Boolean).slice(0, 20)
        }
    }})()`, 15000)
}

async function inspectDiscoveryPage(target) {
    return evaluate(target.webSocketDebuggerUrl, `(${function inspectPage() {
        const bodyText = `${document.body?.innerText || ''}`.replace(/\s+/g, ' ').slice(0, 5000)
        const quoraLoginLikely = /log in|sign in|continue with google|continue with facebook/i.test(bodyText) &&
            /email|password|log in|sign in/i.test(bodyText)
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
        const profileLinkAncestors = Array.from(document.querySelectorAll('a[href]'))
            .map(anchor => {
                const href = normalizeProfileHref(anchor.getAttribute('href') || anchor.href || '')
                if(!href) return null
                let node = anchor
                const ancestors = []
                for(let depth = 0; node && depth < 5; depth += 1, node = node.parentElement) {
                    const rect = node.getBoundingClientRect()
                    ancestors.push({
                        tag: node.tagName,
                        role: node.getAttribute('role') || '',
                        ariaLabel: node.getAttribute('aria-label') || '',
                        className: `${node.className || ''}`.slice(0, 160),
                        dataMbProfileSearchHref: node.getAttribute('data-mb-profile-search-href') || '',
                        text: `${node.innerText || node.textContent || ''}`.replace(/\s+/g, ' ').trim().slice(0, 240),
                        rect: {
                            x: Math.round(rect.x),
                            y: Math.round(rect.y),
                            width: Math.round(rect.width),
                            height: Math.round(rect.height)
                        }
                    })
                }
                const rect = anchor.getBoundingClientRect()
                return {
                    href,
                    text: `${anchor.innerText || anchor.textContent || ''}`.replace(/\s+/g, ' ').trim().slice(0, 160),
                    rect: {
                        x: Math.round(rect.x),
                        y: Math.round(rect.y),
                        width: Math.round(rect.width),
                        height: Math.round(rect.height)
                    },
                    ancestors
                }
            })
            .filter(Boolean)
            .slice(0, 12)
        const visibleButtons = Array.from(document.querySelectorAll('button,[role="button"]'))
            .map(button => {
                const rect = button.getBoundingClientRect()
                const style = getComputedStyle(button)
                return {
                    tag: button.tagName,
                    role: button.getAttribute('role') || '',
                    ariaLabel: button.getAttribute('aria-label') || '',
                    disabled: button.disabled === true || button.getAttribute('aria-disabled') === 'true',
                    className: `${button.className || ''}`.slice(0, 160),
                    text: `${button.innerText || button.textContent || ''}`.replace(/\s+/g, ' ').trim().slice(0, 160),
                    visible: rect.width > 0 && rect.height > 0 && style.visibility !== 'hidden' && style.display !== 'none',
                    rect: {
                        x: Math.round(rect.x),
                        y: Math.round(rect.y),
                        width: Math.round(rect.width),
                        height: Math.round(rect.height)
                    }
                }
            })
            .filter(button => button.visible)
            .slice(0, 40)
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
            quoraLoginLikely,
            searchQuery: new URLSearchParams(location.search).get('q') || '',
            profileHrefCount: profileHrefs.length,
            profileHrefs,
            profileLinkAncestors,
            visibleButtons,
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
    })})`, 60000)
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
            quoraLoginLikely: pageState.quoraLoginLikely,
            profileHrefCount: pageState.profileHrefCount,
            mbControlCount: pageState.mbControlCount,
            mbControlLabels: pageState.mbControlLabels
        },
        coordinatorState: contentState
    }
}

function contentStateIsUsable(pageState = {}, contentState = {}) {
    return !!pageState.contentReady &&
        contentState.ok === true &&
        contentState.scoped === true &&
        Number(contentState.queueRows || 0) === 0 &&
        Number(contentState.progressRows || 0) === 0
}

async function injectContentScriptForPage(context, pageUrl) {
    return evaluate(context.webSocketDebuggerUrl, `(${async function injectContentScript(url) {
        const normalize = value => {
            try {
                const parsed = new URL(value || '')
                parsed.hash = ''
                if(parsed.pathname !== '/') parsed.pathname = parsed.pathname.replace(/\/+$/, '') || '/'
                return parsed.href
            }
            catch {
                return `${value || ''}`
            }
        }

        const tabs = await chrome.tabs.query({})
        const targetUrl = normalize(url)
        const candidates = tabs.filter(tab => normalize(tab.url || '') === targetUrl)
        const results = []

        for(const tab of candidates) {
            try {
                await chrome.scripting.insertCSS({
                    target: {tabId: tab.id},
                    files: ['css/content.css']
                }).catch(error => ({
                    ignored: true,
                    error: error?.message || `${error || ''}`
                }))
                await chrome.scripting.executeScript({
                    target: {tabId: tab.id},
                    files: ['js/content.js']
                })
                results.push({
                    tabId: tab.id,
                    url: tab.url || '',
                    injected: true
                })
            }
            catch(error) {
                results.push({
                    tabId: tab.id,
                    url: tab.url || '',
                    injected: false,
                    error: error?.message || `${error || ''}`
                })
            }
        }

        return {
            targetUrl,
            matched: candidates.length,
            injected: results.filter(result => result.injected).length,
            results
        }
    }})( ${JSON.stringify(pageUrl)} )`, 20000)
}

async function inspectContentWithState(target, options) {
    const pageState = await inspectQuoraPage(target)
    const contentStateResult = await sendContentPageCoordinatorState(target, options.extensionId, pageState)
    return {
        pageState,
        contentState: summarizeContentStateResult(contentStateResult)
    }
}

async function runStaleContentRefreshSmoke(config, options, context, warnings, fail) {
    const quoraUrl = options.quoraUrl || DEFAULT_BENIGN_QUORA_URL
    const quoraPage = await findOrOpenQuoraPage(config, quoraUrl, warnings, 'phase 6 stale-content refresh/reinject smoke')
    const before = await inspectContentWithState(quoraPage, options)

    await reloadPageTarget(quoraPage)
    let afterRefresh = await inspectContentWithState(quoraPage, options)
    for(let attempt = 0; attempt < 5 && !contentStateIsUsable(afterRefresh.pageState, afterRefresh.contentState); attempt += 1) {
        await sleep(500)
        afterRefresh = await inspectContentWithState(quoraPage, options)
    }

    let reinjection = null
    let final = afterRefresh
    if(!contentStateIsUsable(afterRefresh.pageState, afterRefresh.contentState)) {
        reinjection = await injectContentScriptForPage(context, afterRefresh.pageState.url || quoraPage.url || quoraUrl)
        await sleep(1500)
        final = await inspectContentWithState(quoraPage, options)
    }

    if(!final.pageState.contentReady) {
        fail('stale-content smoke did not find content script ready marker after refresh/reinject', {
            url: final.pageState.url,
            readyState: final.pageState.readyState,
            title: final.pageState.title,
            reinjection
        })
    }
    if(!final.contentState.ok) {
        fail('stale-content smoke did not get current scoped state after refresh/reinject', final.contentState)
    }
    else {
        if(final.contentState.scoped !== true) fail('stale-content current state is not scoped', final.contentState)
        if(final.contentState.queueRows !== 0) fail('stale-content current state exposed queue rows', final.contentState)
        if(final.contentState.progressRows !== 0) fail('stale-content current state exposed profile progress rows', final.contentState)
    }
    if(reinjection && reinjection.injected <= 0) {
        fail('stale-content reinjection did not inject content script into the Quora tab', reinjection)
    }

    return {
        kind: PHASE6_STALE_CONTENT_REFRESH,
        target: {
            id: quoraPage.id,
            type: quoraPage.type || '',
            url: quoraPage.url || ''
        },
        reloaded: true,
        reinjected: !!reinjection,
        reinjection,
        before: {
            page: before.pageState,
            coordinatorState: before.contentState
        },
        afterRefresh: {
            page: afterRefresh.pageState,
            coordinatorState: afterRefresh.contentState
        },
        final: {
            page: final.pageState,
            coordinatorState: final.contentState
        }
    }
}

async function inspectDiscoveryWithState(target, options, expectedPageType, fail, requireCandidates = true, stateOptions = {}) {
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
        if(contentState.queueRows !== 0 && stateOptions.allowQueueRows !== true) {
            fail('discovery content state exposed queue rows', contentState)
        }
        if(contentState.progressRows !== 0 && stateOptions.allowProgressRows !== true) {
            fail('discovery content state exposed profile progress rows', contentState)
        }
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

function getPhase10SearchCandidateUrls(options = {}) {
    return dedupeStrings([
        options.searchUrl || DEFAULT_SEARCH_URL,
        ...PHASE10_SEARCH_FALLBACK_URLS
    ].filter(Boolean))
}

function withTimeoutValue(promise, timeoutMs, timeoutValue) {
    const boundedTimeoutMs = Math.max(1, Number.parseInt(timeoutMs, 10) || 1)
    return new Promise(resolve => {
        let settled = false
        const timer = setTimeout(() => {
            if(settled) return
            settled = true
            resolve(typeof timeoutValue === 'function' ? timeoutValue() : timeoutValue)
        }, boundedTimeoutMs)
        Promise.resolve(promise).then(value => {
            if(settled) return
            settled = true
            clearTimeout(timer)
            resolve(value)
        }, error => {
            if(settled) return
            settled = true
            clearTimeout(timer)
            resolve({timedOut: false, error: error?.message || `${error || ''}`})
        })
    })
}

async function inspectSearchTargetForQueueCandidates(config, options, url, warnings, phaseLabel, fail, existingQueueTargets, targetCount, attemptIndex = 0) {
    const selectionRemainingMs = Number.parseInt(options.phase10TargetSelectionRemainingMs, 10) || 45000
    const target = await findOrOpenPage(config, url, warnings, `${phaseLabel} profile search batch queue${attemptIndex ? ` fallback ${attemptIndex}` : ''}`)
    await reloadPageTarget(target)
    const discovery = await inspectDiscoveryWithState(target, options, 'profile-search', fail, false, {
        allowProgressRows: true,
        allowQueueRows: true
    })
    let selection = await selectEnabledProfileSearchQueueTargets(target, targetCount, existingQueueTargets)
    let collect = null
    if((Number.parseInt(selection.enabledCount, 10) || 0) < targetCount) {
        const collectTimeoutMs = Math.max(0, Math.min(15000, selectionRemainingMs))
        if(collectTimeoutMs > 0) {
            collect = await collectMoreProfileSearchCandidates(target, Math.max(targetCount, 8), collectTimeoutMs)
            if(collect.clicked === true) {
                selection = await selectEnabledProfileSearchQueueTargets(target, targetCount, existingQueueTargets)
            }
        }
        else {
            collect = {clicked: false, reason: 'target-selection-timeout-before-collect'}
        }
    }
    const selectedTargets = (selection.selected || [])
        .map(entry => entry.href)
        .filter(Boolean)
        .slice(0, targetCount)
    return {
        url,
        target,
        discovery,
        selection,
        collect,
        selectedTargets,
        pageShape: discovery.page
    }
}

async function collectMoreProfileSearchCandidates(target, desiredEnabledCount = 8, timeoutMs = 45000) {
    const readState = async () => evaluate(target.webSocketDebuggerUrl, `(${function collectState() {
        const clean = text => `${text || ''}`.replace(/\s+/g, ' ').trim()
        const button = document.querySelector('.mb-ext_profile-search-collect-btn')
        const rowButtons = Array.from(document.querySelectorAll('.mb-ext_profile-search-row-btn[data-mb-profile-search-href]'))
        const enabledRowButtons = rowButtons.filter(rowButton => rowButton.disabled !== true)
        const batchButton = document.querySelector('.mb-ext_profile-search-batch-btn')
        return {
            found: !!button,
            text: button ? clean(button.innerText || button.textContent || '') : '',
            disabled: button ? button.disabled === true : false,
            rowButtonCount: rowButtons.length,
            enabledRowButtonCount: enabledRowButtons.length,
            batchText: batchButton ? clean(batchButton.innerText || batchButton.textContent || '') : '',
            scrollY: Math.round(window.scrollY || document.documentElement.scrollTop || 0),
            scrollHeight: Math.round(document.documentElement.scrollHeight || document.body?.scrollHeight || 0)
        }
    }})()`, 10000)

    const before = await readState()
    if(!before.found || before.disabled === true) {
        return {
            clicked: false,
            reason: before.found ? 'collect-button-disabled' : 'collect-button-not-found',
            before
        }
    }
    if((Number.parseInt(before.enabledRowButtonCount, 10) || 0) >= desiredEnabledCount) {
        return {
            clicked: false,
            reason: 'enough-candidates-before-collect',
            before
        }
    }

    const clicked = await evaluate(target.webSocketDebuggerUrl, `(${function clickCollectButton() {
        const clean = text => `${text || ''}`.replace(/\s+/g, ' ').trim()
        const button = document.querySelector('.mb-ext_profile-search-collect-btn')
        if(!button) return {clicked: false, reason: 'collect-button-not-found'}
        button.scrollIntoView({block: 'center', inline: 'nearest'})
        const beforeClickText = clean(button.innerText || button.textContent || '')
        button.click()
        return {
            clicked: true,
            text: beforeClickText
        }
    }})()`, 10000)
    if(clicked.clicked !== true) {
        return {
            clicked: false,
            reason: clicked.reason || 'collect-click-failed',
            before,
            click: clicked
        }
    }

    const startedAt = Date.now()
    const samples = []
    let finalState = null
    let observedCollectionActivity = false
    while(Date.now() - startedAt < timeoutMs) {
        await sleep(1500)
        const state = await readState()
        samples.push({
            text: state.text || '',
            batchText: state.batchText || '',
            rowButtonCount: state.rowButtonCount || 0,
            enabledRowButtonCount: state.enabledRowButtonCount || 0,
            scrollY: state.scrollY || 0,
            scrollHeight: state.scrollHeight || 0
        })
        if(samples.length > 12) samples.shift()
        const enabledCount = Number.parseInt(state.enabledRowButtonCount, 10) || 0
        const text = state.text || ''
        if(/Collecting|Collected/i.test(text)) observedCollectionActivity = true
        if(enabledCount >= desiredEnabledCount ||
                /No new candidates|Nothing queued|Stopped/i.test(text) ||
                (observedCollectionActivity && /^Collect\s+\d+\s+More/i.test(text))) {
            finalState = state
            break
        }
    }
    if(!finalState) finalState = await readState()
    return {
        clicked: true,
        before,
        click: clicked,
        finalState,
        samples,
        observedCollectionActivity,
        elapsedMs: Date.now() - startedAt,
        timedOut: Date.now() - startedAt >= timeoutMs
    }
}

async function selectProfileSearchTargetsWithFallback(config, options, warnings, fail, phaseLabel, existingQueueTargets, targetCount, initialTarget = null, initialDiscovery = null) {
    const urls = getPhase10SearchCandidateUrls(options)
    const attemptLimit = Math.max(1, Number.parseInt(options.phase10SearchAttemptLimit, 10) || 20)
    const selectionTimeoutMs = Math.max(30000, Number.parseInt(options.phase10TargetSelectionTimeoutMs, 10) || PHASE10_TARGET_SELECTION_TIMEOUT_MS)
    const selectionStartedAt = Date.now()
    const selectionDeadlineAt = selectionStartedAt + selectionTimeoutMs
    const attempts = []
    const accumulated = []
    const accumulatedHrefs = new Set()
    const searchTabCleanups = []
    let stoppedAfterSelectionTimeout = false
    const remainingSelectionMs = () => Math.max(0, selectionDeadlineAt - Date.now())
    const recordAttemptSelections = attempt => {
        for(const entry of attempt?.selection?.selected || []) {
            const href = entry?.href || ''
            if(!href || accumulatedHrefs.has(href)) continue
            accumulatedHrefs.add(href)
            accumulated.push({
                ...entry,
                searchUrl: attempt.url || attempt.discovery?.page?.url || ''
            })
            if(accumulated.length >= targetCount) break
        }
    }
    const buildAccumulatedResult = attempt => ({
        ...(attempt || attempts[attempts.length - 1] || {}),
        selectionTimedOut: stoppedAfterSelectionTimeout,
        selectionElapsedMs: Date.now() - selectionStartedAt,
        selectionTimeoutMs,
        selection: {
            requestedCount: targetCount,
            selected: accumulated.slice(0, targetCount),
            enabledCount: accumulated.length,
            excludedCount: Number.parseInt(attempt?.selection?.excludedCount, 10) || 0,
            allButtonCount: attempts.reduce((sum, item) => sum + (Number.parseInt(item?.selection?.allButtonCount, 10) || 0), 0),
            buttons: attempts.flatMap(item => item?.selection?.buttons || []).slice(0, 30),
            accumulatedFromSearches: attempts.map(item => ({
                url: item.url || item.discovery?.page?.url || '',
                selectedCount: item.selectedTargets?.length || 0,
                enabledCount: Number.parseInt(item.selection?.enabledCount, 10) || 0,
                excludedCount: Number.parseInt(item.selection?.excludedCount, 10) || 0,
                allButtonCount: Number.parseInt(item.selection?.allButtonCount, 10) || 0
            }))
        },
        selectedTargets: accumulated.slice(0, targetCount).map(entry => entry.href),
        attempts,
        searchTabCleanups
    })

    if(initialTarget && initialDiscovery) {
        let selection = await selectEnabledProfileSearchQueueTargets(initialTarget, targetCount, existingQueueTargets)
        let collect = null
        if((Number.parseInt(selection.enabledCount, 10) || 0) < targetCount) {
            const collectTimeoutMs = Math.max(0, Math.min(15000, remainingSelectionMs()))
            if(collectTimeoutMs > 0) {
                collect = await collectMoreProfileSearchCandidates(initialTarget, Math.max(targetCount, 8), collectTimeoutMs)
                if(collect.clicked === true) {
                    selection = await selectEnabledProfileSearchQueueTargets(initialTarget, targetCount, existingQueueTargets)
                }
            }
            else {
                collect = {clicked: false, reason: 'target-selection-timeout-before-collect'}
            }
        }
        const selectedTargets = (selection.selected || [])
            .map(entry => entry.href)
            .filter(Boolean)
            .slice(0, targetCount)
        attempts.push({
            url: initialDiscovery?.page?.url || initialTarget.url || urls[0] || '',
            target: initialTarget,
            discovery: initialDiscovery,
            selection,
            collect,
            selectedTargets,
            pageShape: initialDiscovery.page
        })
        recordAttemptSelections(attempts[0])
        if(accumulated.length >= targetCount) return buildAccumulatedResult(attempts[0])
        searchTabCleanups.push(await closeProfileSearchTarget(
            config,
            initialTarget,
            'phase10-initial-search-attempt-cleanup'
        ))
    }

    const attemptedUrls = new Set(attempts.map(attempt => attempt.url).filter(Boolean))
    for(const url of urls) {
        if(attempts.length >= attemptLimit) break
        if(remainingSelectionMs() <= 0) {
            stoppedAfterSelectionTimeout = true
            break
        }
        if(attemptedUrls.has(url)) continue
        const attemptTimeoutMs = Math.max(5000, Math.min(25000, remainingSelectionMs()))
        const attempt = await withTimeoutValue(
            inspectSearchTargetForQueueCandidates(
                config,
                {
                    ...options,
                    phase10TargetSelectionRemainingMs: attemptTimeoutMs
                },
                url,
                warnings,
                phaseLabel,
                fail,
                existingQueueTargets,
                targetCount,
                attempts.length
            ),
            attemptTimeoutMs + 5000,
            () => ({
                url,
                target: null,
                discovery: null,
                selection: {selected: [], enabledCount: 0, excludedCount: 0, allButtonCount: 0, buttons: []},
                collect: {clicked: false, reason: 'target-selection-attempt-timeout'},
                selectedTargets: [],
                pageShape: null,
                timedOut: true,
                timeoutMs: attemptTimeoutMs + 5000
            })
        )
        attempts.push(attempt)
        attemptedUrls.add(url)
        recordAttemptSelections(attempt)
        if(accumulated.length >= targetCount) return buildAccumulatedResult(attempt)
        if(attempt.target) {
            searchTabCleanups.push(await closeProfileSearchTarget(
                config,
                attempt.target,
                `phase10-candidate-search-attempt-${attempts.length}-cleanup`
            ))
        }
    }

    const lastAttempt = attempts[attempts.length - 1] || null
    return {
        target: lastAttempt?.target || initialTarget || null,
        discovery: lastAttempt?.discovery || initialDiscovery || null,
        selection: buildAccumulatedResult(lastAttempt).selection || lastAttempt?.selection || {selected: [], enabledCount: 0, buttons: []},
        selectedTargets: accumulated.map(entry => entry.href),
        attempts,
        searchTabCleanups,
        stoppedAfterAttemptLimit: attempts.length >= attemptLimit && accumulated.length < targetCount,
        stoppedAfterSelectionTimeout,
        selectionElapsedMs: Date.now() - selectionStartedAt,
        selectionTimeoutMs,
        attemptLimit
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

async function runDiscoveryReloadStabilitySmoke(config, options, context, warnings, fail) {
    const classified = await classifySpacesForDiscovery(context, options.spaceAssetUrls, options.spaceTargetUrls)
    const searchTarget = await findOrOpenPage(config, options.searchUrl, warnings, 'phase 7 profile search reload')
    const searchBefore = await inspectDiscoveryWithState(searchTarget, options, 'profile-search', fail)
    await reloadPageTarget(searchTarget)
    const searchAfterReload = await inspectDiscoveryWithState(searchTarget, options, 'profile-search', fail)

    const spaces = []
    const pageInputs = [
        ...options.spaceAssetUrls.map(url => ({url, category: 'asset'})),
        ...options.spaceTargetUrls.map(url => ({url, category: 'target'}))
    ]

    for(const input of pageInputs) {
        const target = await findOrOpenPage(config, input.url, warnings, `phase 7 ${input.category} space reload`)
        const before = await inspectDiscoveryWithState(target, options, 'space', fail)
        await reloadPageTarget(target)
        const afterReload = await inspectDiscoveryWithState(target, options, 'space', fail)
        if(afterReload.page.spaceCategory && afterReload.page.spaceCategory !== input.category) {
            fail('discovery reload space category mismatch', {
                url: afterReload.page.url,
                expected: input.category,
                actual: afterReload.page.spaceCategory
            })
        }
        spaces.push({
            kind: 'space',
            expectedCategory: input.category,
            before,
            afterReload
        })
    }

    return {
        kind: PHASE7_DISCOVERY_RELOAD,
        classified,
        search: {
            kind: 'profile-search',
            before: searchBefore,
            afterReload: searchAfterReload
        },
        spaces,
        totalCandidateCountAfterReload: (Number(searchAfterReload.page.discoveryCandidateCount || 0) || 0) +
            spaces.reduce((total, item) => total + (Number(item.afterReload.page.discoveryCandidateCount || 0) || 0), 0)
    }
}

async function clickOneProfileSearchQueueButton(target, targetProfileHref = '') {
    return evaluate(target.webSocketDebuggerUrl, `(${function clickOne(targetHref) {
        const normalize = href => {
            try {
                const url = new URL(href || '', location.href)
                if(!/^https:$/.test(url.protocol)) return ''
                if(!/(^|\.)quora\.com$/i.test(url.hostname)) return ''
                if(!/^\/profile\//i.test(url.pathname)) return ''
                url.hash = ''
                url.search = ''
                return `https://www.quora.com${url.pathname.replace(/\/+$/, '')}`
            }
            catch {
                return ''
            }
        }
        const desired = normalize(targetHref)
        const buttons = Array.from(document.querySelectorAll('.mb-ext_profile-search-row-btn[data-mb-profile-search-href]'))
            .map(button => ({
                button,
                href: normalize(button.dataset.mbProfileSearchHref || ''),
                disabled: button.disabled === true,
                text: `${button.innerText || button.textContent || ''}`.replace(/\s+/g, ' ').trim()
            }))
            .filter(entry => entry.href)
        const candidates = buttons.filter(entry => !entry.disabled && (!desired || entry.href === desired))
        const selected = candidates[0] || null
        if(!selected) {
            return {
                clicked: false,
                reason: desired ? 'target-button-not-found-or-disabled' : 'no-enabled-profile-search-row-button',
                desired,
                buttons: buttons.map(entry => ({
                    href: entry.href,
                    disabled: entry.disabled,
                    text: entry.text
                })).slice(0, 20)
            }
        }
        selected.button.scrollIntoView({block: 'center', inline: 'nearest'})
        selected.button.click()
        return {
            clicked: true,
            href: selected.href,
            text: selected.text,
            desired,
            enabledButtonCount: candidates.length,
            allButtonCount: buttons.length
        }
    }})(${JSON.stringify(targetProfileHref || '')})`, 10000)
}

function getProfileSearchSourceFromUrl(searchUrl = '') {
    let searchQuery = ''
    try {
        searchQuery = `${new URL(searchUrl).searchParams.get('q') || ''}`.trim()
    }
    catch {
        searchQuery = ''
    }
    return {
        type: 'profile-search',
        pageUrl: searchUrl || '',
        searchQuery,
        sourceLabel: searchQuery ? `Search: ${searchQuery}` : 'Profile Search'
    }
}

async function enqueueProfileSearchTargetViaRuntime(context, options, targetProfileHref = '', concurrency = 1) {
    let href = ''
    try {
        const url = new URL(targetProfileHref || '', options.searchUrl || 'https://www.quora.com/')
        if(/^https:$/.test(url.protocol) && /(^|\.)quora\.com$/i.test(url.hostname) && /^\/profile\//i.test(url.pathname)) {
            url.hash = ''
            url.search = ''
            href = `https://www.quora.com${url.pathname.replace(/\/+$/, '')}`
        }
    }
    catch {
        href = ''
    }
    if(!href) {
        return {
            enqueued: false,
            reason: 'invalid-target-profile-href',
            href: targetProfileHref || ''
        }
    }

    const runId = `profile-search-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
    const source = getProfileSearchSourceFromUrl(options.searchUrl || '')
    const message = {
        action: 'enqueue-coordinator-items',
        run: {
            id: runId,
            sourceType: 'profile-search',
            sourcePageUrl: source.pageUrl
        },
        source,
        execute: {
            tabAction: 'nuke',
            maxConcurrent: Math.max(1, Number.parseInt(concurrency, 10) || 1),
            noForegroundFallback: true,
            maxRetries: 2
        },
        items: [{
            runId,
            dedupeKey: href,
            targetProfileHref: href,
            requestedUrl: href,
            source
        }]
    }
    const result = await sendRuntimeMessage(context, message, 20000)
    const queued = Number.parseInt(result.response?.queued || 0, 10) || 0
    const merged = Number.parseInt(result.response?.merged || 0, 10) || 0
    return {
        enqueued: queued + merged > 0,
        href,
        runId,
        request: message,
        timedOut: result.timedOut === true,
        lastError: result.lastError || '',
        response: result.response || null,
        responseSummary: summarizeMessageResult(result)
    }
}

async function selectEnabledProfileSearchQueueTargets(target, count = 3, excludedHrefs = []) {
    return evaluate(target.webSocketDebuggerUrl, `(${function selectTargets(targetCount, excludedList) {
        const normalize = href => {
            try {
                const url = new URL(href || '', location.href)
                if(!/^https:$/.test(url.protocol)) return ''
                if(!/(^|\.)quora\.com$/i.test(url.hostname)) return ''
                if(!/^\/profile\//i.test(url.pathname)) return ''
                url.hash = ''
                url.search = ''
                return `https://www.quora.com${url.pathname.replace(/\/+$/, '')}`
            }
            catch {
                return ''
            }
        }
        const excluded = new Set((Array.isArray(excludedList) ? excludedList : [])
            .map(href => normalize(href))
            .filter(Boolean))
        const seen = new Set()
        const buttons = Array.from(document.querySelectorAll('.mb-ext_profile-search-row-btn[data-mb-profile-search-href]'))
            .map((button, index) => ({
                index,
                href: normalize(button.dataset.mbProfileSearchHref || ''),
                disabled: button.disabled === true,
                text: `${button.innerText || button.textContent || ''}`.replace(/\s+/g, ' ').trim()
            }))
            .filter(entry => entry.href)
        const enabled = []
        for(const entry of buttons) {
            if(entry.disabled || seen.has(entry.href)) continue
            seen.add(entry.href)
            if(excluded.has(entry.href)) continue
            enabled.push(entry)
        }
        return {
            requestedCount: targetCount,
            selected: enabled.slice(0, Math.max(0, targetCount)),
            enabledCount: enabled.length,
            excludedCount: excluded.size,
            allButtonCount: buttons.length,
            buttons: buttons.slice(0, 30)
        }
    }})(${JSON.stringify(Math.max(1, Number.parseInt(count, 10) || 3))}, ${JSON.stringify(excludedHrefs || [])})`, 10000)
}

async function stopExtensionServiceWorker(config, extensionId) {
    const extensionPrefix = `chrome-extension://${extensionId}/`
    const targets = await getTargets(config)
    const workers = targets.filter(target =>
        target.type === 'service_worker' &&
        `${target.url || ''}`.startsWith(extensionPrefix))
    if(!workers.length) {
        return {
            stopped: false,
            reason: 'service-worker-target-not-found',
            workers: []
        }
    }
    const versionInfo = await getJson('/json/version', config)
    const results = []
    for(const worker of workers) {
        const result = await cdpCommand(versionInfo.webSocketDebuggerUrl, 'Target.closeTarget', {
            targetId: worker.id
        }, 10000).catch(error => ({
            error: error?.message || `${error || ''}`
        }))
        results.push({
            id: worker.id,
            url: worker.url || '',
            result
        })
    }
    await sleep(1500)
    return {
        stopped: results.some(result => result.result?.success === true),
        workers: results
    }
}

function isProfileSearchTarget(target = {}) {
    if(target.type !== 'page') return false
    const url = target.url || ''
    if(!/^https:\/\/www\.quora\.com\/search\?/i.test(url)) return false
    try {
        const parsed = new URL(url)
        return (parsed.searchParams.get('type') || '').toLowerCase() === 'profile'
    }
    catch {
        return false
    }
}

async function closeProfileSearchTargets(config, reason = 'phase-profile-search-cleanup') {
    const targets = await getTargets(config)
    const versionInfo = await getJson('/json/version', config)
    const matches = targets.filter(isProfileSearchTarget)
    const closed = []
    for(const target of matches) {
        const result = await cdpCommand(versionInfo.webSocketDebuggerUrl, 'Target.closeTarget', {
            targetId: target.id
        }, 10000).catch(error => ({error: error?.message || `${error || ''}`}))
        closed.push({
            id: target.id,
            title: target.title || '',
            url: target.url || '',
            closed: result?.success !== false && !result?.error,
            error: result?.error || ''
        })
    }
    return {
        reason,
        matched: matches.length,
        closed
    }
}

async function closeProfileSearchTarget(config, target = null, reason = 'phase-profile-search-target-cleanup') {
    if(!isProfileSearchTarget(target)) {
        return {
            reason,
            closed: false,
            skipped: true,
            target: target ? {
                id: target.id || '',
                type: target.type || '',
                title: target.title || '',
                url: target.url || ''
            } : null
        }
    }
    const versionInfo = await getJson('/json/version', config)
    const result = await cdpCommand(versionInfo.webSocketDebuggerUrl, 'Target.closeTarget', {
        targetId: target.id
    }, 10000).catch(error => ({error: error?.message || `${error || ''}`}))
    return {
        reason,
        id: target.id || '',
        title: target.title || '',
        url: target.url || '',
        closed: result?.success !== false && !result?.error,
        error: result?.error || ''
    }
}

async function wakeServiceWorkerWithAccounting(context) {
    const accounting = await sendRuntimeMessage(context, {
        action: 'get-coordinator-queue-accounting',
        reason: `${ACTION_REASON}-service-worker-wake`
    }, 15000)
    const whyNotRunning = await sendRuntimeMessage(context, {
        action: 'get-coordinator-why-not-running',
        reason: `${ACTION_REASON}-service-worker-wake`
    }, 15000)
    return {
        accounting: summarizeMessageResult(accounting),
        whyNotRunning: summarizeMessageResult(whyNotRunning)
    }
}

async function waitForOneQueueRow(context, fail, label, timeoutMs = 15000, targetProfileHref = '') {
    const deadline = Date.now() + Math.max(1000, Number.parseInt(timeoutMs, 10) || 15000)
    let storage = await readStorage(context)
    let summary = summarizeQueueAuthority(storage, {preferRecovered: true})
    let targetSummary = targetProfileHref ? filterQueueAuthoritySummary(summary, targetProfileHref) : summary
    while(Date.now() < deadline && targetSummary.rowCount !== 1) {
        await sleep(500)
        storage = await readStorage(context)
        summary = summarizeQueueAuthority(storage, {preferRecovered: true})
        targetSummary = targetProfileHref ? filterQueueAuthoritySummary(summary, targetProfileHref) : summary
    }
    if(targetSummary.rowCount !== 1) {
        fail(`${label} did not observe exactly one durable queue row`, summary)
    }
    return {
        storage,
        summary: targetSummary,
        fullSummary: summary,
        authority: summarizeAuthorityState(storage)
    }
}

async function waitForTerminalQueueState(context, fail, timeoutMs = 120000, targetProfileHref = '') {
    const deadline = Date.now() + Math.max(5000, Number.parseInt(timeoutMs, 10) || 120000)
    let storage = await readStorage(context)
    let summary = summarizeQueueAuthority(storage, {preferRecovered: true})
    let targetSummary = targetProfileHref ? filterQueueAuthoritySummary(summary, targetProfileHref) : summary
    while(Date.now() < deadline) {
        if(targetSummary.rowCount === 1 &&
                targetSummary.terminalRows === 1 &&
                targetSummary.activeRows === 0 &&
                targetSummary.queuedRows === 0) {
            return {
                storage,
                summary: targetSummary,
                fullSummary: summary,
                authority: summarizeAuthorityState(storage),
                timedOut: false
            }
        }
        await sleep(1000)
        storage = await readStorage(context)
        summary = summarizeQueueAuthority(storage, {preferRecovered: true})
        targetSummary = targetProfileHref ? filterQueueAuthoritySummary(summary, targetProfileHref) : summary
    }
    fail('phase 8 item did not reach terminal queue state before timeout', summary)
    return {
        storage,
        summary: targetSummary,
        fullSummary: summary,
        authority: summarizeAuthorityState(storage),
        timedOut: true
    }
}

function assertWalPresent(authority = {}, fail, label = 'queue WAL') {
    if(!Array.isArray(authority.walKeys) || !authority.walKeys.length || authority.walSignature === '{}') {
        fail(`${label} is missing records`, {
            walKeys: authority.walKeys || [],
            walSignature: authority.walSignature || ''
        })
    }
}

function assertNoRuntimeActionSurfaceLeak(authority = {}, fail, label = 'runtime action surface') {
    if((Number.parseInt(authority.queuedActionSurfaceRecords, 10) || 0) > 0) {
        fail(`${label} has queued action-surface records after bounded phase`, {
            queuedActionSurfaceRecords: authority.queuedActionSurfaceRecords
        })
    }
}

function queueRowMatchesTargets(row = {}, targetSet = new Set()) {
    const candidates = [
        row?.targetProfileHref,
        row?.requestedUrl,
        row?.key
    ].map(value => normalizeComparableUrl(value || '')).filter(Boolean)
    return candidates.some(candidate => targetSet.has(candidate))
}

function getActiveQueuedRows(summary = {}, options = {}) {
    const activeQueued = row => /active|acting|opening|claim|running|pending|queued|retry|waiting/i.test(`${row?.status || ''}`)
    const authorityRows = (summary.rows || []).map(row => ({...row, source: summary.recovered ? 'recovered' : row.source || 'raw'}))
    const viewRows = (summary.viewRows || []).map(row => ({...row, source: 'view'}))
    const rows = authorityRows.length || options.allowViewFallback === false ? authorityRows : viewRows
    return rows.filter(activeQueued)
}

function summarizeSelectedQueueAuthority(summary = {}, targetProfileHrefs = [], options = {}) {
    const normalizedTargets = dedupeStrings(targetProfileHrefs.map(target => normalizeComparableUrl(target || '')))
    const targetSet = new Set(normalizedTargets)
    const selected = normalizedTargets.map(target => {
        const targetSummary = filterQueueAuthoritySummary(summary, target, {
            allowViewFallback: options.allowViewFallback !== false
        })
        return {
            targetProfileHref: target,
            rowCount: targetSummary.rowCount,
            rawRowCount: targetSummary.rawRowCount,
            viewRowCount: targetSummary.viewRowCount,
            queuedRows: targetSummary.queuedRows,
            activeRows: targetSummary.activeRows,
            terminalRows: targetSummary.terminalRows,
            statuses: Object.keys(targetSummary.statusCounts || {}).sort(),
            rows: targetSummary.rows
        }
    })
    const unrelatedActiveQueued = getActiveQueuedRows(summary, {
        allowViewFallback: options.allowViewFallback !== false
    })
        .filter(row => !queueRowMatchesTargets(row, targetSet))
    return {
        selectedCount: normalizedTargets.length,
        rowCount: selected.reduce((total, item) => total + item.rowCount, 0),
        rawRowCount: selected.reduce((total, item) => total + item.rawRowCount, 0),
        viewRowCount: selected.reduce((total, item) => total + item.viewRowCount, 0),
        queuedRows: selected.reduce((total, item) => total + item.queuedRows, 0),
        activeRows: selected.reduce((total, item) => total + item.activeRows, 0),
        terminalRows: selected.reduce((total, item) => total + item.terminalRows, 0),
        selected,
        unrelatedActiveQueuedCount: unrelatedActiveQueued.length,
        unrelatedActiveQueued
    }
}

function assertSelectedQueueRowsConsistent(selectedSummary = {}, fail, label = 'selected queue authority', options = {}) {
    const requireCompactView = options.requireCompactView !== false
    for(const item of selectedSummary.selected || []) {
        if(item.rowCount !== 1) {
            fail(`${label} expected exactly one durable row for selected target`, item)
        }
        if(requireCompactView && item.viewRowCount !== 1) {
            fail(`${label} expected exactly one compact view row for selected target`, item)
        }
    }
    if(selectedSummary.unrelatedActiveQueuedCount > 0) {
        fail(`${label} observed unrelated active/queued rows`, {
            unrelatedActiveQueued: selectedSummary.unrelatedActiveQueued
        })
    }
}

function assertSelectedCompactProjectionMaterialized(selectedSummary = {}, fail, label = 'selected compact queue projection') {
    for(const item of selectedSummary.selected || []) {
        if(item.viewRowCount !== 1) {
            fail(`${label} expected exactly one compact view row for selected target`, item)
        }
    }
}

async function waitForSelectedQueuedRows(context, fail, targetProfileHrefs = [], label = 'selected queued rows', timeoutMs = 20000, options = {}) {
    const deadline = Date.now() + Math.max(1000, Number.parseInt(timeoutMs, 10) || 20000)
    const summaryOptions = {
        preferRecovered: true,
        allowViewFallback: options.allowViewFallback !== false
    }
    let storage = await readStorage(context)
    let fullSummary = summarizeQueueAuthority(storage, summaryOptions)
    let selectedSummary = summarizeSelectedQueueAuthority(fullSummary, targetProfileHrefs, summaryOptions)
    const ready = () =>
        selectedSummary.selected.length === targetProfileHrefs.length &&
        selectedSummary.selected.every(item => item.rowCount === 1 && item.viewRowCount === 1 && item.terminalRows === 0) &&
        selectedSummary.queuedRows + selectedSummary.activeRows === targetProfileHrefs.length &&
        selectedSummary.unrelatedActiveQueuedCount === 0

    while(Date.now() < deadline && !ready()) {
        await sleep(500)
        storage = await readStorage(context)
        fullSummary = summarizeQueueAuthority(storage, summaryOptions)
        selectedSummary = summarizeSelectedQueueAuthority(fullSummary, targetProfileHrefs, summaryOptions)
    }
    if(!ready()) {
        fail(`${label} did not observe all selected targets queued before timeout`, {
            selectedSummary,
            fullSummary
        })
    }
    return {
        storage,
        fullSummary,
        summary: selectedSummary,
        authority: summarizeAuthorityState(storage)
    }
}

async function waitForSelectedTerminalRows(context, fail, targetProfileHrefs = [], timeoutMs = 240000, label = 'selected items', options = {}) {
    const deadline = Date.now() + Math.max(5000, Number.parseInt(timeoutMs, 10) || 240000)
    const idleStallMs = Math.max(5000, Number.parseInt(options.idleStallMs, 10) || 30000)
    const failOnIdleStall = options.failOnIdleStall === true
    const summaryOptions = {
        preferRecovered: true,
        allowViewFallback: options.allowViewFallback !== false
    }
    let idleStallStartedAt = 0
    let idleStallRuntime = null
    let storage = await readStorage(context)
    let fullSummary = summarizeQueueAuthority(storage, summaryOptions)
    let selectedSummary = summarizeSelectedQueueAuthority(fullSummary, targetProfileHrefs, summaryOptions)
    const terminalReady = () =>
        selectedSummary.selected.length === targetProfileHrefs.length &&
        selectedSummary.selected.every(item => item.rowCount === 1 && item.terminalRows === 1) &&
        selectedSummary.activeRows === 0 &&
        selectedSummary.queuedRows === 0 &&
        selectedSummary.unrelatedActiveQueuedCount === 0

    while(Date.now() < deadline && !terminalReady()) {
        if(failOnIdleStall &&
                selectedSummary.selected.length === targetProfileHrefs.length &&
                selectedSummary.queuedRows + selectedSummary.activeRows > 0) {
            const runtime = await readQueueRuntimeState(context, targetProfileHrefs)
            const runtimeSurfaceCount = (Number.parseInt(runtime.response?.matchedActiveQueuedTabs, 10) || 0) +
                (Number.parseInt(runtime.response?.matchedQueuedTabActions, 10) || 0) +
                (Number.parseInt(runtime.response?.matchedPendingTabActions, 10) || 0)
            if(runtime.ok === true && runtimeSurfaceCount <= 0) {
                const whyNotRunning = await readCoordinatorWhyNotRunning(context, "phase10-idle-stall-check")
                if(hasCoordinatorRecoverySignal(whyNotRunning)) {
                    idleStallStartedAt = 0
                    idleStallRuntime = null
                }
                else if(!idleStallStartedAt) {
                    idleStallStartedAt = Date.now()
                    idleStallRuntime = runtime
                }
                else if(Date.now() - idleStallStartedAt >= idleStallMs) {
                    const stallStorage = await readStorage(context)
                    const stallSummary = summarizeQueueAuthority(stallStorage, summaryOptions)
                    const stallSelectedSummary = summarizeSelectedQueueAuthority(stallSummary, targetProfileHrefs, summaryOptions)
                    const selectedProgressRecords = getSelectedProgressRecords(stallStorage, targetProfileHrefs, stallSelectedSummary)
                    const flightRecorder = await readFlightRecorder(context, {limit: PHASE10_FLIGHT_RECORDER_LIMIT})
                    const freshWhyNotRunning = await readCoordinatorWhyNotRunning(context, "phase10-idle-stall-failure")
                    if(hasCoordinatorRecoverySignal(freshWhyNotRunning)) {
                        idleStallStartedAt = 0
                        idleStallRuntime = null
                        continue
                    }
                    const executorClassification = {
                        ok: freshWhyNotRunning.ok,
                        timedOut: freshWhyNotRunning.timedOut,
                        lastError: freshWhyNotRunning.lastError,
                        response: freshWhyNotRunning.response?.executor || null
                    }
                    const primaryUnresolvedCase = executorClassification.response?.primaryUnresolvedCase || null
                    const stallReason = primaryUnresolvedCase?.case || "authority-work-without-runtime-surface"
                    fail(`${label} stalled with queued/active authority but no runtime actor surface`, {
                        idleStallMs,
                        selectedSummary: stallSelectedSummary,
                        fullSummary: stallSummary,
                        runtimeState: runtime,
                        whyNotRunning: freshWhyNotRunning,
                        executorClassification,
                        primaryUnresolvedCase,
                        firstIdleRuntimeState: idleStallRuntime,
                        selectedProgressRecords,
                        flightRecorder
                    })
                    return {
                        storage: stallStorage,
                        fullSummary: stallSummary,
                        summary: stallSelectedSummary,
                        authority: summarizeAuthorityState(stallStorage),
                        runtimeState: runtime,
                        whyNotRunning: freshWhyNotRunning,
                        executorClassification,
                        primaryUnresolvedCase,
                        selectedProgressRecords,
                        flightRecorder,
                        timedOut: true,
                        stalled: true,
                        stallReason
                    }
                }
            }
            else {
                idleStallStartedAt = 0
                idleStallRuntime = null
            }
        }
        await sleep(1000)
        storage = await readStorage(context)
        fullSummary = summarizeQueueAuthority(storage, summaryOptions)
        selectedSummary = summarizeSelectedQueueAuthority(fullSummary, targetProfileHrefs, summaryOptions)
    }
    if(!terminalReady()) {
        const selectedProgressRecords = getSelectedProgressRecords(storage, targetProfileHrefs, selectedSummary)
        const flightRecorder = await readFlightRecorder(context, {limit: PHASE10_FLIGHT_RECORDER_LIMIT})
        const runtimeState = await readQueueRuntimeState(context, targetProfileHrefs)
        const executorClassification = await readExecutorClassification(context)
        const primaryUnresolvedCase = executorClassification.response?.primaryUnresolvedCase || null
        const stalledSelectedRows = (selectedSummary.selected || [])
            .flatMap(item => item.rows || [])
            .filter(row => /active|acting|opening|claim|running|pending/i.test(`${row?.status || ''}`))
            .map(row => ({
                key: row.key || '',
                targetProfileHref: row.targetProfileHref || row.requestedUrl || '',
                status: row.status || '',
                tabId: row.tabId || null,
                executorTabAction: row.executorTabAction || ''
            }))
        fail(`${label} did not all reach terminal queue state before timeout`, {
            selectedSummary,
            stalledSelectedRows,
            fullSummary,
            runtimeState,
            executorClassification,
            primaryUnresolvedCase,
            selectedProgressRecords,
            flightRecorder
        })
    }
    return {
        storage,
        fullSummary,
        summary: selectedSummary,
        authority: summarizeAuthorityState(storage),
        runtimeState: await readQueueRuntimeState(context, targetProfileHrefs),
        executorClassification: await readExecutorClassification(context),
        timedOut: !terminalReady()
    }
}

function isAcceptedSuccessfulTerminalStatus(status = '') {
    return /succeeded|success|skipped|canceled|cancelled/i.test(`${status || ''}`)
}

function isNamedDurableTerminalFailure(row = null) {
    const status = `${row?.status || ''}`
    const outcome = `${row?.outcome || ''}`.trim()
    const error = `${row?.error || ''}`.trim()
    const terminalAt = Number.parseInt(row?.terminalAt, 10) || 0
    return /failed|failure|blocked|terminal/i.test(status) &&
        terminalAt > 0 &&
        (outcome || error)
}

function assertSelectedTerminalOutcomes(selectedSummary = {}, fail, label = 'selected terminal outcomes', options = {}) {
    const allowNamedDurableFailures = options.allowNamedDurableFailures === true
    for(const item of selectedSummary.selected || []) {
        const row = (item.rows || [])[0] || null
        const status = `${row?.status || ''}`
        if(isAcceptedSuccessfulTerminalStatus(status)) continue
        if(allowNamedDurableFailures && isNamedDurableTerminalFailure(row)) continue
        if(allowNamedDurableFailures) {
            fail(`${label} contains a failed terminal row without a durable named reason`, {
                targetProfileHref: item.targetProfileHref,
                row
            })
            continue
        }
        {
            fail(`${label} contains an unaccepted terminal status`, {
                targetProfileHref: item.targetProfileHref,
                row
            })
        }
    }
}

async function runOneItemQueueAuthoritySmoke(config, options, context, warnings, fail) {
    let preRestartFlightRecorder = null
    const idleFlightRecorder = null
    const searchTarget = await findOrOpenPage(config, options.searchUrl, warnings, 'phase 8 profile search one-item queue')
    const discovery = await inspectDiscoveryWithState(searchTarget, options, 'profile-search', fail, true, {
        allowProgressRows: true
    })
    const beforeStorage = await readStorage(context)
    const beforeAuthority = summarizeAuthorityState(beforeStorage)
    const beforeQueue = summarizeQueueAuthority(beforeStorage, {preferRecovered: true})

    if(beforeQueue.activeRows > 0 || beforeQueue.queuedRows > 0 ||
            (Number.parseInt(beforeAuthority.queuedActionSurfaceRecords, 10) || 0) > 0) {
        fail('phase 8 must start with no active/queued work in the selected profile', {
            beforeQueue,
            beforeAuthority
        })
    }

    const pauseBeforeQueue = await sendRuntimeMessage(context, {action: 'pause-coordinator-nukes'}, 10000)
    const queueClick = await clickOneProfileSearchQueueButton(searchTarget, options.phase8TargetProfileHref)
    if(queueClick.clicked !== true) {
        fail('phase 8 failed to click one real profile-search queue button', queueClick)
        return {
            kind: PHASE8_ONE_ITEM_QUEUE,
            search: discovery,
            targetProfileHref: '',
            pauseBeforeQueue: summarizeMessageResult(pauseBeforeQueue),
            queueClick,
            beforeQueue,
            beforeAuthority,
            aborted: true,
            abortReason: queueClick.reason || 'queue-click-failed'
        }
    }
    const targetProfileHref = queueClick.href || options.phase8TargetProfileHref || ''

    const afterEnqueue = await waitForOneQueueRow(context, fail, 'phase 8 after enqueue', 20000, targetProfileHref)
    assertOneItemQueueAuthorityConsistent(afterEnqueue.summary, fail, 'phase 8 after enqueue')
    assertWalPresent(afterEnqueue.authority, fail, 'phase 8 after enqueue WAL')
    if(afterEnqueue.summary.queuedRows + afterEnqueue.summary.activeRows < 1) {
        fail('phase 8 after enqueue row is neither queued nor active', afterEnqueue.summary)
    }

    const restartBeforeStart = await stopExtensionServiceWorker(config, options.extensionId)
    const wakeBeforeStart = await wakeServiceWorkerWithAccounting(context)
    const afterRestartBeforeStart = await waitForOneQueueRow(context, fail, 'phase 8 after pre-start service-worker restart', 20000, targetProfileHref)
    assertOneItemQueueAuthorityConsistent(afterRestartBeforeStart.summary, fail, 'phase 8 after pre-start service-worker restart')
    assertWalPresent(afterRestartBeforeStart.authority, fail, 'phase 8 after pre-start restart WAL')
    if(afterRestartBeforeStart.summary.terminalRows > 0) {
        fail('phase 8 row reached terminal before Start', afterRestartBeforeStart.summary)
    }

    const resumePaused = await sendRuntimeMessage(context, {action: 'resume-paused-coordinator-nukes'}, 10000)
    const start = await sendRuntimeMessage(context, {
        action: 'resume-coordinator-queue',
        allowBeforeQuora: true,
        userInitiated: true,
        actionBudget: 1,
        timeoutMs: Math.min(30000, Math.max(5000, Number.parseInt(options.phase8TimeoutMs, 10) || 120000))
    }, 40000)
    if(start.timedOut || start.lastError) {
        fail('phase 8 user-equivalent Start failed', start)
    }

    const terminal = await waitForTerminalQueueState(context, fail, options.phase8TimeoutMs, targetProfileHref)
    assertOneItemQueueAuthorityConsistent(terminal.summary, fail, 'phase 8 terminal')
    assertWalPresent(terminal.authority, fail, 'phase 8 terminal WAL')
    assertNoRuntimeActionSurfaceLeak(terminal.authority, fail, 'phase 8 terminal')
    const terminalRow = terminal.summary.rows[0] || null
    if(terminalRow && !/succeeded|success|skipped|canceled|cancelled/i.test(terminalRow.status)) {
        fail('phase 8 terminal status is not an accepted one-item outcome', terminalRow)
    }
    preRestartFlightRecorder = await readFlightRecorder(context, {limit: PHASE10_FLIGHT_RECORDER_LIMIT})

    const restartAfterTerminal = await stopExtensionServiceWorker(config, options.extensionId)
    const wakeAfterTerminal = await wakeServiceWorkerWithAccounting(context)
    const afterRestartAfterTerminal = await waitForOneQueueRow(context, fail, 'phase 8 after terminal service-worker restart', 20000, targetProfileHref)
    assertOneItemQueueAuthorityConsistent(afterRestartAfterTerminal.summary, fail, 'phase 8 after terminal service-worker restart')
    assertWalPresent(afterRestartAfterTerminal.authority, fail, 'phase 8 after terminal restart WAL')
    if(afterRestartAfterTerminal.summary.activeRows > 0 || afterRestartAfterTerminal.summary.queuedRows > 0) {
        fail('phase 8 terminal hydrate reopened work after service-worker restart', afterRestartAfterTerminal.summary)
    }
    assertNoRuntimeActionSurfaceLeak(afterRestartAfterTerminal.authority, fail, 'phase 8 after terminal restart')

    return {
        kind: PHASE8_ONE_ITEM_QUEUE,
        search: discovery,
        targetProfileHref,
        beforeQueue,
        beforeAuthority,
        pauseBeforeQueue: summarizeMessageResult(pauseBeforeQueue),
        queueClick,
        afterEnqueue: {
            queue: afterEnqueue.summary,
            fullQueue: afterEnqueue.fullSummary,
            authority: afterEnqueue.authority
        },
        restartBeforeStart,
        wakeBeforeStart,
        afterRestartBeforeStart: {
            queue: afterRestartBeforeStart.summary,
            fullQueue: afterRestartBeforeStart.fullSummary,
            authority: afterRestartBeforeStart.authority
        },
        resumePaused: summarizeMessageResult(resumePaused),
        start: summarizeMessageResult(start),
        startFull: start,
        terminal: {
            timedOut: terminal.timedOut,
            queue: terminal.summary,
            fullQueue: terminal.fullSummary,
            authority: terminal.authority
        },
        restartAfterTerminal,
        wakeAfterTerminal,
        afterRestartAfterTerminal: {
            queue: afterRestartAfterTerminal.summary,
            fullQueue: afterRestartAfterTerminal.fullSummary,
            authority: afterRestartAfterTerminal.authority
        },
        preRestartFlightRecorder,
        idleFlightRecorder
    }
}

async function runSmallBatchQueueAuthoritySmoke(config, options, context, warnings, fail) {
    const mediumBatch = options.phase === PHASE10_MEDIUM_BATCH_QUEUE
    const batchKind = mediumBatch ? PHASE10_MEDIUM_BATCH_QUEUE : PHASE9_SMALL_BATCH_QUEUE
    const phaseLabel = mediumBatch ? 'phase 10' : 'phase 9'
    const targetCount = mediumBatch ? options.phase10TargetCount : options.phase9TargetCount
    const timeoutMs = mediumBatch ? options.phase10TimeoutMs : options.phase9TimeoutMs
    const concurrency = mediumBatch ? options.phase10Concurrency : 1
    const idleMs = mediumBatch ? options.phase10IdleMs : 0
    const phaseState = {
        currentStep: 'initializing',
        selectedTargets: [],
        queueClicks: [],
        incrementalEnqueue: []
    }
    let phase10WatchdogTimer = null
    let phase10WatchdogDeadlineAt = 0
    const phase10SignalHandlers = []
    const clearPhase10Diagnostics = () => {
        if(phase10WatchdogTimer) {
            clearTimeout(phase10WatchdogTimer)
            phase10WatchdogTimer = null
        }
        for(const [signal, handler] of phase10SignalHandlers.splice(0)) {
            process.removeListener(signal, handler)
        }
    }
    const finishPhase = value => {
        clearPhase10Diagnostics()
        return value
    }
    const writePhase10Artifact = async (reason, details = null) => {
        if(!mediumBatch) return null
        return writePhase10DiagnosticArtifact(config, context, options, phaseState, reason, details)
    }
    if(mediumBatch) {
        const phase10WatchdogMs = Math.max(
            PHASE10_HARNESS_WATCHDOG_MS,
            (Number.parseInt(timeoutMs, 10) || PHASE10_HARNESS_WATCHDOG_MS) + 60000
        )
        phase10WatchdogDeadlineAt = Date.now() + phase10WatchdogMs
        const handleSignal = signal => {
            void writePhase10Artifact(`signal-${signal.toLowerCase()}`, {signal})
                .then(result => {
                    console.error(JSON.stringify({
                        error: 'phase10-interrupted',
                        signal,
                        artifactPath: result?.artifactPath || ''
                    }))
                })
                .catch(error => {
                    console.error(JSON.stringify({
                        error: 'phase10-interrupted-artifact-failed',
                        signal,
                        message: error.message
                    }))
                })
                .finally(() => process.exit(1))
        }
        for(const signal of ['SIGINT', 'SIGTERM']) {
            process.once(signal, handleSignal)
            phase10SignalHandlers.push([signal, handleSignal])
        }
        phase10WatchdogTimer = setTimeout(() => {
            void writePhase10Artifact('harness-watchdog-timeout', {
                watchdogMs: phase10WatchdogMs,
                phaseTimeoutMs: timeoutMs
            })
                .then(result => {
                    console.error(JSON.stringify({
                        error: 'phase10-harness-watchdog-timeout',
                        artifactPath: result?.artifactPath || '',
                        watchdogMs: phase10WatchdogMs,
                        phaseTimeoutMs: timeoutMs
                    }))
                })
                .catch(error => {
                    console.error(JSON.stringify({
                        error: 'phase10-harness-watchdog-artifact-failed',
                        message: error.message
                    }))
                })
                .finally(() => process.exit(1))
        }, phase10WatchdogMs)
        phase10WatchdogTimer.unref?.()
    }

    phaseState.currentStep = 'starting'
    tracePhase(options, `${phaseLabel} starting`)
    const preferenceBefore = await readStorage(context)
    const previousProfilesPerBatch = preferenceBefore?.data?.profilesPerBatch
    const lowConcurrencyPreference = {
        key: 'profilesPerBatch',
        previousValue: previousProfilesPerBatch,
        requestedValue: concurrency,
        set: await setStorageValues(context, {profilesPerBatch: concurrency}),
        restored: null
    }
    if(lowConcurrencyPreference.set?.ok !== true) {
        fail(`${phaseLabel} failed to set low-concurrency profile-search preference`, lowConcurrencyPreference.set)
    }
    const restorePreferenceAndResumePause = async (resumePause = true) => {
        lowConcurrencyPreference.restored = await setStorageValues(context, {profilesPerBatch: previousProfilesPerBatch})
        const resumeAfterAbort = resumePause
            ? await sendRuntimeMessage(context, {action: 'resume-paused-coordinator-nukes'}, 10000)
            : null
        return {
            lowConcurrencyRestored: lowConcurrencyPreference.restored,
            resumeAfterAbort
        }
    }

    phaseState.currentStep = 'opening-search-target'
    let pauseBeforeQueue = null
    if(mediumBatch) {
        pauseBeforeQueue = await sendRuntimeMessage(context, {action: 'pause-coordinator-nukes'}, 10000)
    }
    let searchTarget = await findOrOpenPage(config, options.searchUrl, warnings, `${phaseLabel} profile search batch queue`)
    tracePhase(options, `${phaseLabel} search target ready`, {url: searchTarget.url || ''})
    await reloadPageTarget(searchTarget)
    let discovery = await inspectDiscoveryWithState(searchTarget, options, 'profile-search', fail, false, {
        allowProgressRows: true,
        allowQueueRows: true
    })
    const beforeStorage = await readStorage(context)
    const beforeAuthority = summarizeAuthorityState(beforeStorage)
    const beforeQueue = summarizeQueueAuthority(beforeStorage, {
        preferRecovered: true,
        allowViewFallback: false
    })
    const beforeSelected = summarizeSelectedQueueAuthority(beforeQueue, [])

    if(beforeQueue.activeRows > 0 || beforeQueue.queuedRows > 0 ||
            (Number.parseInt(beforeAuthority.queuedActionSurfaceRecords, 10) || 0) > 0) {
        const diagnostic = mediumBatch
            ? await writePhase10Artifact('dirty-start-active-or-queued-work', {
                beforeQueue,
                beforeAuthority
            })
            : null
        fail(`${phaseLabel} must start with no active/queued work in the selected profile`, {
            beforeQueue,
            beforeAuthority,
            diagnosticArtifactPath: diagnostic?.artifactPath || ''
        })
        const abortCleanup = await restorePreferenceAndResumePause(false)
        return finishPhase({
            kind: batchKind,
            search: discovery,
            lowConcurrencyPreference,
            beforeQueue,
            beforeSelected,
            beforeAuthority,
            startDirtyDiagnostic: diagnostic?.snapshot || null,
            startDirtyDiagnosticPath: diagnostic?.artifactPath || '',
            abortCleanup,
            aborted: true,
            abortReason: 'dirty-start-active-or-queued-work'
        })
    }

    const existingQueueTargets = Array.from(new Set([
        ...(Array.isArray(beforeQueue.rows) ? beforeQueue.rows : []),
        ...(!mediumBatch && Array.isArray(beforeQueue.viewRows) ? beforeQueue.viewRows : [])
    ].flatMap(row => [row?.key, row?.targetProfileHref, row?.requestedUrl])
        .filter(Boolean)))

    phaseState.currentStep = 'selecting-targets'
    if(!pauseBeforeQueue) {
        pauseBeforeQueue = await sendRuntimeMessage(context, {action: 'pause-coordinator-nukes'}, 10000)
    }
    const targetSelection = mediumBatch
        ? await selectProfileSearchTargetsWithFallback(
            config,
            options,
            warnings,
            fail,
            phaseLabel,
            existingQueueTargets,
            targetCount,
            searchTarget,
            discovery
        )
        : {
            target: searchTarget,
            discovery,
            selection: await selectEnabledProfileSearchQueueTargets(searchTarget, targetCount, existingQueueTargets),
            attempts: []
        }
    searchTarget = targetSelection.target || searchTarget
    discovery = targetSelection.discovery || discovery
    const searchTabCleanupsDuringSelection = targetSelection.searchTabCleanups || []
    const selection = targetSelection.selection || {selected: []}
    tracePhase(options, `${phaseLabel} selected targets`, {
        requested: targetCount,
        selected: (selection.selected || []).map(entry => entry.href),
        excludedExistingQueueTargets: existingQueueTargets.length,
        searchUrl: discovery?.page?.url || searchTarget?.url || '',
        searchAttemptCount: targetSelection.attempts?.length || 0
    })
    const selectedTargets = (selection.selected || [])
        .map(entry => entry.href)
        .filter(Boolean)
        .slice(0, targetCount)
    phaseState.selectedTargets = selectedTargets
    const searchTabCleanupAfterSelection = mediumBatch
        ? await closeProfileSearchTargets(config, 'phase10-after-target-selection')
        : null
    if(selectedTargets.length !== targetCount) {
        const diagnostic = mediumBatch
            ? await writePhase10Artifact('not-enough-enabled-profile-search-row-buttons', {
                requested: targetCount,
                selectedTargets,
                selection,
                searchAttempts: (targetSelection.attempts || []).map(attempt => ({
                    url: attempt.url || attempt.discovery?.page?.url || '',
                    selectedCount: attempt.selectedTargets?.length || 0,
                    enabledCount: Number.parseInt(attempt.selection?.enabledCount, 10) || 0,
                    excludedCount: Number.parseInt(attempt.selection?.excludedCount, 10) || 0,
                    allButtonCount: Number.parseInt(attempt.selection?.allButtonCount, 10) || 0,
                    collect: attempt.collect || null,
                    pageShape: attempt.pageShape || attempt.discovery?.page || null,
                    selection: attempt.selection || null
                }))
            })
            : null
        fail(`${phaseLabel} did not find enough enabled profile-search row buttons`, {
            requested: targetCount,
            selectedTargets,
            selection,
            searchAttempts: targetSelection.attempts || [],
            diagnosticArtifactPath: diagnostic?.artifactPath || ''
        })
        const abortCleanup = await restorePreferenceAndResumePause()
        return finishPhase({
            kind: batchKind,
            search: discovery,
            lowConcurrencyPreference,
            beforeQueue,
            beforeSelected,
            beforeAuthority,
            pauseBeforeQueue: summarizeMessageResult(pauseBeforeQueue),
            selection,
            selectedTargets,
            searchAttempts: targetSelection.attempts || [],
            existingQueueTargets,
            searchTabCleanupsDuringSelection,
            searchTabCleanupAfterSelection,
            abortCleanup,
            discoveryFailureDiagnostic: diagnostic?.snapshot || null,
            discoveryFailureDiagnosticPath: diagnostic?.artifactPath || '',
            aborted: true,
            abortReason: 'not-enough-enabled-profile-search-row-buttons'
        })
    }

    const queueClicks = []
    const incrementalEnqueue = []
    phaseState.queueClicks = queueClicks
    phaseState.incrementalEnqueue = incrementalEnqueue
    for(const href of selectedTargets) {
        phaseState.currentStep = `enqueue-${queueClicks.length + 1}`
        tracePhase(options, `${phaseLabel} queue click`, {href})
        const click = mediumBatch
            ? await enqueueProfileSearchTargetViaRuntime(context, options, href, concurrency)
            : await clickOneProfileSearchQueueButton(searchTarget, href)
        queueClicks.push(click)
        const queueAccepted = mediumBatch
            ? click.enqueued === true
            : click.clicked === true
        if(!queueAccepted) {
            const diagnostic = mediumBatch
                ? await writePhase10Artifact('enqueue-rpc-not-accepted', {href, click})
                : null
            fail(mediumBatch
                ? `${phaseLabel} enqueue RPC did not accept selected profile-search target`
                : `${phaseLabel} failed to click a selected profile-search queue button`, {
                href,
                click,
                diagnosticArtifactPath: diagnostic?.artifactPath || ''
            })
            const abortCleanup = await restorePreferenceAndResumePause()
            return finishPhase({
                kind: batchKind,
                search: discovery,
                lowConcurrencyPreference,
                beforeQueue,
                beforeSelected,
                beforeAuthority,
                pauseBeforeQueue: summarizeMessageResult(pauseBeforeQueue),
                selection,
                selectedTargets,
                existingQueueTargets,
                searchTabCleanupsDuringSelection,
                searchTabCleanupAfterSelection,
                queueClicks,
                incrementalEnqueue,
                abortCleanup,
                enqueueFailureDiagnostic: diagnostic?.snapshot || null,
                enqueueFailureDiagnosticPath: diagnostic?.artifactPath || '',
                aborted: true,
                abortReason: mediumBatch ? 'enqueue-rpc-not-accepted' : click.reason || 'queue-click-failed'
            })
        }
        phaseState.currentStep = `materializing-enqueue-${queueClicks.length}`
        const queuedSoFar = await waitForSelectedQueuedRows(
            context,
            fail,
            selectedTargets.slice(0, queueClicks.length),
            `${phaseLabel} after queue click ${queueClicks.length}`,
            15000,
            {allowViewFallback: !mediumBatch}
        )
        const runtimeStateAfterEnqueue = mediumBatch
            ? await readQueueRuntimeState(context, selectedTargets.slice(0, queueClicks.length))
            : null
        const visibleTabsAfterEnqueue = mediumBatch
            ? await readVisibleTargetTabs(config, selectedTargets.slice(0, queueClicks.length))
            : null
        const tabAuthorityInvariantAfterEnqueue = mediumBatch
            ? buildTabAuthorityInvariant(visibleTabsAfterEnqueue, queuedSoFar.fullSummary, selectedTargets.slice(0, queueClicks.length))
            : null
        const flightRecorderAfterEnqueue = mediumBatch
            ? await readFlightRecorder(context, {limit: PHASE10_FLIGHT_RECORDER_LIMIT})
            : null
        incrementalEnqueue.push({
            clickedTarget: href,
            enqueueResponse: click,
            queue: queuedSoFar.summary,
            fullQueue: queuedSoFar.fullSummary,
            authority: queuedSoFar.authority,
            runtimeState: runtimeStateAfterEnqueue,
            visibleTabs: visibleTabsAfterEnqueue,
            tabAuthorityInvariant: tabAuthorityInvariantAfterEnqueue,
            flightRecorder: flightRecorderAfterEnqueue
        })
        if(tabAuthorityInvariantAfterEnqueue?.ok === false) {
            const diagnostic = await writePhase10Artifact('tab-open-without-authority-evidence', {
                href,
                invariant: tabAuthorityInvariantAfterEnqueue
            })
            fail(`${phaseLabel} opened a profile tab without matching authority evidence`, {
                href,
                invariant: tabAuthorityInvariantAfterEnqueue,
                diagnosticArtifactPath: diagnostic?.artifactPath || ''
            })
            const abortCleanup = await restorePreferenceAndResumePause()
            return finishPhase({
                kind: batchKind,
                search: discovery,
                lowConcurrencyPreference,
                beforeQueue,
                beforeSelected,
                beforeAuthority,
                pauseBeforeQueue: summarizeMessageResult(pauseBeforeQueue),
                selection,
                selectedTargets,
                existingQueueTargets,
                searchTabCleanupsDuringSelection,
                searchTabCleanupAfterSelection,
                queueClicks,
                incrementalEnqueue,
                abortCleanup,
                invariantFailureDiagnostic: diagnostic?.snapshot || null,
                invariantFailureDiagnosticPath: diagnostic?.artifactPath || '',
                aborted: true,
                abortReason: 'tab-open-without-authority-evidence'
            })
        }
        const latest = (queuedSoFar.summary.selected || [])
            .find(item => item.targetProfileHref === href)
        if(!latest || latest.rowCount !== 1 || latest.viewRowCount !== 1) {
            const diagnostic = mediumBatch
                ? await writePhase10Artifact('selected-row-did-not-materialize-after-click', {href, latest: latest || null})
                : null
            const abortCleanup = await restorePreferenceAndResumePause()
            return finishPhase({
                kind: batchKind,
                search: discovery,
                lowConcurrencyPreference,
                beforeQueue,
                beforeSelected,
                beforeAuthority,
                pauseBeforeQueue: summarizeMessageResult(pauseBeforeQueue),
                selection,
                selectedTargets,
                existingQueueTargets,
                searchTabCleanupsDuringSelection,
                searchTabCleanupAfterSelection,
                queueClicks,
                incrementalEnqueue,
                abortCleanup,
                materializationFailureDiagnostic: diagnostic?.snapshot || null,
                materializationFailureDiagnosticPath: diagnostic?.artifactPath || '',
                aborted: true,
                abortReason: 'selected-row-did-not-materialize-after-click'
            })
        }
    }

    phaseState.currentStep = 'after-enqueue-wait'
    tracePhase(options, `${phaseLabel} waiting after enqueue`)
    const afterEnqueue = await waitForSelectedQueuedRows(
        context,
        fail,
        selectedTargets,
        `${phaseLabel} after enqueue`,
        30000,
        {allowViewFallback: !mediumBatch}
    )
    assertSelectedQueueRowsConsistent(afterEnqueue.summary, fail, `${phaseLabel} after enqueue`)
    assertWalPresent(afterEnqueue.authority, fail, `${phaseLabel} after enqueue WAL`)

    phaseState.currentStep = 'restart-before-start'
    tracePhase(options, `${phaseLabel} stopping service worker before start`)
    const restartBeforeStart = await stopExtensionServiceWorker(config, options.extensionId)
    tracePhase(options, `${phaseLabel} waking service worker before start`)
    const wakeBeforeStart = await wakeServiceWorkerWithAccounting(context)
    const afterRestartBeforeStart = await waitForSelectedQueuedRows(
        context,
        fail,
        selectedTargets,
        `${phaseLabel} after pre-start service-worker restart`,
        30000,
        {allowViewFallback: !mediumBatch}
    )
    assertSelectedQueueRowsConsistent(afterRestartBeforeStart.summary, fail, `${phaseLabel} after pre-start service-worker restart`)
    assertWalPresent(afterRestartBeforeStart.authority, fail, `${phaseLabel} after pre-start restart WAL`)

    phaseState.currentStep = 'start'
    const resumePaused = await sendRuntimeMessage(context, {action: 'resume-paused-coordinator-nukes'}, 10000)
    tracePhase(options, `${phaseLabel} starting queue`)
    const start = await sendRuntimeMessage(context, {
        action: 'resume-coordinator-queue',
        allowBeforeQuora: true,
        userInitiated: true,
        actionBudget: targetCount,
        timeoutMs: Math.min(60000, Math.max(10000, Number.parseInt(timeoutMs, 10) || 240000))
    }, 70000)
    if(start.timedOut || start.lastError) {
        fail(`${phaseLabel} user-equivalent Start failed`, start)
    }

    phaseState.currentStep = 'waiting-for-terminal'
    tracePhase(options, `${phaseLabel} waiting for terminal rows`)
    const terminal = await waitForSelectedTerminalRows(context, fail, selectedTargets, timeoutMs, `${phaseLabel} selected items`, {
        failOnIdleStall: mediumBatch,
        idleStallMs: mediumBatch ? Math.max(15000, Math.min(idleMs || 30000, 60000)) : 0,
        allowViewFallback: !mediumBatch
    })
    const terminalStorage = terminal.storage || await readStorage(context)
    const terminalSelectedProgressRecords = getSelectedProgressRecords(terminalStorage, selectedTargets, terminal.summary)
    const preRestartFlightRecorder = await readFlightRecorder(context, {limit: PHASE10_FLIGHT_RECORDER_LIMIT})
    if(terminal.timedOut) {
        tracePhase(options, `${phaseLabel} terminal wait failed before restart`, {
            stalled: terminal.stalled === true,
            stallReason: terminal.stallReason || ''
        })
        lowConcurrencyPreference.restored = await setStorageValues(context, {profilesPerBatch: previousProfilesPerBatch})
        const diagnostic = mediumBatch
            ? await writePhase10Artifact(terminal.stallReason || 'selected-terminal-wait-timeout', {
                terminal: {
                    stalled: terminal.stalled === true,
                    stallReason: terminal.stallReason || '',
                    timedOut: terminal.timedOut === true
                }
            })
            : null
        const authoritativeTerminalSnapshot = diagnostic?.snapshot || null
        const terminalQueue = authoritativeTerminalSnapshot?.queue || terminal.summary
        const terminalFullQueue = authoritativeTerminalSnapshot?.fullQueue || terminal.fullSummary
        const terminalAuthority = authoritativeTerminalSnapshot?.authority || terminal.authority
        return finishPhase({
            kind: batchKind,
            search: discovery,
            lowConcurrencyPreference,
            beforeQueue,
            beforeSelected,
            beforeAuthority,
            pauseBeforeQueue: summarizeMessageResult(pauseBeforeQueue),
            selection,
            selectedTargets,
            existingQueueTargets,
            searchTabCleanupsDuringSelection,
            searchTabCleanupAfterSelection,
            queueClicks,
            incrementalEnqueue,
            afterEnqueue: {
                queue: afterEnqueue.summary,
                fullQueue: afterEnqueue.fullSummary,
                authority: afterEnqueue.authority
            },
            restartBeforeStart,
            wakeBeforeStart,
            afterRestartBeforeStart: {
                queue: afterRestartBeforeStart.summary,
                fullQueue: afterRestartBeforeStart.fullSummary,
                authority: afterRestartBeforeStart.authority
            },
            resumePaused: summarizeMessageResult(resumePaused),
            start,
            startSummary: summarizeMessageResult(start),
            terminal: {
                queue: terminalQueue,
                fullQueue: terminalFullQueue,
                authority: terminalAuthority,
                sourceConsistency: authoritativeTerminalSnapshot?.sourceConsistency || null,
                authoritativeSource: authoritativeTerminalSnapshot?.sourceConsistency?.authoritativeSource || '',
                terminalWaitSnapshot: {
                    queue: terminal.summary,
                    fullQueue: terminal.fullSummary,
                    authority: terminal.authority,
                    capturedBeforeDiagnostic: !!authoritativeTerminalSnapshot
                },
                runtimeState: terminal.runtimeState || null,
                stalled: terminal.stalled === true,
                stallReason: terminal.stallReason || '',
                timedOut: terminal.timedOut === true
            },
            terminalSelectedProgressRecords,
            preRestartFlightRecorder,
            terminalFailureDiagnostic: diagnostic?.snapshot || null,
            terminalFailureDiagnosticPath: diagnostic?.artifactPath || '',
            restartAfterTerminal: null,
            wakeAfterTerminal: null,
            afterRestartAfterTerminal: null,
            idleFlightRecorder: null,
            aborted: true,
            abortReason: terminal.stallReason || 'selected-terminal-wait-timeout'
        })
    }
    tracePhase(options, `${phaseLabel} terminal rows observed`, {
        selected: (terminal.summary?.selected || []).map(item => ({
            target: item.targetProfileHref,
            statuses: item.statuses
        }))
    })
    assertSelectedQueueRowsConsistent(terminal.summary, fail, `${phaseLabel} terminal`, {
        requireCompactView: false
    })
    assertSelectedCompactProjectionMaterialized(terminal.summary, fail, `${phaseLabel} terminal compact projection`)
    assertSelectedTerminalOutcomes(terminal.summary, fail, `${phaseLabel} terminal`, {
        allowNamedDurableFailures: mediumBatch
    })
    assertWalPresent(terminal.authority, fail, `${phaseLabel} terminal WAL`)
    assertNoRuntimeActionSurfaceLeak(terminal.authority, fail, `${phaseLabel} terminal`)

    phaseState.currentStep = 'restart-after-terminal'
    tracePhase(options, `${phaseLabel} stopping service worker after terminal`)
    const restartAfterTerminal = await stopExtensionServiceWorker(config, options.extensionId)
    tracePhase(options, `${phaseLabel} waking service worker after terminal`)
    const wakeAfterTerminal = await wakeServiceWorkerWithAccounting(context)
    const afterRestartAfterTerminal = await waitForSelectedTerminalRows(context, fail, selectedTargets, 30000, `${phaseLabel} selected items after terminal restart`, {
        allowViewFallback: !mediumBatch
    })
    tracePhase(options, `${phaseLabel} terminal rows preserved after restart`)
    assertSelectedQueueRowsConsistent(afterRestartAfterTerminal.summary, fail, `${phaseLabel} after terminal service-worker restart`, {
        requireCompactView: false
    })
    assertSelectedCompactProjectionMaterialized(afterRestartAfterTerminal.summary, fail, `${phaseLabel} after terminal restart compact projection`)
    assertSelectedTerminalOutcomes(afterRestartAfterTerminal.summary, fail, `${phaseLabel} after terminal restart`, {
        allowNamedDurableFailures: mediumBatch
    })
    assertWalPresent(afterRestartAfterTerminal.authority, fail, `${phaseLabel} after terminal restart WAL`)
    assertNoRuntimeActionSurfaceLeak(afterRestartAfterTerminal.authority, fail, `${phaseLabel} after terminal restart`)

    let idleFlightRecorder = null
    if(mediumBatch) {
        phaseState.currentStep = 'idle-recorder-check'
        tracePhase(options, `${phaseLabel} waiting for idle flight recorder delta`, {idleMs})
        idleFlightRecorder = await readIdleFlightRecorderDelta(context, idleMs)
        if(idleFlightRecorder.ok !== true || idleFlightRecorder.noisyEntryCount > 0) {
            fail(`${phaseLabel} observed flight-recorder activity while idle after completion`, {
                ok: idleFlightRecorder.ok,
                entryCount: idleFlightRecorder.entryCount,
                noisyEntryCount: idleFlightRecorder.noisyEntryCount,
                entries: idleFlightRecorder.entries
            })
        }
    }

    phaseState.currentStep = 'restoring-preference'
    tracePhase(options, `${phaseLabel} restoring low-concurrency preference`)
    lowConcurrencyPreference.restored = await setStorageValues(context, {profilesPerBatch: previousProfilesPerBatch})
    if(lowConcurrencyPreference.restored?.ok !== true) {
        fail(`${phaseLabel} failed to restore profile-search batch preference`, lowConcurrencyPreference.restored)
    }

    return finishPhase({
        kind: batchKind,
        search: discovery,
        lowConcurrencyPreference,
        beforeQueue,
        beforeSelected,
        beforeAuthority,
        pauseBeforeQueue: summarizeMessageResult(pauseBeforeQueue),
        selection,
        selectedTargets,
        existingQueueTargets,
        searchTabCleanupsDuringSelection,
        searchTabCleanupAfterSelection,
        queueClicks,
        incrementalEnqueue,
        afterEnqueue: {
            queue: afterEnqueue.summary,
            fullQueue: afterEnqueue.fullSummary,
            authority: afterEnqueue.authority
        },
        restartBeforeStart,
        wakeBeforeStart,
        afterRestartBeforeStart: {
            queue: afterRestartBeforeStart.summary,
            fullQueue: afterRestartBeforeStart.fullSummary,
            authority: afterRestartBeforeStart.authority
        },
        resumePaused: summarizeMessageResult(resumePaused),
        start: summarizeMessageResult(start),
        startFull: start,
        terminal: {
            timedOut: terminal.timedOut,
            queue: terminal.summary,
            fullQueue: terminal.fullSummary,
            authority: terminal.authority
        },
        terminalSelectedProgressRecords,
        preRestartFlightRecorder,
        restartAfterTerminal,
        wakeAfterTerminal,
        afterRestartAfterTerminal: {
            queue: afterRestartAfterTerminal.summary,
            fullQueue: afterRestartAfterTerminal.fullSummary,
            authority: afterRestartAfterTerminal.authority
        }
    })
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

function tracePhase(options = {}, message = '', details = null) {
    if(options.verbose !== true) return
    const suffix = details ? ` ${JSON.stringify(details)}` : ''
    console.error(`[upgrade-regression:${options.phase}] ${message}${suffix}`)
}

runMain(async () => {
    const options = parseArgs(process.argv)
    if(options.phase10WatchdogSelfTest === true) {
        const result = runPhase10WatchdogSelfTest()
        const summary = result?.report
            ? {
                ok: result.ok === true,
                drainPass: result.report.drainPass === true,
                qualityPass: result.report.qualityPass === true,
                selectedCounts: result.report.selectedCounts || {},
                queuedRows: result.report.queuedRows || 0,
                activeRows: result.report.activeRows || 0,
                primaryReducerCase: result.report.primaryReducerCase || "",
                firstSelectedNonterminalRow: result.report.firstSelectedNonterminalRow || null
            }
            : result
        console.log(JSON.stringify(options.verbose ? result : summary, null, 2))
        return
    }
    const config = await resolveCdpConfig({
        host: options.host,
        port: options.port,
        extensionId: options.extensionId,
        extensionPath: options.extensionPath,
        extensionVersion: options.extensionVersion || readCurrentVersion()
    })
    options.extensionId = config.extensionId
    options.extensionPath = config.extensionPath || options.extensionPath
    options.extensionVersion = config.extensionVersion || options.extensionVersion
    const expectedVersion = readCurrentVersion()
    const failures = []
    const warnings = []
    const operatorIntervention = []

    const fail = (message, details = null) => failures.push(details ? {message, details} : {message})
    const warn = (message, details = null) => warnings.push(details ? {message, details} : {message})

    await getJson('/json/version', config, 5000).catch(error => {
        throw new Error(`CDP endpoint ${config.host}:${config.port} is not reachable: ${error.message}`)
    })

    const extensionsPage = await ensureExtensionsPage(config, warnings)
    const extensionBefore = await getExtensionInfo(extensionsPage, options.extensionId)
    validateExtensionInfo(extensionBefore, options, expectedVersion, fail)
    if(!extensionBefore) {
        addOperatorIntervention(operatorIntervention, OPERATOR_LOAD_UNPACKED_PROMPT)
        const report = {
            pass: false,
            phase: options.phase,
            profileLabel: options.profileLabel,
            operatorIntervention,
            generatedAt: new Date().toISOString(),
            cdp: {
                host: options.host,
                port: options.port
            },
            extension: null,
            extensionBefore: null,
            expectedVersion,
            storageKeySummary: summarizeStorageKeys([]),
            storageKeySummaryBefore: summarizeStorageKeys([]),
            storageKeySummaryAfter: summarizeStorageKeys([]),
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
            contentRefreshSmoke: null,
            discoverySmoke: null,
            discoveryReloadSmoke: null,
            oneItemQueueSmoke: null,
            smallBatchQueueSmoke: null,
            mediumBatchQueueSmoke: null,
            spaceMarkSmoke: null,
            dashboardAuthoritySmoke: null,
            flightRecorder: null,
            workStateBefore: null,
            workStateAfter: null,
            authorityStateBefore: null,
            authorityStateAfter: null,
            failures,
            warnings
        }
        const comparable = comparableReport(report)
        if(options.writeBaseline) writeJson(options.writeBaseline, {...report, comparable})
        printOperatorInterventions(operatorIntervention)
        console.log(JSON.stringify(options.verbose ? {...report, comparable} : consoleReport(report, comparable), null, 2))
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
    let contentRefreshSmoke = null
    let discoverySmoke = null
    let discoveryReloadSmoke = null
    let oneItemQueueSmoke = null
    let smallBatchQueueSmoke = null
    let mediumBatchQueueSmoke = null
    let spaceMarkSmoke = null
    let dashboardAuthoritySmoke = null
    let flightRecorder = null
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
    else if(options.phase === PHASE6_STALE_CONTENT_REFRESH) {
        contentRefreshSmoke = await runStaleContentRefreshSmoke(config, options, context, warnings, fail)
        await sleep(500)
    }
    else if(options.phase === PHASE7_DISCOVERY_RELOAD) {
        discoveryReloadSmoke = await runDiscoveryReloadStabilitySmoke(config, options, context, warnings, fail)
        await sleep(500)
    }
    else if(options.phase === PHASE8_ONE_ITEM_QUEUE) {
        oneItemQueueSmoke = await runOneItemQueueAuthoritySmoke(config, options, context, warnings, fail)
        await sleep(500)
    }
    else if(options.phase === PHASE9_SMALL_BATCH_QUEUE) {
        smallBatchQueueSmoke = await runSmallBatchQueueAuthoritySmoke(config, options, context, warnings, fail)
        await sleep(500)
    }
    else if(options.phase === PHASE10_MEDIUM_BATCH_QUEUE) {
        mediumBatchQueueSmoke = await runSmallBatchQueueAuthoritySmoke(config, options, context, warnings, fail)
        await sleep(500)
    }

    if(contentSmoke?.page?.quoraLoginLikely ||
            contentRefreshSmoke?.before?.page?.quoraLoginLikely ||
            contentRefreshSmoke?.afterRefresh?.page?.quoraLoginLikely ||
            contentRefreshSmoke?.final?.page?.quoraLoginLikely ||
            discoverySmoke?.pages?.some(page => page?.page?.quoraLoginLikely) ||
            discoveryReloadSmoke?.search?.before?.page?.quoraLoginLikely ||
            discoveryReloadSmoke?.search?.afterReload?.page?.quoraLoginLikely ||
            discoveryReloadSmoke?.spaces?.some(page =>
                page?.before?.page?.quoraLoginLikely || page?.afterReload?.page?.quoraLoginLikely) ||
            oneItemQueueSmoke?.search?.page?.quoraLoginLikely ||
            smallBatchQueueSmoke?.search?.page?.quoraLoginLikely ||
            mediumBatchQueueSmoke?.search?.page?.quoraLoginLikely ||
            spaceMarkSmoke?.before?.page?.quoraLoginLikely ||
            spaceMarkSmoke?.reloaded?.page?.quoraLoginLikely) {
        addOperatorIntervention(operatorIntervention, OPERATOR_QUORA_LOGIN_PROMPT)
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

    if(alarmNames.some(name => new RegExp("repair|" + LEGACY_REPAIR_ALARM_NAME + "|" + LEGACY_IMPORT_CAMEL + "|" + IMPORT_LEGACY_CAMEL, "i").test(name))) {
        fail('legacy repair/import alarm is visible', alarmNames.filter(name => new RegExp("repair|" + LEGACY_REPAIR_ALARM_NAME + "|" + LEGACY_IMPORT_CAMEL + "|" + IMPORT_LEGACY_CAMEL, "i").test(name)))
    }

    if(!isWorkProducingPhase(options.phase) &&
            (workStateAfter.rawActiveLike > workStateBefore.rawActiveLike ||
            workStateAfter.rawQueuedLike > workStateBefore.rawQueuedLike ||
            workStateAfter.viewActiveLike > workStateBefore.viewActiveLike ||
            workStateAfter.viewQueuedLike > workStateBefore.viewQueuedLike)) {
        fail(`${options.phase} appears to have started or queued work`, {
            before: workStateBefore,
            after: workStateAfter
        })
    }
    if(isNonWorkSpaceRegistryPhase(options.phase) ||
            options.phase === PHASE5_DASHBOARD_AUTHORITY ||
            options.phase === PHASE6_STALE_CONTENT_REFRESH) {
        assertDiscoveryDidNotCreateAuthority(authorityStateBefore, authorityStateAfter, fail)
    }

    if(isWorkProducingPhase(options.phase) &&
            (failures.length || options.includeFlightRecorder === true)) {
        flightRecorder = smallBatchQueueSmoke?.preRestartFlightRecorder ||
            mediumBatchQueueSmoke?.preRestartFlightRecorder ||
            oneItemQueueSmoke?.preRestartFlightRecorder ||
            await readFlightRecorder(context, {limit: PHASE10_FLIGHT_RECORDER_LIMIT})
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
        operatorIntervention,
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
        storageKeySummary: summarizeStorageKeys(storageAfter.keys),
        storageKeySummaryBefore: summarizeStorageKeys(storageBefore.keys),
        storageKeySummaryAfter: summarizeStorageKeys(storageAfter.keys),
        storageKeyDelta,
        allowedAddedStorageKeys: allowedAddedStorageKeySummary(options.phase),
        alarms,
        legacyActions: legacyActionSummary,
        reconcileDisplayOnly: reconcileDisplayOnlySummary,
        currentActions: currentActionSummary,
        contentSmoke,
        contentRefreshSmoke,
        discoverySmoke,
        discoveryReloadSmoke,
        oneItemQueueSmoke,
        smallBatchQueueSmoke,
        mediumBatchQueueSmoke,
        spaceMarkSmoke,
        dashboardAuthoritySmoke,
        flightRecorder,
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
    else if(options.phase === PHASE10_MEDIUM_BATCH_QUEUE) {
        const reportArtifactPath = defaultBaselinePath(options.profileLabel, options.phase)
        writeJson(reportArtifactPath, {
            ...report,
            comparable
        })
        report.reportArtifactPath = reportArtifactPath
    }

    if(options.verbose) report.comparable = comparable

    report.pass = failures.length === 0
    printOperatorInterventions(operatorIntervention)
    console.log(JSON.stringify(options.verbose ? report : consoleReport(report, comparable), null, 2))
    if(!report.pass) process.exitCode = 1
})
