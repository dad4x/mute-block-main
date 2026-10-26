const browser = require('webextension-polyfill')
const defaults = require('./defaults')
const {namespaceArea, namespaceChanges} = require('./storageNamespace')
const { setMuteBlockHelp } = require('./muteBlockHelp')
const {
    MAX_REMEMBERED_NUKED_POSTS_KEY,
    NUKED_POST_RETENTION_DAYS_KEY,
    SPACE_NUKED_POSTS_KEY,
    getPrunedNukedPosts,
    haveSameNukedPostKeys,
    normalizeMaxRememberedNukedPosts,
    normalizeRetentionDays
} = require('./nukedPosts')
const {isSpaceMapStorageKey, readSpaceMapFromStored, spaceMapStorageReadDefaults} = require('./spaceMapStorage')
const {
    SPACE_CATEGORIES,
    SPACE_REGISTRY_KEY,
    SPACE_SORT_CATEGORY,
    SPACE_SORT_KEY,
    SPACE_SORT_NAME,
    buildSpaceRecord,
    getSpaceCategoryShortLabel,
    sortSpaceRecords
} = require('./spaceRegistry')

const popupState = {
    sortBy: SPACE_SORT_NAME,
    spaceRegistry: {},
    nukedPosts: {},
    nukedPostRetentionDays: defaults[NUKED_POST_RETENTION_DAYS_KEY],
    maxRememberedNukedPosts: defaults[MAX_REMEMBERED_NUKED_POSTS_KEY]
}

addEventListener('load', init)

