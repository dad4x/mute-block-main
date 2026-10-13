#!/usr/bin/env node

const {
    evaluate,
    getCdpConfig,
    getOption,
    getTargets,
    runMain
} = require('./lib/cdp')

runMain(async () => {
    const config = getCdpConfig()
    const profileUrl = getOption('url', 'https://www.quora.com/profile/Elon-Musk-1909')
    const mode = getOption('mode', 'create-active')
    const closeWorker = getOption('close', 'false') === 'true'
    const closeWindowId = Number.parseInt(getOption('close-window-id', '0'), 10) || 0
    const dashboardUrl = `chrome-extension://${config.extensionId}/coordinator.html`
    const targets = await getTargets(config)
    const extensionPage = targets.find(target => target.type === 'page' && target.url === dashboardUrl) ||
        targets.find(target => target.type === 'page' && (target.url || '').startsWith(`chrome-extension://${config.extensionId}/`))

    if(!extensionPage) {
        console.log(JSON.stringify({extensionPage: false}, null, 2))
        process.exitCode = 1
        return
    }

    const result = await evaluate(extensionPage.webSocketDebuggerUrl, `(${async function probe(profileUrl, dashboardUrl, mode, closeWorker, closeWindowId) {
        const sleep = ms => new Promise(resolve => setTimeout(resolve, ms))
        if(closeWindowId) {
            await chrome.windows.remove(closeWindowId).catch(() => null)
            return {closedWindowId: closeWindowId}
        }
        const getLastFocused = () => chrome.windows.getLastFocused({populate: true})
        const getWindow = id => chrome.windows.get(id, {populate: true}).catch(error => ({
            id,
            missing: true,
            error: error?.message || String(error || '')
        }))
        const snapshotWindow = win => ({
            id: win?.id || 0,
            focused: win?.focused === true,
            state: win?.state || '',
            type: win?.type || '',
            tabs: Array.isArray(win?.tabs)
                ? win.tabs.map(tab => ({
                    id: tab.id,
                    active: tab.active === true,
                    highlighted: tab.highlighted === true,
                    title: tab.title || '',
                    url: tab.url || ''
                }))
                : []
        })
        const snapshotFocus = async (label, originalId, workerId) => {
            const lastFocused = await getLastFocused().catch(error => ({
                error: error?.message || String(error || '')
            }))
            const original = originalId ? await getWindow(originalId) : null
            const worker = workerId ? await getWindow(workerId) : null
            return {
                label,
                lastFocused: snapshotWindow(lastFocused),
                original: snapshotWindow(original),
                worker: snapshotWindow(worker)
            }
        }

        const original = await getLastFocused()
        const before = await snapshotFocus('before', original.id, 0)
        const worker = await chrome.windows.create({
            url: dashboardUrl,
            focused: true,
            type: 'normal',
            width: 980,
            height: 720,
            left: 80,
            top: 80
        })
        await sleep(500)
        const afterCreate = await snapshotFocus('after-create', original.id, worker.id)
        await chrome.windows.update(original.id, {focused: true}).catch(() => null)
        await sleep(500)
        const afterRestoreOriginal = await snapshotFocus('after-restore-original', original.id, worker.id)
        const tab = await chrome.tabs.create({
            windowId: worker.id,
            url: profileUrl,
            active: mode !== 'create-inactive-then-update-active'
        })
        await sleep(1000)
        const afterWorkerTabOpen = await snapshotFocus(
            mode === 'create-inactive-then-update-active'
                ? 'after-worker-inactive-tab-open'
                : 'after-worker-active-tab-open',
            original.id,
            worker.id
        )
        if(mode === 'create-inactive-then-update-active') {
            await chrome.tabs.update(tab.id, {active: true}).catch(() => null)
            await sleep(1000)
        }
        const afterWorkerActiveTabOpen = mode === 'create-inactive-then-update-active'
            ? await snapshotFocus('after-worker-tab-update-active', original.id, worker.id)
            : afterWorkerTabOpen

        if(closeWorker) {
            await chrome.windows.remove(worker.id).catch(() => null)
            await sleep(250)
            await chrome.windows.update(original.id, {focused: true}).catch(() => null)
        }

        return {
            profileUrl,
            mode,
            originalWindowId: original.id,
            workerWindowId: worker.id,
            workerTabId: tab.id,
            closedWorker: closeWorker,
            focusStayedOnOriginalAfterWorkerTabOpen: afterWorkerActiveTabOpen.lastFocused.id === original.id &&
                afterWorkerActiveTabOpen.original.focused === true &&
                afterWorkerActiveTabOpen.worker.focused === false,
            snapshots: [
                before,
                afterCreate,
                afterRestoreOriginal,
                afterWorkerTabOpen,
                afterWorkerActiveTabOpen
            ]
        }
    }})( ${JSON.stringify(profileUrl)}, ${JSON.stringify(dashboardUrl)}, ${JSON.stringify(mode)}, ${JSON.stringify(closeWorker)}, ${JSON.stringify(closeWindowId)} )`, 30000)

    console.log(JSON.stringify(result, null, 2))
})
