const browser = require('webextension-polyfill')
const defaults = require('./defaults')
const {
    MAX_REMEMBERED_NUKED_POSTS_KEY,
    NUKED_POST_RETENTION_DAYS_KEY,
    SPACE_NUKED_POSTS_KEY,
    getPrunedNukedPosts,
    haveSameNukedPostKeys,
    normalizeMaxRememberedNukedPosts,
    normalizeRetentionDays
} = require('./nukedPosts')
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
    const settings = await browser.storage.local.get({
        ...defaults,
        [SPACE_REGISTRY_KEY]: {},
        [SPACE_SORT_KEY]: SPACE_SORT_NAME,
        [SPACE_NUKED_POSTS_KEY]: {}
    })

    document.getElementById('appName').textContent = manifest.name
    document.getElementById('appVersion').textContent = `v${manifest.version}`
    document.getElementById('closePopup').addEventListener('click', () => window.close())

    const form = document.getElementById('settingsForm')
    const status = document.getElementById('status')
    const spaceSortBy = document.getElementById('spaceSortBy')
    const spaceList = document.getElementById('spaceList')
    const clearNukedPosts = document.getElementById('clearNukedPosts')
    const nukedPostCount = document.getElementById('nukedPostCount')

    const fopDelay = document.getElementById('fopDelay')
    const flipToAnswers = document.getElementById('flipToAnswers')
    const fopFlipDelay = document.getElementById('fopFlipDelay')
    const profilesPerBatch = document.getElementById('profilesPerBatch')
    const nukedPostRetentionDays = document.getElementById('nukedPostRetentionDays')
    const maxRememberedNukedPosts = document.getElementById('maxRememberedNukedPosts')

    fopDelay.value = settings.fopDelay
    flipToAnswers.checked = settings.flipToAnswers
    fopFlipDelay.value = settings.fopFlipDelay
    profilesPerBatch.value = settings.profilesPerBatch
    popupState.nukedPostRetentionDays = normalizeRetentionDays(settings[NUKED_POST_RETENTION_DAYS_KEY], defaults[NUKED_POST_RETENTION_DAYS_KEY])
    popupState.maxRememberedNukedPosts = normalizeMaxRememberedNukedPosts(settings[MAX_REMEMBERED_NUKED_POSTS_KEY], defaults[MAX_REMEMBERED_NUKED_POSTS_KEY])
    nukedPostRetentionDays.value = popupState.nukedPostRetentionDays
    maxRememberedNukedPosts.value = popupState.maxRememberedNukedPosts
    popupState.spaceRegistry = settings[SPACE_REGISTRY_KEY] || {}
    popupState.nukedPosts = getPrunedNukedPosts(settings[SPACE_NUKED_POSTS_KEY] || {}, {
        retentionDays: popupState.nukedPostRetentionDays,
        maxEntries: popupState.maxRememberedNukedPosts
    })
    popupState.sortBy = settings[SPACE_SORT_KEY] === SPACE_SORT_CATEGORY ? SPACE_SORT_CATEGORY : SPACE_SORT_NAME
    spaceSortBy.value = popupState.sortBy
    renderNukedPostCount(nukedPostCount)

    if(!haveSameNukedPostKeys(settings[SPACE_NUKED_POSTS_KEY] || {}, popupState.nukedPosts)) {
        await browser.storage.local.set({[SPACE_NUKED_POSTS_KEY]: popupState.nukedPosts})
    }

    form.addEventListener('submit', async event => {
        event.preventDefault()

        const nextSettings = {
            fopDelay: fopDelay.valueAsNumber,
            flipToAnswers: flipToAnswers.checked,
            fopFlipDelay: fopFlipDelay.valueAsNumber,
            profilesPerBatch: profilesPerBatch.valueAsNumber,
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
        renderNukedPostCount(nukedPostCount)

        await browser.storage.local.set({
            ...nextSettings,
            [SPACE_NUKED_POSTS_KEY]: popupState.nukedPosts
        })
        showStatus(status, 'Settings saved.')
    })

    form.addEventListener('reset', async () => {
        await browser.storage.local.set(defaults)

        fopDelay.value = defaults.fopDelay
        flipToAnswers.checked = defaults.flipToAnswers
        fopFlipDelay.value = defaults.fopFlipDelay
        profilesPerBatch.value = defaults.profilesPerBatch
        popupState.nukedPostRetentionDays = defaults[NUKED_POST_RETENTION_DAYS_KEY]
        popupState.maxRememberedNukedPosts = defaults[MAX_REMEMBERED_NUKED_POSTS_KEY]
        nukedPostRetentionDays.value = popupState.nukedPostRetentionDays
        maxRememberedNukedPosts.value = popupState.maxRememberedNukedPosts
        popupState.nukedPosts = getPrunedNukedPosts(popupState.nukedPosts, {
            retentionDays: popupState.nukedPostRetentionDays,
            maxEntries: popupState.maxRememberedNukedPosts
        })
        renderNukedPostCount(nukedPostCount)
        await browser.storage.local.set({[SPACE_NUKED_POSTS_KEY]: popupState.nukedPosts})

        showStatus(status, 'Settings reset.')
    })

    spaceSortBy.addEventListener('change', async () => {
        popupState.sortBy = spaceSortBy.value === SPACE_SORT_CATEGORY ? SPACE_SORT_CATEGORY : SPACE_SORT_NAME
        renderSpaceList(spaceList)
        await browser.storage.local.set({[SPACE_SORT_KEY]: popupState.sortBy})
    })

    spaceList.addEventListener('click', event => {
        const button = event.target.closest('button[data-space-key][data-category]')
        if(!button) return

        event.preventDefault()
        void updateSpaceCategory(button.dataset.spaceKey, button.dataset.category, spaceList)
    })

    clearNukedPosts.addEventListener('click', async () => {
        const count = Object.keys(popupState.nukedPosts || {}).length
        if(!count) {
            showStatus(status, 'Nothing to clear.')
            return
        }

        if(!window.confirm(`Clear remembered nuke state for ${count} posts?`)) {
            return
        }

        popupState.nukedPosts = {}
        renderNukedPostCount(nukedPostCount)
        await browser.storage.local.set({[SPACE_NUKED_POSTS_KEY]: {}})
        showStatus(status, 'Remembered nukes cleared.')
    })

    browser.storage.onChanged.addListener(changes => {
        if(changes[SPACE_REGISTRY_KEY]) {
            popupState.spaceRegistry = changes[SPACE_REGISTRY_KEY].newValue || {}
            renderSpaceList(spaceList)
        }

        if(changes[SPACE_SORT_KEY]) {
            popupState.sortBy = changes[SPACE_SORT_KEY].newValue === SPACE_SORT_CATEGORY ? SPACE_SORT_CATEGORY : SPACE_SORT_NAME
            spaceSortBy.value = popupState.sortBy
            renderSpaceList(spaceList)
        }

        if(changes[SPACE_NUKED_POSTS_KEY]) {
            popupState.nukedPosts = changes[SPACE_NUKED_POSTS_KEY].newValue || {}
            renderNukedPostCount(nukedPostCount)
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

function renderNukedPostCount(element) {
    const count = Object.keys(popupState.nukedPosts || {}).length
    element.textContent = `${count} remembered post${count === 1 ? '' : 's'}`
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
    await browser.storage.local.set({[SPACE_REGISTRY_KEY]: popupState.spaceRegistry})
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