async function init() {
    const manifest = browser.runtime.getManifest()
    const settings = await namespaceArea(browser.storage.local).get({
        ...defaults,
        [SPACE_REGISTRY_KEY]: {},
        [SPACE_SORT_KEY]: SPACE_SORT_NAME,
        ...spaceMapStorageReadDefaults([SPACE_NUKED_POSTS_KEY])
    })
    const storedNukedPosts = readSpaceMapFromStored(settings, SPACE_NUKED_POSTS_KEY)

    document.getElementById('appName').textContent = manifest.name
    document.getElementById('appVersion').textContent = `v${manifest.version}`
    document.getElementById('closePopup').addEventListener('click', () => window.close())

    const form = document.getElementById('settingsForm')
    const status = document.getElementById('status')
    const spaceSortBy = document.getElementById('spaceSortBy')
    const spaceList = document.getElementById('spaceList')
    const openCoordinator = document.getElementById('openCoordinator')
    const openHistory = document.getElementById('openHistory')

    const fopDelay = document.getElementById('fopDelay')
    const flipToAnswers = document.getElementById('flipToAnswers')
    const fopFlipDelay = document.getElementById('fopFlipDelay')
    const coordinatorAutoStartOnBrowserStart = document.getElementById('coordinatorAutoStartOnBrowserStart')
    const profilesPerBatch = document.getElementById('profilesPerBatch')
    const workerWindowForegroundMode = document.getElementById('workerWindowForegroundMode')
    const nukedPostRetentionDays = document.getElementById('nukedPostRetentionDays')
    const maxRememberedNukedPosts = document.getElementById('maxRememberedNukedPosts')

    fopDelay.value = settings.fopDelay
    flipToAnswers.checked = settings.flipToAnswers
    fopFlipDelay.value = settings.fopFlipDelay
    coordinatorAutoStartOnBrowserStart.checked = settings.coordinatorAutoStartOnBrowserStart === true
    profilesPerBatch.value = settings.profilesPerBatch
    workerWindowForegroundMode.value = settings.workerWindowForegroundMode
    popupState.nukedPostRetentionDays = normalizeRetentionDays(settings[NUKED_POST_RETENTION_DAYS_KEY], defaults[NUKED_POST_RETENTION_DAYS_KEY])
    popupState.maxRememberedNukedPosts = normalizeMaxRememberedNukedPosts(settings[MAX_REMEMBERED_NUKED_POSTS_KEY], defaults[MAX_REMEMBERED_NUKED_POSTS_KEY])
    nukedPostRetentionDays.value = popupState.nukedPostRetentionDays
    maxRememberedNukedPosts.value = popupState.maxRememberedNukedPosts
    popupState.spaceRegistry = settings[SPACE_REGISTRY_KEY] || {}
    popupState.nukedPosts = getPrunedNukedPosts(storedNukedPosts, {
        retentionDays: popupState.nukedPostRetentionDays,
        maxEntries: popupState.maxRememberedNukedPosts
    })
    popupState.sortBy = settings[SPACE_SORT_KEY] === SPACE_SORT_CATEGORY ? SPACE_SORT_CATEGORY : SPACE_SORT_NAME
    spaceSortBy.value = popupState.sortBy

    if(!haveSameNukedPostKeys(storedNukedPosts, popupState.nukedPosts)) {
        await browser.runtime.sendMessage({action: 'set-space-nuked-posts', nukedPosts: popupState.nukedPosts})
    }

    form.addEventListener('submit', async event => {
        event.preventDefault()

        const nextSettings = {
            fopDelay: fopDelay.valueAsNumber,
            flipToAnswers: flipToAnswers.checked,
            fopFlipDelay: fopFlipDelay.valueAsNumber,
            coordinatorAutoStartOnBrowserStart: coordinatorAutoStartOnBrowserStart.checked,
            profilesPerBatch: profilesPerBatch.valueAsNumber,
            workerWindowForegroundMode: workerWindowForegroundMode.value,
            [NUKED_POST_RETENTION_DAYS_KEY]: normalizeRetentionDays(nukedPostRetentionDays.valueAsNumber, defaults[NUKED_POST_RETENTION_DAYS_KEY]),
            [MAX_REMEMBERED_NUKED_POSTS_KEY]: normalizeMaxRememberedNukedPosts(maxRememberedNukedPosts.valueAsNumber, defaults[MAX_REMEMBERED_NUKED_POSTS_KEY])
        }

        popupState.nukedPostRetentionDays = nextSettings[NUKED_POST_RETENTION_DAYS_KEY]
        popupState.maxRememberedNukedPosts = nextSettings[MAX_REMEMBERED_NUKED_POSTS_KEY]
        popupState.nukedPosts = getPrunedNukedPosts(popupState.nukedPosts, {
            retentionDays: popupState.nukedPostRetentionDays,
            maxEntries: popupState.maxRememberedNukedPosts
        })
        nukedPostRetentionDays.value = popupState.nukedPostRetentionDays
        maxRememberedNukedPosts.value = popupState.maxRememberedNukedPosts

        // The worker owns every write. Settings and nuked posts both go through it.
        const settingsResult = await browser.runtime.sendMessage({action: 'set-extension-settings', settings: nextSettings})
        await browser.runtime.sendMessage({action: 'set-space-nuked-posts', nukedPosts: popupState.nukedPosts})
        // review-3 R3-2: an empty number field arrives as NaN, which the worker does not save. Say so instead of "saved".
        const rejectedSettings = Array.isArray(settingsResult?.rejected) ? settingsResult.rejected : []
        showStatus(status, rejectedSettings.length
            ? `Settings saved, except ${rejectedSettings.join(', ')} (empty or invalid).`
            : 'Settings saved.')
    })

    form.addEventListener('reset', async () => {
        await browser.runtime.sendMessage({action: 'set-extension-settings', settings: defaults})

        fopDelay.value = defaults.fopDelay
        flipToAnswers.checked = defaults.flipToAnswers
        fopFlipDelay.value = defaults.fopFlipDelay
        coordinatorAutoStartOnBrowserStart.checked = defaults.coordinatorAutoStartOnBrowserStart === true
        profilesPerBatch.value = defaults.profilesPerBatch
        workerWindowForegroundMode.value = defaults.workerWindowForegroundMode
        popupState.nukedPostRetentionDays = defaults[NUKED_POST_RETENTION_DAYS_KEY]
        popupState.maxRememberedNukedPosts = defaults[MAX_REMEMBERED_NUKED_POSTS_KEY]
        nukedPostRetentionDays.value = popupState.nukedPostRetentionDays
        maxRememberedNukedPosts.value = popupState.maxRememberedNukedPosts
        popupState.nukedPosts = getPrunedNukedPosts(popupState.nukedPosts, {
            retentionDays: popupState.nukedPostRetentionDays,
            maxEntries: popupState.maxRememberedNukedPosts
        })
        await browser.runtime.sendMessage({action: 'set-space-nuked-posts', nukedPosts: popupState.nukedPosts})

        showStatus(status, 'Settings reset.')
    })

    spaceSortBy.addEventListener('change', async () => {
        popupState.sortBy = spaceSortBy.value === SPACE_SORT_CATEGORY ? SPACE_SORT_CATEGORY : SPACE_SORT_NAME
        renderSpaceList(spaceList)
        await browser.runtime.sendMessage({action: 'set-space-sort', sortBy: popupState.sortBy})
    })

    spaceList.addEventListener('click', event => {
        const button = event.target.closest('button[data-space-key][data-category]')
        if(!button) return

        event.preventDefault()
        void updateSpaceCategory(button.dataset.spaceKey, button.dataset.category, spaceList)
    })

    openCoordinator?.addEventListener('click', async () => {
        // The popup isn't a tab, so the service worker's message sender has
        // no sender.tab.windowId to fall back on -- send our own window id
        // explicitly so the dashboard opens/moves to the window this button
        // was actually pressed in, rather than wherever an existing
        // dashboard tab happens to already be.
        const currentWindow = await browser.windows.getCurrent().catch(() => null)
        const result = await browser.runtime.sendMessage({
            action: 'open-coordinator',
            active: true,
            windowId: currentWindow?.id || null
        }).catch(error => ({error: error?.message || `${error || ''}`}))

        showStatus(status, result?.error ? 'Dashboard open failed.' : 'Dashboard opened.')
    })

    openHistory?.addEventListener('click', async () => {
        const currentWindow = await browser.windows.getCurrent().catch(() => null)
        const result = await browser.runtime.sendMessage({
            action: 'open-coordinator-history',
            active: true,
            windowId: currentWindow?.id || null
        }).catch(error => ({error: error?.message || `${error || ''}`}))

        showStatus(status, result?.error ? 'History open failed.' : 'History opened.')
    })

    browser.storage.onChanged.addListener(storedChanges => {
        const changes = namespaceChanges(storedChanges)
        if(!changes) return
        if(changes[SPACE_REGISTRY_KEY]) {
            popupState.spaceRegistry = changes[SPACE_REGISTRY_KEY].newValue || {}
            renderSpaceList(spaceList)
        }

        if(changes[SPACE_SORT_KEY]) {
            popupState.sortBy = changes[SPACE_SORT_KEY].newValue === SPACE_SORT_CATEGORY ? SPACE_SORT_CATEGORY : SPACE_SORT_NAME
            spaceSortBy.value = popupState.sortBy
            renderSpaceList(spaceList)
        }

        if(Object.keys(changes).some(key => isSpaceMapStorageKey(key, [SPACE_NUKED_POSTS_KEY]))) {
            void namespaceArea(browser.storage.local).get(spaceMapStorageReadDefaults([SPACE_NUKED_POSTS_KEY])).then(stored => {
                popupState.nukedPosts = readSpaceMapFromStored(stored, SPACE_NUKED_POSTS_KEY)
            })
        }

        if(changes[NUKED_POST_RETENTION_DAYS_KEY]) {
            popupState.nukedPostRetentionDays = normalizeRetentionDays(changes[NUKED_POST_RETENTION_DAYS_KEY].newValue, defaults[NUKED_POST_RETENTION_DAYS_KEY])
            nukedPostRetentionDays.value = popupState.nukedPostRetentionDays
        }

        if(changes[MAX_REMEMBERED_NUKED_POSTS_KEY]) {
            popupState.maxRememberedNukedPosts = normalizeMaxRememberedNukedPosts(changes[MAX_REMEMBERED_NUKED_POSTS_KEY].newValue, defaults[MAX_REMEMBERED_NUKED_POSTS_KEY])
            maxRememberedNukedPosts.value = popupState.maxRememberedNukedPosts
        }
    })

    renderSpaceList(spaceList)
}

function showStatus(element, message) {
    element.textContent = message
    element.hidden = false

    clearTimeout(showStatus.timeoutId)
    showStatus.timeoutId = setTimeout(() => {
        element.hidden = true
        element.textContent = ''
    }, 1200)
}

async function updateSpaceCategory(spaceKey, category, container) {
    const existingRecord = popupState.spaceRegistry?.[spaceKey]
    if(!existingRecord) return

    const nextRecord = buildSpaceRecord(existingRecord, category, existingRecord)
    if(!nextRecord) return

    popupState.spaceRegistry = {
        ...popupState.spaceRegistry,
        [spaceKey]: nextRecord
    }

    renderSpaceList(container)
    await browser.runtime.sendMessage({action: 'set-space-registry', spaceRegistry: popupState.spaceRegistry})
}

function renderSpaceList(container) {
    const records = sortSpaceRecords(Object.values(popupState.spaceRegistry || {}), popupState.sortBy)
    container.innerHTML = ''

    if(!records.length) {
        const empty = document.createElement('div')
        empty.className = 'space-empty'
        empty.textContent = 'No spaces have been categorized yet.'
        container.appendChild(empty)
        return
    }

    const fragment = document.createDocumentFragment()

    for(const record of records) {
        const row = document.createElement('article')
        row.className = 'space-item'

        const meta = document.createElement('div')
        meta.className = 'space-item-meta'

        const top = document.createElement('div')
        top.className = 'space-item-top'

        const name = document.createElement('div')
        name.className = 'space-item-name'
        name.textContent = record.name || record.slug || record.url

        const category = document.createElement('span')
        category.className = `space-item-category space-item-category--${record.category || 'unknown'}`
        category.textContent = getSpaceCategoryShortLabel(record.category)

        top.appendChild(name)
        top.appendChild(category)

        const link = document.createElement('a')
        link.className = 'space-item-link'
        link.href = record.url
        link.target = '_blank'
        link.rel = 'noreferrer'
        link.textContent = record.slug || record.url

        meta.appendChild(top)
        meta.appendChild(link)

        const controls = document.createElement('div')
        controls.className = 'popup-space-segmented'

        for(const option of SPACE_CATEGORIES) {
            const button = document.createElement('button')
            const isActive = option === record.category

            button.type = 'button'
            button.className = 'popup-space-button'
            button.dataset.spaceKey = record.key
            button.dataset.category = option
            button.dataset.active = isActive ? 'true' : 'false'
            button.setAttribute('aria-pressed', isActive ? 'true' : 'false')
            button.textContent = getSpaceCategoryShortLabel(option)
            setMuteBlockHelp(button, `Set this space to ${getSpaceCategoryShortLabel(option)}`)

            if(isActive) {
                button.classList.add('popup-space-button--active', `popup-space-button--${option}`)
            }

            controls.appendChild(button)
        }

        row.appendChild(meta)
        row.appendChild(controls)
        fragment.appendChild(row)
    }

    container.appendChild(fragment)
}

// Erase block history, the last-gasp reset. The worker pauses the queue, does the erase, refuses it while work is still running, and reloads the extension.
const ERASE_BLOCK_HISTORY_PHRASE = 'ERASE'
const ERASE_REFUSAL_MESSAGES = {
    'confirmation-mismatch': `Type ${ERASE_BLOCK_HISTORY_PHRASE} exactly to erase.`,
    'authority-not-loaded': 'The queue is still loading. Try again in a moment.',
    'queue-row-active': 'A profile is still being processed after the pause. Wait a moment, then erase again.'
}
const eraseConfirmInput = document.getElementById('eraseConfirm')
const eraseBlockHistoryButton = document.getElementById('eraseBlockHistoryButton')
const eraseStatus = document.getElementById('eraseStatus')
// Owner, 23 Oct: the button is never dimmed, so a click without the phrase puts the cursor into the confirmation box and says why.
eraseBlockHistoryButton?.addEventListener('click', async () => {
    if(eraseConfirmInput?.value !== ERASE_BLOCK_HISTORY_PHRASE) {
        eraseConfirmInput?.focus()
        if(eraseStatus) {
            eraseStatus.hidden = false
            eraseStatus.textContent = ERASE_REFUSAL_MESSAGES['confirmation-mismatch']
        }
        return
    }
    eraseBlockHistoryButton.disabled = true
    const result = await browser.runtime.sendMessage({action: 'erase-block-history', confirmation: eraseConfirmInput.value})
        .catch(error => ({erased: false, reason: 'message-failed', detail: error?.message || ''}))
    if(eraseStatus) {
        eraseStatus.hidden = false
        eraseStatus.textContent = result?.scheduled
            ? 'Erase scheduled. The extension is reloading, which stops its worker; the erase runs as it starts.'
            : `Not erased. ${ERASE_REFUSAL_MESSAGES[result?.reason] || 'Something went wrong. Nothing was erased.'}`
    }
    if(!result?.scheduled) eraseBlockHistoryButton.disabled = false
})
