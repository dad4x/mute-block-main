const browser = require('webextension-polyfill')
const defaults = require('./defaults')

let profilesModalTimeout
let profileButtonsTimeout
let profileButtonsRefreshTimeout
let profileButtonsPending = false
let profileActionInProgress = false
let profileButtonsFollowUpTimeouts = []
let autoProfileAction = undefined
let autoProfileActionPending = false
let autoProfileActionAttempts = 0
let profileBlockMutationCount = 0
let profileBlockHintKey = null
let profileBlockHintAt = 0
let originalPosterRedirectPending = false
let originalPosterRedirectAttempts = 0
let originalPosterRedirectTimeout = null
let questionPageBtnTimeout
let questionPageBtnPending = false
let questionPageFollowUpTimeouts = []
let spacePostBtnTimeout
let spacePostBtnPending = false
let spacePostFollowUpTimeouts = []
let closeTabRetryTimeouts = []
let blockedCloseCheckTimeouts = []
let currentUrl = location.href
let settings = {...defaults}
let activeProfileModal = null
let handledModalProfileUrls = new Set()
let initialized = false
const PROFILE_ACTION_BUTTON_ORDER = ['mute-block-close', 'mute-block', 'close-tab']
const SPACE_POST_NUKE_MIN_PROFILES = 2

addEventListener('unhandledrejection', event => {
    if(isExtensionContextInvalidatedError(event.reason) || isRuntimeConnectionError(event.reason)) {
        event.preventDefault()
    }
})

addEventListener('pagehide', clearCloseTabFollowUps)
addEventListener('beforeunload', clearCloseTabFollowUps)
addEventListener('pagehide', clearBlockedCloseChecks)
addEventListener('beforeunload', clearBlockedCloseChecks)

if(document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => void init(), {once: true})
}
else {
    void init()
}

async function init() {
    if(initialized) return
    initialized = true

    const bodyReady = document.body || await waitForCondition(() => !!document.body, 5000, 25)
    if(!bodyReady || !document.body) return

    settings = await safeStorageGet(defaults)
    browser.runtime.onMessage.addListener(onMessage)
    browser.storage.onChanged.addListener(onStorageChanged)
    installNavigationHooks()

    const page = getPageType()

    if(page === 'profile') {
        ensureProfileButtons()
        scheduleProfileButtonsFollowUps()
        void maybeRunAutoProfileAction()
    }
    else if(page === 'question-log') {
        scheduleOriginalPosterRedirect()
    }
    else if(page === 'question') {
        ensureQuestionPageFOPBtn()
        scheduleQuestionPageFollowUps()
    }
    else if(page === 'space-post') {
        scheduleSpacePostNukeBtn()
        scheduleSpacePostFollowUps()
    }
    else if(page === 'space') {
        injectSpaceSidebarOpenProfilesBtn()
    }

    startObserver()
}

function onStorageChanged(changes, areaName) {
    if(areaName !== 'local') return

    for(const [key, change] of Object.entries(changes)) {
        if(Object.prototype.hasOwnProperty.call(defaults, key)) {
            settings[key] = change.newValue
        }
    }
}

function isExtensionContextInvalidatedError(error) {
    const message = `${error?.message || error || ''}`
    return /Extension context invalidated/i.test(message)
}

function isRuntimeConnectionError(error) {
    const message = `${error?.message || error || ''}`
    return /Receiving end does not exist|Could not establish connection|message channel closed before a response was received/i.test(message)
}

async function safeStorageGet(fallback) {
    try {
        return await browser.storage.local.get(fallback)
    }
    catch(error) {
        if(isExtensionContextInvalidatedError(error)) return {...fallback}
        throw error
    }
}

async function safeSendRuntimeMessage(message, fallback = null) {
    try {
        return await browser.runtime.sendMessage(message)
    }
    catch(error) {
        if(isExtensionContextInvalidatedError(error) || isRuntimeConnectionError(error)) return fallback
        throw error
    }
}

async function notifyQueuedTabComplete() {
    const result = await safeSendRuntimeMessage({action: 'release-tab-slot'}, null)
    return !!result?.released
}

async function sweepBlockedProfileTabs() {
    const result = await safeSendRuntimeMessage({action: 'sweep-owned-blocked-profile-tabs'}, null)
    return {
        owned: Number.parseInt(result?.owned, 10) || 0,
        signaled: Number.parseInt(result?.signaled, 10) || 0
    }
}

async function getOwnedNukeStatus() {
    const result = await safeSendRuntimeMessage({action: 'get-owned-nuke-status'}, null)
    return {
        active: Number.parseInt(result?.active, 10) || 0,
        owned: Number.parseInt(result?.owned, 10) || 0,
        queued: Number.parseInt(result?.queued, 10) || 0
    }
}

function formatNukeProgressLabel(label, status = null) {
    if(!status) return label
    return `${label} [t:${status.owned} a:${status.active} q:${status.queued}]`
}

async function waitForOwnedNukeTabsToDrain(button, timeoutMs = 180000, intervalMs = 1000) {
    const startedAt = Date.now()
    let nextSweepAt = 0

    while(Date.now() - startedAt < timeoutMs) {
        const status = await getOwnedNukeStatus()
        if(status.owned <= 0 && status.queued <= 0) {
            setNukeButtonDone(button)
            return true
        }

        setNukeButtonWorking(button, formatNukeProgressLabel('Fallout settling...', status))
        if(Date.now() >= nextSweepAt) {
            nextSweepAt = Date.now() + 4000
            void sweepBlockedProfileTabs()
        }
        await sleep(intervalMs)
    }

    const status = await getOwnedNukeStatus()
    setNukeButtonWorking(button, formatNukeProgressLabel('Fallout settling...', status))
    return false
}

function startObserver() {
    new MutationObserver(async mutations => {
        if(location.href !== currentUrl) {
            const previousProfileKey = getProfileKey(currentUrl)
            currentUrl = location.href
            resetQuestionPageBtn()
            resetSpacePostNukeBtn()

            const nextProfileKey = getProfileKey(currentUrl)
            if(previousProfileKey !== nextProfileKey) {
                clearProfileBlockHint()
            }
        }

        const page = getPageType()

        if(page === 'profile' && shouldRefreshProfileButtons(mutations)) {
            scheduleProfileButtonsRefresh()
        }

        if(page === 'question') {
            ensureQuestionPageFOPBtn()
        }
        else if(page === 'space-post' && !document.querySelector('.mb-ext_post-nuke-btn')) {
            scheduleSpacePostNukeBtn(300)
        }

        let modal = document.querySelector('[role="dialog"][aria-modal="true"]:not([data-mb-checked])')
        if(!modal) return

        modal.dataset.mbChecked = true

        let tabs = Array.from(modal.querySelectorAll('[role="tab"]'))
        let tabMatched = tabs.some(tab => /\bfollower(?:s)?\b|\bfollowing\b/i.test(tab.innerText))

        if(tabMatched) {
            await sleep(1e3)

            let items = getUnhandledProfileModalItems(modal)
            if(items.length) injectModalOpenProfilesBtn()
        }
    }).observe(document.body, {childList: true, subtree: true})
}

function syncProfileButtons() {
    injectCloseTabBtn()
    toggleMuteBlockBtn()
    toggleMuteBlockCloseBtn()
}

function hasProfileButtons() {
    const hasCloseBtn = !!document.querySelector('.mb-ext_close-tab-btn')
    const hasMuteBtn = !!document.querySelector('.mb-ext_mute-block-btn') || isProfileBlocked()
    const hasMuteCloseBtn = !!document.querySelector('.mb-ext_mute-block-close-btn') || isProfileBlocked()
    return hasCloseBtn && hasMuteBtn && hasMuteCloseBtn
}

function areProfileButtonsCorrectlyPlaced(target = getProfileButtonInsertionTarget()) {
    const closeBtn = document.querySelector('.mb-ext_close-tab-btn')
    const muteBtn = document.querySelector('.mb-ext_mute-block-btn')
    const muteCloseBtn = document.querySelector('.mb-ext_mute-block-close-btn')

    if(!target) return !closeBtn && (!muteBtn || isProfileBlocked()) && (!muteCloseBtn || isProfileBlocked())
    if(closeBtn && !isProfileTargetPlacement(closeBtn, target)) return false
    if(muteBtn && !isProfileTargetPlacement(muteBtn, target)) return false
    if(muteCloseBtn && !isProfileTargetPlacement(muteCloseBtn, target)) return false

    return true
}

function shouldRefreshProfileButtons(mutations) {
    if(profileButtonsPending || profileActionInProgress) return false

    const target = getProfileButtonInsertionTarget()
    if(hasProfileButtons() && areProfileButtonsCorrectlyPlaced(target)) return false

    return mutations.some(mutation => {
        return Array.from(mutation.removedNodes).some(node => {
            return node.nodeType === Node.ELEMENT_NODE &&
                (node.matches?.('.mb-ext_close-tab-btn, .mb-ext_mute-block-btn, .mb-ext_mute-block-close-btn') ||
                    node.querySelector?.('.mb-ext_close-tab-btn, .mb-ext_mute-block-btn, .mb-ext_mute-block-close-btn'))
        }) || Array.from(mutation.addedNodes).some(node => {
            return node.nodeType === Node.ELEMENT_NODE &&
                (node.matches?.('[role="menu"], [data-popper-placement], [aria-haspopup="menu"]') ||
                    node.querySelector?.('[role="menu"], [data-popper-placement], [aria-haspopup="menu"]'))
        })
    })
}

function scheduleProfileButtonsRefresh(delay = 400) {
    if(profileActionInProgress) return
    clearTimeout(profileButtonsRefreshTimeout)
    profileButtonsRefreshTimeout = setTimeout(() => ensureProfileButtons(), delay)
}

function clearProfileButtonsFollowUps() {
    for(const timeoutId of profileButtonsFollowUpTimeouts) {
        clearTimeout(timeoutId)
    }

    profileButtonsFollowUpTimeouts = []
}

function scheduleProfileButtonsFollowUps() {
    clearProfileButtonsFollowUps()

    const delays = [400, 1000, 2000, 3500]

    for(const delay of delays) {
        const timeoutId = setTimeout(() => {
            if(getPageType() === 'profile' && !profileActionInProgress) {
                ensureProfileButtons()
            }
        }, delay)

        profileButtonsFollowUpTimeouts.push(timeoutId)
    }
}

function ensureProfileButtons() {
    if(profileButtonsPending || profileActionInProgress) return

    profileButtonsPending = true
    clearTimeout(profileButtonsTimeout)

    const trySync = retriesLeft => {
        try {
            syncProfileButtons()
        }
        finally {
            const onProfilePage = getPageType() === 'profile'

            if(!onProfilePage || hasProfileButtons() || retriesLeft <= 0) {
                profileButtonsPending = false
            }
            else {
                profileButtonsTimeout = setTimeout(() => trySync(retriesLeft - 1), 250)
            }
        }
    }

    profileButtonsTimeout = setTimeout(() => trySync(20), 50)
}

function onMessage(request, sender, sendResponse) {
    if(request.action === 'close-if-blocked') {
        if(getPageType() === 'profile' && isProfileBlocked()) {
            setTimeout(() => {
                void requestCloseTab(1, 0, false)
            }, 0)
            return {willClose: true}
        }

        scheduleBlockedProfileCloseChecks()
        return {willClose: false, armed: true}
    }

    switch(request.status) {
        case 'space-people-modal-loaded':
            injectModalOpenProfilesBtn()
            break
        case 'space-contributors-loaded': {
            injectModalOpenProfilesBtn()

            let btn = document.querySelector('.mb-ext_open-profiles-btn')

            if(btn && btn.disabled) {
                clearTimeout(profilesModalTimeout)
                setTimeout(openModalProfiles, 1e3)
            }

            break
        }
        case 'profile-followers-modal-loaded':
            injectModalOpenProfilesBtn()
            break
        case 'profile-followers-loaded':
        case 'profile-following-loaded': {
            let btn = document.querySelector('.mb-ext_open-profiles-btn, .mb-ext_nuke-profiles-btn')

            if(btn && btn.disabled) {
                btn.disabled = false
                clearTimeout(profilesModalTimeout)
                setTimeout(openModalProfiles, 2e3)
            }
            break
        }
        case 'profile-block-updated':
            noteProfileBlockMutation()
            ensureProfileButtons()
            toggleMuteBlockBtn()
            break
        case 'question-page-loaded':
            ensureQuestionPageFOPBtn()
            scheduleQuestionPageFollowUps()
            break
        case 'question-log-loaded':
            scheduleOriginalPosterRedirect()
            break
        default:
            break
    }
}

function ensureQuestionPageFOPBtn() {
    const expectedHref = getQuestionOriginalPosterLookupHref()
    let existingBtn = document.querySelector('.mb-ext_find-op-btn')

    if(existingBtn && existingBtn.href !== expectedHref) {
        removeQuestionPageBtn(existingBtn)
        existingBtn = null
    }

    if(existingBtn || questionPageBtnPending) return

    questionPageBtnPending = true
    clearTimeout(questionPageBtnTimeout)

    const tryInject = async retriesLeft => {
        let inserted = false

        try {
            inserted = await injectQuestionPageFOPBtn()
        }
        finally {
            if(inserted || retriesLeft <= 0) {
                questionPageBtnPending = false
            }
            else {
                questionPageBtnTimeout = setTimeout(() => tryInject(retriesLeft - 1), 750)
            }
        }
    }

    questionPageBtnTimeout = setTimeout(() => tryInject(20), settings.fopDelay)
}

function resetQuestionPageBtn() {
    clearTimeout(questionPageBtnTimeout)
    questionPageBtnPending = false
    clearQuestionPageFollowUps()

    document.querySelectorAll('.mb-ext_find-op-btn').forEach(removeQuestionPageBtn)
}

function clearQuestionPageFollowUps() {
    for(const timeoutId of questionPageFollowUpTimeouts) {
        clearTimeout(timeoutId)
    }

    questionPageFollowUpTimeouts = []
}

function scheduleQuestionPageFollowUps() {
    clearQuestionPageFollowUps()

    const delays = [1500, 4000, 8000, 12000]

    for(const delay of delays) {
        const timeoutId = setTimeout(() => {
            if(getPageType() === 'question') {
                ensureQuestionPageFOPBtn()
            }
        }, delay)

        questionPageFollowUpTimeouts.push(timeoutId)
    }
}

function clearSpacePostFollowUps() {
    for(const timeoutId of spacePostFollowUpTimeouts) {
        clearTimeout(timeoutId)
    }

    spacePostFollowUpTimeouts = []
}

function scheduleSpacePostFollowUps() {
    clearSpacePostFollowUps()

    const delays = [800, 2000, 5000]

    for(const delay of delays) {
        const timeoutId = setTimeout(() => {
            if(getPageType() === 'space-post' && !document.querySelector('.mb-ext_post-nuke-btn')) {
                scheduleSpacePostNukeBtn(150)
            }
        }, delay)

        spacePostFollowUpTimeouts.push(timeoutId)
    }
}

function resetSpacePostNukeBtn() {
    clearTimeout(spacePostBtnTimeout)
    spacePostBtnPending = false
    clearSpacePostFollowUps()
}

function scheduleSpacePostNukeBtn(delay = 150) {
    if(spacePostBtnPending) return

    spacePostBtnPending = true
    clearTimeout(spacePostBtnTimeout)

    spacePostBtnTimeout = setTimeout(() => {
        try {
            if(getPageType() === 'space-post') {
                injectSpacePostNukeBtn()
            }
        }
        finally {
            spacePostBtnPending = false
        }
    }, delay)
}

function removeQuestionPageBtn(button) {
    let wrapper = button.closest('[data-mb-question-btn-wrapper]')
    if(wrapper) {
        wrapper.remove()
    }
    else {
        button.remove()
    }
}

function setNukeButtonIdle(button, label = `Nuke 'Em`) {
    if(!button) return
    button.dataset.mbNukeState = 'idle'
    button.classList.remove('mb-ext_nuke-profiles-btn--flash', 'mb-ext_nuke-profiles-btn--working', 'mb-ext_nuke-profiles-btn--done')
    button.innerText = label
}

function setNukeButtonWorking(button, label = 'Nuking...') {
    if(!button) return
    button.dataset.mbNukeState = 'working'
    button.classList.remove('mb-ext_nuke-profiles-btn--flash', 'mb-ext_nuke-profiles-btn--done')
    button.classList.add('mb-ext_nuke-profiles-btn--working')
    button.innerText = label
}

function setNukeButtonDone(button, label = 'Nuked') {
    if(!button) return
    button.dataset.mbNukeState = 'done'
    button.classList.remove('mb-ext_nuke-profiles-btn--flash', 'mb-ext_nuke-profiles-btn--working')
    button.classList.add('mb-ext_nuke-profiles-btn--done')
    button.innerText = label
}

async function animateNukeButtonPress(button) {
    if(!button) return

    button.classList.remove('mb-ext_nuke-profiles-btn--working', 'mb-ext_nuke-profiles-btn--done')
    await sleep(250)
    button.classList.add('mb-ext_nuke-profiles-btn--flash')
    await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))
    await sleep(750)
    button.classList.remove('mb-ext_nuke-profiles-btn--flash')
}

function installNavigationHooks() {
    if(window.__mbNavHooksInstalled) return
    window.__mbNavHooksInstalled = true

    const notify = () => {
        setTimeout(() => {
            if(location.href === currentUrl) return

            currentUrl = location.href
            clearTimeout(profileButtonsTimeout)
            profileButtonsPending = false
            clearProfileButtonsFollowUps()
            resetQuestionPageBtn()
            resetSpacePostNukeBtn()

            if(getPageType() === 'profile') {
                ensureProfileButtons()
                scheduleProfileButtonsFollowUps()
                void maybeRunAutoProfileAction()
            }
            else if(getPageType() === 'space-post') {
                scheduleSpacePostNukeBtn()
                scheduleSpacePostFollowUps()
            }
            else if(getPageType() === 'question') {
                ensureQuestionPageFOPBtn()
                scheduleQuestionPageFollowUps()
            }
        }, 0)
    }

    addEventListener('popstate', notify)
    addEventListener('hashchange', notify)

    for(const method of ['pushState', 'replaceState']) {
        const original = history[method]

        history[method] = function(...args) {
            const result = original.apply(this, args)
            notify()
            return result
        }
    }
}

function getPageType() {
    const params = new URLSearchParams(location.search)

    if(/\/profile\/.+/i.test(location.pathname) && params.get('__nsrc__') !== 'notif_page') {
        return 'profile'
    }
    else if(/\/log(?:$|[/?#])/i.test(location.pathname) || /question\slog/i.test(document.title)) {
        return 'question-log'
    }
    else if(isSpacePostPage()) {
        return 'space-post'
    }
    else if(document.querySelector('.puppeteer_test_tribe_info_header')) {
        return 'space'
    }
    else if(isQuestionPage()) {
        return 'question'
    }

    return false
}

function isQuestionPage() {
    if(/\/answer\//i.test(location.pathname)) return false

    // Trust concrete question-page markers before the Cloudflare/security heuristic.
    // Some real Quora question pages include enough challenge text in the DOM to
    // trigger the heuristic even though the page is fully loaded and usable.
    if(document.querySelector('.puppeteer_test_question_main')) return true
    if(findQuestionSortContainer()) return true

    if(isSecurityVerificationPage()) return false

    const articleMeta = document.querySelector('meta[property="og:type"][content="article"]')
    if(articleMeta) return !!getQuestionMain()

    const parts = location.pathname.split('/').filter(Boolean)
    const firstPart = parts[0] || ''
    const reservedPrefixes = new Set([
        'profile',
        'answer',
        'topic',
        'spaces',
        'space',
        'search',
        'settings',
        'messages',
        'notifications',
        'following',
        'bookmarks'
    ])

    if(firstPart === 'unanswered') return !!document.querySelector('h1, [role="heading"]')
    if(parts.length !== 1 || reservedPrefixes.has(firstPart)) return false

    return firstPart.includes('-') && !!document.querySelector('h1, [role="heading"]')
}

function isSpacePostPage() {
    const hasTimestamp = !!document.querySelector('a.post_timestamp, .post_timestamp')
    if(!hasTimestamp) return false

    if(document.querySelector('link[href*="page-TribeItemPageLoadable"], script[src*="page-TribeItemPageLoadable"]')) {
        return true
    }

    if(document.querySelector('link[href*="page-TribeMainPageLoadable"], script[src*="page-TribeMainPageLoadable"]')) {
        return true
    }

    return Array.from(document.scripts || []).some(script => {
        const text = script.textContent || ''
        return text.includes('TribeItemPageLoadable') || text.includes('TribeMainPageLoadable')
    })
}

function findQuestionSortContainer(root = document) {
    const XPATH = ".//div[contains(@class, 'qu-justifyContent--space-between') and contains(string(), 'Sort')]"
    const query = document.evaluate(XPATH, root, null, XPathResult.ORDERED_NODE_SNAPSHOT_TYPE, null)
    let bestMatch = null

    for(let index = 0; index < query.snapshotLength; index++) {
        const container = query.snapshotItem(index)
        if(!container || !isVisible(container)) continue

        const score = scoreQuestionSortContainer(container)
        const top = container.getBoundingClientRect().top

        if(!bestMatch ||
            score > bestMatch.score ||
            (score === bestMatch.score && top < bestMatch.top)) {
            bestMatch = {container, score, top}
        }
    }

    return bestMatch?.container || null
}

function getQuestionMain() {
    const questionMain = document.querySelector('.puppeteer_test_question_main')
    if(questionMain) return questionMain

    if(isSecurityVerificationPage()) return null

    const sortContainer = findQuestionSortContainer()
    if(sortContainer) {
        return sortContainer.closest('.puppeteer_test_question_main, #mainContent, main, [role="main"]') ||
            document.querySelector('#mainContent, main, [role="main"]')
    }

    if(!document.querySelector('meta[property="og:type"][content="article"]')) return null

    const selectors = ['#mainContent', 'main', '[role="main"]']

    for(const selector of selectors) {
        const element = document.querySelector(selector)
        if(element) return element
    }

    return null
}

function isSecurityVerificationPage() {
    const title = (document.title || '').toLowerCase()
    const bodyText = (document.body?.innerText || '').toLowerCase()

    return title.includes('just a moment') ||
        title.includes('security verification') ||
        bodyText.includes('performing security verification') ||
        bodyText.includes('verify you are human') ||
        !!document.querySelector('[name="cf-turnstile-response"], .cf-turnstile, #challenge-stage')
}

function getQuestionLogHref() {
    return location.origin + location.pathname.replace(/\/$/, '') + '/log'
}

function getQuestionOriginalPosterLookupHref() {
    return `${getQuestionLogHref()}?mb_op=1`
}

function shouldAutoRedirectToOriginalPoster() {
    const params = new URLSearchParams(location.search)
    return params.get('mb_op') === '1'
}

function getQuestionDebugState() {
    const sortContainer = getSortContainer()?.container
    const filterButton = getQuestionFilterButton(sortContainer)
    const actionTarget = getQuestionButtonInsertionTarget()

    return {
        url: location.href,
        title: document.title,
        pageType: getPageType(),
        hasQuestionMain: !!document.querySelector('.puppeteer_test_question_main'),
        hasSortContainer: !!sortContainer,
        filterText: getElementText(filterButton),
        targetType: actionTarget?.type || null,
        hasExistingButton: !!document.querySelector('.mb-ext_find-op-btn')
    }
}

function getElementText(element) {
    return (element?.innerText || element?.textContent || '').replace(/\s+/g, ' ').trim()
}

function isVisible(element) {
    if(!element) return false

    const style = getComputedStyle(element)
    const rect = element.getBoundingClientRect()

    return style.display !== 'none' &&
        style.visibility !== 'hidden' &&
        rect.width > 0 &&
        rect.height > 0
}

function getQuestionPrimaryAction() {
    const main = getQuestionMain() || document.querySelector('#mainContent')
    if(!main) return null

    const candidates = Array.from(main.querySelectorAll('button, a, [role="button"]')).filter(candidate => {
        if(!isVisible(candidate)) return false

        const text = getElementText(candidate)
        return /^(answer|follow|request)\b/i.test(text)
    })

    candidates.sort((left, right) => {
        const leftRect = left.getBoundingClientRect()
        const rightRect = right.getBoundingClientRect()

        return leftRect.top - rightRect.top || leftRect.left - rightRect.left
    })

    return candidates[0] || null
}

function isProfilePrimaryActionText(text) {
    return /^(follow|follow back|following|requested)$/i.test(text)
}

function isProfileSecondaryActionText(text) {
    return /^(notify me|ask|message)$/i.test(text)
}

function isProfileActionText(text) {
    return isProfilePrimaryActionText(text) || isProfileSecondaryActionText(text)
}

function getProfilePrimaryAction() {
    const actionRow = getProfileActionRow()
    if(!actionRow) return null

    const actionButtons = getVisibleButtons(actionRow).filter(button => {
        return isProfilePrimaryActionText(getElementText(button))
    })
    actionButtons.sort((left, right) => {
        const leftRect = left.getBoundingClientRect()
        const rightRect = right.getBoundingClientRect()

        return leftRect.left - rightRect.left || leftRect.top - rightRect.top
    })

    return actionButtons[0] || null
}

function getVisibleButtons(root) {
    if(!root) return []

    return Array.from(root.querySelectorAll('button, a, [role="button"]')).filter(isVisible)
}

function getActionButtons(root, regex) {
    return getVisibleButtons(root).filter(button => regex.test(getElementText(button)))
}

function isSameRow(left, right, tolerance = 24) {
    if(!left || !right) return false

    const leftRect = left.getBoundingClientRect()
    const rightRect = right.getBoundingClientRect()
    const leftMid = leftRect.top + leftRect.height / 2
    const rightMid = rightRect.top + rightRect.height / 2

    return Math.abs(leftMid - rightMid) <= tolerance
}

function getQuestionActionRow() {
    const primaryAction = getQuestionPrimaryAction()
    let node = primaryAction?.parentElement

    while(node && node !== document.body) {
        const actions = Array.from(node.querySelectorAll('button, a, [role="button"], div, span')).filter(action => {
            if(!isVisible(action)) return false
            if(!isSameRow(primaryAction, action)) return false

            return /answer|follow|request/i.test(getElementText(action))
        })

        if(actions.length >= 2) return node
        node = node.parentElement
    }

    return null
}

function getProfileActionRow() {
    const main = document.querySelector('#mainContent')
    if(!main) return null
    const mainRect = main.getBoundingClientRect()

    const primaryCandidates = getVisibleButtons(main).filter(button => {
        return isProfilePrimaryActionText(getElementText(button))
    })

    primaryCandidates.sort((left, right) => {
        const leftRect = left.getBoundingClientRect()
        const rightRect = right.getBoundingClientRect()

        return leftRect.top - rightRect.top || leftRect.left - rightRect.left
    })

    let bestMatch = null

    for(const primaryAction of primaryCandidates) {
        let node = primaryAction.parentElement

        while(node && node !== document.body) {
            const sameRowButtons = getVisibleButtons(node).filter(button => isSameRow(primaryAction, button))
            const actionButtons = sameRowButtons.filter(button => isProfileActionText(getElementText(button)))
            const menuButtons = sameRowButtons.filter(button => button.getAttribute('aria-haspopup') === 'menu')
            const rowTexts = actionButtons.map(button => getElementText(button).toLowerCase().trim())
            const sameRowUniqueButtons = new Set(sameRowButtons)

            let score = 0

            if(actionButtons.includes(primaryAction)) score += 1200
            if(menuButtons.length) score += 800
            if(menuButtons.length === 1) score += 200
            if(actionButtons.length >= 2) score += 240
            if(actionButtons.length >= 3) score += 180
            if(rowTexts.includes('notify me')) score += 220
            if(rowTexts.includes('ask')) score += 180
            if(rowTexts.includes('message')) score += 120
            if(sameRowUniqueButtons.size <= 8) score += 120
            else score -= (sameRowUniqueButtons.size - 8) * 90

            const nodeRect = node.getBoundingClientRect()
            const topDistance = Math.abs(nodeRect.top - mainRect.top)
            if(topDistance <= 260) score += 240
            else if(topDistance <= 420) score += 120
            else score -= Math.min(600, topDistance)

            if(score > 0 && (!bestMatch || score > bestMatch.score)) {
                bestMatch = {node, score}
            }

            node = node.parentElement
        }
    }

    if(bestMatch) return bestMatch.node

    const fallbackCandidates = getVisibleButtons(main).filter(button => {
        const text = getElementText(button)
        return isProfileSecondaryActionText(text) || button.getAttribute('aria-haspopup') === 'menu'
    })

    for(const anchorButton of fallbackCandidates) {
        let node = anchorButton.parentElement

        while(node && node !== document.body) {
            const sameRowButtons = getVisibleButtons(node).filter(button => isSameRow(anchorButton, button))
            const secondaryButtons = sameRowButtons.filter(button => isProfileSecondaryActionText(getElementText(button)))
            const primaryButtons = sameRowButtons.filter(button => isProfilePrimaryActionText(getElementText(button)))
            const menuButtons = sameRowButtons.filter(button => button.getAttribute('aria-haspopup') === 'menu')
            const rowTexts = [...primaryButtons, ...secondaryButtons].map(button => getElementText(button).toLowerCase().trim())
            const sameRowUniqueButtons = new Set(sameRowButtons)

            let score = 0

            if(menuButtons.length) score += 1200
            if(menuButtons.length === 1) score += 260
            if(secondaryButtons.length >= 1) score += 420
            if(secondaryButtons.length >= 2) score += 320
            if(primaryButtons.length) score += 180
            if(isProfileBlocked()) score += 180
            if(rowTexts.includes('notify me')) score += 320
            if(rowTexts.includes('ask')) score += 260
            if(rowTexts.includes('message')) score += 180
            if(sameRowUniqueButtons.size <= 8) score += 120
            else score -= (sameRowUniqueButtons.size - 8) * 90

            const nodeRect = node.getBoundingClientRect()
            const topDistance = Math.abs(nodeRect.top - mainRect.top)
            if(topDistance <= 260) score += 320
            else if(topDistance <= 420) score += 160
            else score -= Math.min(700, topDistance)

            if(score > 0 && (!bestMatch || score > bestMatch.score)) {
                bestMatch = {node, score}
            }

            node = node.parentElement
        }
    }

    return bestMatch?.node || null
}

function getProfileActionAnchor(actionRow = getProfileActionRow()) {
    if(!actionRow) return null

    const buttons = getVisibleButtons(actionRow)
    const primaryButtons = buttons.filter(button => isProfilePrimaryActionText(getElementText(button)))
    primaryButtons.sort((left, right) => {
        const leftRect = left.getBoundingClientRect()
        const rightRect = right.getBoundingClientRect()

        return leftRect.left - rightRect.left || leftRect.top - rightRect.top
    })
    if(primaryButtons.length) return primaryButtons[0]

    const secondaryButtons = buttons.filter(button => isProfileSecondaryActionText(getElementText(button)))
    secondaryButtons.sort((left, right) => {
        const leftRect = left.getBoundingClientRect()
        const rightRect = right.getBoundingClientRect()

        return leftRect.left - rightRect.left || leftRect.top - rightRect.top
    })

    return secondaryButtons[0] || null
}

function isProfileTargetPlacement(button, target) {
    if(!button || !target?.element) return false
    if(button.parentElement !== target.element.parentElement) return false
    if(!getProfileManagedButtonKind(button)) return false

    if(target.type === 'before-menu') {
        const sequence = getManagedButtonSequenceBeforeTarget(target)
        return sequence.join('|') === PROFILE_ACTION_BUTTON_ORDER.filter(kind => sequence.includes(kind)).join('|')
    }

    const sequence = getManagedButtonSequenceAfterTarget(target)
    return sequence.join('|') === PROFILE_ACTION_BUTTON_ORDER.filter(kind => sequence.includes(kind)).join('|')
}

function getQuestionActionMenuButton() {
    const row = getQuestionActionRow()
    const primaryAction = getQuestionPrimaryAction()
    if(!row || !primaryAction) return null

    const candidates = getVisibleButtons(row).filter(candidate => {
        return candidate.getAttribute('aria-haspopup') === 'menu' && isSameRow(primaryAction, candidate)
    })

    const scored = candidates.map(candidate => {
        const rect = candidate.getBoundingClientRect()
        const primaryRect = primaryAction?.getBoundingClientRect()
        const verticalDistance = primaryRect ? Math.abs((primaryRect.top + primaryRect.height / 2) - (rect.top + rect.height / 2)) : 999
        const isToRight = primaryRect ? rect.left >= primaryRect.right - 20 : true

        let score = 0
        if(primaryRect) {
            if(verticalDistance <= 24) score += 240
            else if(verticalDistance <= 48) score += 80
            else score -= verticalDistance * 4

            if(isToRight) score += 60
        }

        score += rect.left / 100
        return {candidate, score, top: rect.top, left: rect.left}
    })

    scored.sort((left, right) => right.score - left.score || left.top - right.top || right.left - left.left)

    return scored[0]?.candidate || null
}

function getQuestionButtonInsertionTarget() {
    const sortContainer = getSortContainer()?.container
    if(sortContainer &&
        sortContainer.firstElementChild &&
        sortContainer.lastElementChild &&
        sortContainer.firstElementChild !== sortContainer.lastElementChild) {
        return {type: 'between-filter-and-sort', element: sortContainer}
    }

    const menuButton = getQuestionActionMenuButton()
    if(menuButton) return {type: 'before-question-menu', element: menuButton}

    const primaryAction = getQuestionPrimaryAction()
    if(primaryAction) return {type: 'after-question-primary', element: primaryAction}

    return null
}

function getProfileMenuButton() {
    const actionRow = getProfileActionRow()
    const actionAnchor = getProfileActionAnchor(actionRow)
    if(!actionRow || !actionAnchor) return null

    const scope = actionRow
    const rowMenuButtons = getVisibleButtons(scope).filter(button => {
        return button.getAttribute('aria-haspopup') === 'menu' && isSameRow(actionAnchor, button)
    })

    rowMenuButtons.sort((left, right) => {
        const leftRect = left.getBoundingClientRect()
        const rightRect = right.getBoundingClientRect()

        return rightRect.left - leftRect.left || leftRect.top - rightRect.top
    })

    return rowMenuButtons[0] || null
}

function getProfileButtonInsertionTarget() {
    const menuButton = getProfileMenuButton()
    if(menuButton) return {type: 'before-menu', element: menuButton}

    const actionRow = getProfileActionRow()
    if(actionRow) {
        const actionAnchor = getProfileActionAnchor(actionRow)
        const actionButtons = getVisibleButtons(actionRow).filter(button => {
            return isSameRow(actionAnchor, button) &&
                isProfileActionText(getElementText(button))
        })
        actionButtons.sort((left, right) => right.getBoundingClientRect().left - left.getBoundingClientRect().left)

        if(actionButtons.length) return {type: 'after-primary', element: actionButtons[0]}
    }

    const primaryAction = getProfilePrimaryAction()
    if(primaryAction) return {type: 'after-primary', element: primaryAction}

    if(isProfileBlocked()) {
        const main = document.querySelector('#mainContent')
        const blockedTarget = main?.querySelector('h1, [role="heading"], .q-text')

        if(blockedTarget && isVisible(blockedTarget)) {
            return {type: 'after-primary', element: blockedTarget}
        }

        if(main?.firstElementChild) {
            return {type: 'after-primary', element: main.firstElementChild}
        }
    }

    return null
}

function getOverlayRoots(includeDialogs = true) {
    const roots = [
        ...document.querySelectorAll('[role="menu"]'),
        ...document.querySelectorAll('[data-popper-placement]')
    ]

    if(includeDialogs) {
        roots.push(...document.querySelectorAll('[role="dialog"][aria-modal="true"], [role="dialog"], [role="alertdialog"], [aria-modal="true"]'))
    }

    return roots.filter(isVisible)
}

function getProfileManagedButtonKind(button) {
    if(!button) return null
    if(button.dataset?.mbProfileBtnKind) return button.dataset.mbProfileBtnKind
    if(button.classList?.contains('mb-ext_close-tab-btn')) return 'close-tab'
    if(button.classList?.contains('mb-ext_mute-block-btn')) return 'mute-block'
    if(button.classList?.contains('mb-ext_mute-block-close-btn')) return 'mute-block-close'
    return null
}

function getManagedButtonSequenceBeforeTarget(target) {
    const sequence = []
    let node = target?.element?.previousElementSibling || null

    while(node && getProfileManagedButtonKind(node)) {
        sequence.unshift(getProfileManagedButtonKind(node))
        node = node.previousElementSibling
    }

    return sequence
}

function getManagedButtonSequenceAfterTarget(target) {
    const sequence = []
    let node = target?.element?.nextElementSibling || null

    while(node && getProfileManagedButtonKind(node)) {
        sequence.push(getProfileManagedButtonKind(node))
        node = node.nextElementSibling
    }

    return sequence
}

function normalizeProfileActionButtonOrder(target) {
    const parent = target?.element?.parentElement
    if(!parent) return

    const buttonsByKind = new Map(
        Array.from(parent.children)
            .map(button => [getProfileManagedButtonKind(button), button])
            .filter(([kind]) => !!kind)
    )

    if(target.type === 'before-menu') {
        for(const kind of PROFILE_ACTION_BUTTON_ORDER) {
            const button = buttonsByKind.get(kind)
            if(button) target.element.insertAdjacentElement('beforebegin', button)
        }

        return
    }

    let anchor = target.element
    for(const kind of PROFILE_ACTION_BUTTON_ORDER) {
        const button = buttonsByKind.get(kind)
        if(!button) continue
        anchor.insertAdjacentElement('afterend', button)
        anchor = button
    }
}

function getProfilePeopleModal() {
    const dialogs = Array.from(document.querySelectorAll('[role="dialog"][aria-modal="true"], [role="dialog"].modal_content_inner, .modal_content_inner[aria-modal="true"]'))
        .filter(isVisible)

    const scored = dialogs.map(dialog => {
        const tabs = Array.from(dialog.querySelectorAll('[role="tab"]')).filter(isVisible)
        const tabText = tabs.map(getElementText).join(' ')
        const items = dialog.querySelectorAll('[role="listitem"]')
        const profileLinks = dialog.querySelectorAll('a[href*="/profile/"]')

        let score = 0
        if(/\bfollower(?:s)?\b|\bfollowing\b/i.test(tabText)) score += 500
        if(items.length) score += 150
        if(profileLinks.length) score += 150

        return {dialog, score}
    }).filter(entry => entry.score > 0)

    scored.sort((left, right) => right.score - left.score)
    return scored[0]?.dialog || null
}

function getProfileModalItems(modal = getProfilePeopleModal()) {
    if(!modal) return []
    return Array.from(modal.querySelectorAll('[role="listitem"]')).filter(item => {
        return isVisible(item) && item.querySelector('a[href*="/profile/"]')
    })
}

function syncActiveProfileModal(modal = getProfilePeopleModal()) {
    if(modal && modal !== activeProfileModal) {
        activeProfileModal = modal
        handledModalProfileUrls = new Set()
    }
    else if(!modal) {
        activeProfileModal = null
        handledModalProfileUrls = new Set()
    }

    return modal
}

function getModalItemProfileHref(item) {
    return item?.querySelector('a[href*="/profile/"]')?.href || null
}

function isModalItemHandled(item) {
    const href = getModalItemProfileHref(item)
    return item?.dataset?.mbOpened === 'true' || (!!href && handledModalProfileUrls.has(href))
}

function getUnhandledProfileModalItems(modal = getProfilePeopleModal()) {
    modal = syncActiveProfileModal(modal)
    return getProfileModalItems(modal).filter(item => !isModalItemHandled(item))
}

function markModalItemsHandled(items, backgroundColor = '#d4edda') {
    for(const item of items) {
        const href = getModalItemProfileHref(item)
        item.dataset.mbOpened = true
        if(href) handledModalProfileUrls.add(href)
        item.style.backgroundColor = backgroundColor
    }
}

function getActiveProfileModalTabLabel(modal = getProfilePeopleModal()) {
    if(!modal) return 'Profiles'

    const tabs = Array.from(modal.querySelectorAll('[role="tab"]')).filter(isVisible)
    const scored = tabs.map(tab => {
        const text = getElementText(tab)
        const tabContent = tab.firstElementChild || tab
        const className = `${tab.className || ''} ${tabContent.className || ''}`
        const style = getComputedStyle(tabContent)
        let score = 0

        if(/\bfollower(?:s)?\b/i.test(text)) score += 200
        if(/\bfollowing\b/i.test(text)) score += 200
        if(/qu-color--red|qu-bg--red/.test(className)) score += 300
        if(style.color === 'rgb(185, 43, 39)') score += 300
        if(tab.querySelector('.qu-bg--red')) score += 250
        if(tab.getAttribute('aria-selected') === 'true') score += 300

        return {text, score}
    }).filter(entry => entry.score > 0)

    scored.sort((left, right) => right.score - left.score)
    const activeText = scored[0]?.text || tabs.map(getElementText).join(' ')

    if(/\bfollowing\b/i.test(activeText)) return 'Following'
    if(/\bfollower(?:s)?\b/i.test(activeText)) return 'Followers'
    return 'Profiles'
}

function findOverlayAction(regex, roots) {
    for(const root of roots) {
        const candidates = Array.from(root.querySelectorAll('.puppeteer_test_popover_item, [role="menuitem"], button, [role="button"], a'))
        const match = candidates.find(candidate => {
            if(!isVisible(candidate)) return false

            const label = `${candidate.getAttribute('aria-label') || ''} ${getElementText(candidate)}`
            return regex.test(label)
        })

        if(match) return match
    }

    return null
}

function getVisibleAction(regex, root = document) {
    const candidates = Array.from(root.querySelectorAll('.puppeteer_test_popover_item, [role="menuitem"], button, [role="button"], a'))

    return candidates.find(candidate => {
        if(shouldIgnoreActionCandidate(candidate)) return false
        if(!isVisible(candidate)) return false

        const label = `${candidate.getAttribute('aria-label') || ''} ${getElementText(candidate)}`
        return regex.test(label)
    }) || null
}

function getMenuAction(regex) {
    const match = findOverlayAction(regex, getOverlayRoots(false))
    if(match) return match

    return getVisibleAction(regex)
}

function getDialogAction(regex) {
    const dialogRoots = getDialogRoots()

    const match = findOverlayAction(regex, dialogRoots)
    if(match) return match

    if(dialogRoots.length) {
        const primary = getDialogPrimaryAction(dialogRoots, regex)
        if(primary) return primary
    }

    return getGlobalPrimaryAction(regex)
}

function getVisibleActionButtons(root) {
    return Array.from(root.querySelectorAll('button, [role="button"], a')).filter(button => {
        return !shouldIgnoreActionCandidate(button) && isVisible(button)
    })
}

function getMuteConfirmContainer() {
    const candidates = Array.from(document.querySelectorAll('div, section, aside'))
        .filter(isVisible)
        .filter(element => {
            const text = getElementText(element)
            if(!/\bmuted\b|\bmuting this person\b/i.test(text)) return false

            const buttons = getVisibleActionButtons(element)
            return buttons.some(button => /\bconfirm\b/i.test(getElementText(button))) &&
                buttons.some(button => /\bcancel\b/i.test(getElementText(button)))
        })
        .map(element => {
            const rect = element.getBoundingClientRect()
            const area = rect.width * rect.height
            const text = getElementText(element)
            return {element, area, text}
        })

    candidates.sort((left, right) => left.area - right.area)
    return candidates[0]?.element || null
}

function getMuteConfirmCandidates() {
    const candidates = Array.from(document.querySelectorAll('button, [role="button"], a'))
        .filter(button => !shouldIgnoreActionCandidate(button) && isVisible(button))
        .filter(button => /\bconfirm\b/i.test(getElementText(button)))
        .map(button => {
            const context = getBestActionContext(button)
            const contextText = context?.text || ''
            let score = scoreActionCandidate(button, /\bconfirm\b/i, contextText)

            if(/\bmuted\b|\bmuting this person\b/i.test(contextText)) score += 1200
            if(/\bask question\b|\badd question\b|\bcreate post\b/i.test(contextText)) score -= 1500
            if(/\bcancel\b/i.test(contextText) && !/\bmuted\b|\bmuting this person\b/i.test(contextText)) score -= 500

            return {button, score, contextText}
        })
        .filter(candidate => /\bmuted\b|\bmuting this person\b/i.test(candidate.contextText))

    candidates.sort((left, right) => right.score - left.score)
    return candidates
}

function getMuteConfirmAction() {
    const buttons = getMuteConfirmCandidates()
    if(buttons.length) return buttons[0].button

    const container = getMuteConfirmContainer()
    if(!container) return null

    const containerButtons = getVisibleActionButtons(container)
        .filter(button => /\bconfirm\b/i.test(getElementText(button)))
        .map(button => ({button, score: scoreActionCandidate(button, /\bconfirm\b/i, getElementText(container)) + 500}))

    containerButtons.sort((left, right) => right.score - left.score)
    return containerButtons[0]?.button || null
}

function isMuteConfirmPending() {
    return !!getMuteConfirmContainer() || getMuteConfirmCandidates().length > 0
}

function getBlockConfirmContainer() {
    const candidates = Array.from(document.querySelectorAll('div, section, aside'))
        .filter(isVisible)
        .filter(element => {
            const text = getElementText(element)
            if(!/\bblock\b|\bblocked\b|\bunblock\b/i.test(text)) return false

            const buttons = getVisibleActionButtons(element)
            return buttons.some(button => /\bblock\b/i.test(getElementText(button))) &&
                buttons.some(button => /\bcancel\b/i.test(getElementText(button)))
        })
        .map(element => {
            const rect = element.getBoundingClientRect()
            const area = rect.width * rect.height
            const text = getElementText(element)
            return {element, area, text}
        })

    candidates.sort((left, right) => left.area - right.area)
    return candidates[0]?.element || null
}

function getBlockConfirmCandidates() {
    const candidates = Array.from(document.querySelectorAll('button, [role="button"], a'))
        .filter(button => !shouldIgnoreActionCandidate(button) && isVisible(button))
        .filter(button => /\bblock\b/i.test(getElementText(button)))
        .map(button => {
            const context = getBestActionContext(button)
            const contextText = context?.text || ''
            let score = scoreActionCandidate(button, /\bblock\b/i, contextText)

            if(/\bblock this profile\b|\bblock this person\b|\bblock\b|\bblocked\b/i.test(contextText)) score += 1200
            if(/\bmuted\b|\bmuting this person\b|\bask question\b|\badd question\b|\bcreate post\b/i.test(contextText)) score -= 1500
            if(/\bcancel\b/i.test(contextText) && !/\bblock this profile\b|\bblock this person\b|\bblock\b|\bblocked\b/i.test(contextText)) score -= 500

            return {button, score, contextText}
        })
        .filter(candidate => /\bblock this profile\b|\bblock this person\b|\bblock\b|\bblocked\b/i.test(candidate.contextText) &&
            !/\bmuted\b|\bmuting this person\b|\bask question\b|\badd question\b|\bcreate post\b/i.test(candidate.contextText))

    candidates.sort((left, right) => right.score - left.score)
    return candidates
}

function getBlockConfirmAction() {
    const buttons = getBlockConfirmCandidates()
    if(buttons.length) return buttons[0].button

    const container = getBlockConfirmContainer()
    if(!container) return null

    const containerButtons = getVisibleActionButtons(container)
        .filter(button => /\bblock\b/i.test(getElementText(button)))
        .map(button => ({button, score: scoreActionCandidate(button, /\bblock\b/i, getElementText(container)) + 500}))

    containerButtons.sort((left, right) => right.score - left.score)
    return containerButtons[0]?.button || null
}

function isBlockConfirmPending() {
    return !!getBlockConfirmContainer() || getBlockConfirmCandidates().length > 0
}

function getDialogRoots() {
    const roots = [
        ...getOverlayRoots(true).filter(root => root.matches('[role="dialog"], [role="alertdialog"], [aria-modal="true"]')),
        ...document.querySelectorAll('[role="dialog"], [role="alertdialog"], [aria-modal="true"], .modal_content_inner')
    ].filter(isVisible)

    return Array.from(new Set(roots))
}

function getDialogPrimaryAction(dialogRoots, preferredRegex = null) {
    const candidates = []

    for(const root of dialogRoots) {
        const rootText = getElementText(root)

        for(const button of Array.from(root.querySelectorAll('button, [role="button"], a'))) {
            if(shouldIgnoreActionCandidate(button)) continue
            if(!isVisible(button)) continue

            const score = scoreActionCandidate(button, preferredRegex, rootText)
            if(score > -600) candidates.push({button, score})
        }
    }

    candidates.sort((left, right) => right.score - left.score)
    return candidates[0]?.button || null
}

function shouldIgnoreActionCandidate(candidate) {
    if(!candidate) return true
    if(candidate.classList?.contains('mb-ext_mute-block-btn')) return true
    if(candidate.classList?.contains('mb-ext_close-tab-btn')) return true
    if(candidate.classList?.contains('mb-ext_mute-block-close-btn')) return true
    if(candidate.classList?.contains('mb-ext_find-op-btn')) return true
    if(candidate.classList?.contains('mb-ext_open-profiles-btn')) return true
    if(candidate.classList?.contains('mb-ext_nuke-profiles-btn')) return true

    return !!candidate.closest('#onetrust-consent-sdk, #ot-sdk-cookie-policy, #ot-pc-content, .ot-sdk-container, .ot-sdk-cookie-policy')
}

function getBestActionContext(candidate) {
    let best = null
    let current = candidate?.parentElement
    let depth = 0

    while(current && current !== document.body && depth < 8) {
        if(isVisible(current)) {
            const text = getElementText(current)
            const style = getComputedStyle(current)
            const buttonCount = current.querySelectorAll('button, [role="button"], a').length
            const zIndex = Number.parseInt(style.zIndex || '0', 10)

            let score = 0
            if(current.matches('[role="dialog"], [role="alertdialog"], [aria-modal="true"], .modal_content_inner, [data-popper-placement]')) score += 400
            if(/fixed|absolute|sticky/.test(style.position)) score += 180
            if(Number.isFinite(zIndex) && zIndex > 0) score += Math.min(zIndex, 500) / 2
            if(buttonCount >= 2) score += 60
            if(/\bmuted\b|\bblocked\b|\bblock\b|\bmute\b/i.test(text)) score += 220
            if(/\bconfirm\b|\bcancel\b/i.test(text)) score += 80
            if(/\bonetrust\b|\bcookie\b|\bconsent\b/i.test(text)) score -= 800

            if(!best || score > best.score) {
                best = {element: current, text, score}
            }
        }

        current = current.parentElement
        depth += 1
    }

    return best
}

function scoreActionCandidate(candidate, preferredRegex = null, rootText = '') {
    const label = `${candidate.getAttribute('aria-label') || ''} ${getElementText(candidate)}`.trim()
    const rect = candidate.getBoundingClientRect()
    const className = candidate.className || ''
    const id = candidate.id || ''
    const context = getBestActionContext(candidate)
    const contextText = rootText || context?.text || ''

    let score = 0
    if(preferredRegex?.test(label)) score += 400
    if(preferredRegex && new RegExp(`^${preferredRegex.source}$`, preferredRegex.flags || '').test(label)) score += 180
    if(/\b(confirm|ok|yes|continue|block|mute)\b/i.test(label)) score += 120
    if(/\b(cancel|dismiss|close|no)\b/i.test(label)) score -= 220
    if(/\bmy choices\b/i.test(label)) score -= 500
    if(/qu-bg--blue|qu-bg--red|qu-color--white|qu-hover--bg--/i.test(className)) score += 80
    if(/onetrust|ot-/i.test(`${id} ${className}`)) score -= 900
    if(/\bmuted\b|\bblocked\b|\bblock this profile\b|\bmute this profile\b/i.test(contextText)) score += 220
    if(/\bonetrust\b|\bcookie\b|\bconsent\b/i.test(contextText)) score -= 900
    if(context) score += context.score
    score += rect.left / 100
    score += rect.top / 200

    return score
}

function getGlobalPrimaryAction(preferredRegex = null) {
    const candidates = Array.from(document.querySelectorAll('button, [role="button"], a'))
        .filter(candidate => !shouldIgnoreActionCandidate(candidate) && isVisible(candidate))
        .map(button => ({button, score: scoreActionCandidate(button, preferredRegex)}))
        .filter(candidate => candidate.score > -600)

    candidates.sort((left, right) => right.score - left.score)
    return candidates[0]?.button || null
}

async function waitForAction(getAction, timeoutMs = 4000, intervalMs = 200) {
    const startedAt = Date.now()

    while(Date.now() - startedAt < timeoutMs) {
        const action = getAction()
        if(action) return action

        await sleep(intervalMs)
    }

    return null
}

async function waitForCondition(check, timeoutMs = 4000, intervalMs = 200) {
    const startedAt = Date.now()

    while(Date.now() - startedAt < timeoutMs) {
        if(check()) return true
        await sleep(intervalMs)
    }

    return false
}

async function waitForMenuState(primaryRegex, inverseRegex, timeoutMs = 5000, intervalMs = 250) {
    const action = await waitForAction(() => {
        const inverse = getMenuAction(inverseRegex)
        if(inverse) return {state: 'inverse', button: inverse}

        const primary = getMenuAction(primaryRegex)
        if(primary) return {state: 'primary', button: primary}

        return null
    }, timeoutMs, intervalMs)

    return action
}

async function readProfileMenuState(primaryRegex, inverseRegex, timeoutMs = 2500, intervalMs = 200) {
    const opened = await ensureProfileMenuOpen()
    if(!opened) return null

    await sleep(400)

    const state = await waitForMenuState(primaryRegex, inverseRegex, timeoutMs, intervalMs)

    if(state?.state && isProfileMenuOpen()) {
        await closeProfileMenu()
        await sleep(250)
    }

    return state?.state || null
}

async function waitForProfileMenuState(expectedState, primaryRegex, inverseRegex, timeoutMs = 8000, intervalMs = 500) {
    const startedAt = Date.now()

    while(Date.now() - startedAt < timeoutMs) {
        const state = await readProfileMenuState(primaryRegex, inverseRegex, 1800, 200)
        if(state === expectedState) return true
        await sleep(intervalMs)
    }

    return false
}

function isProfileBlocked() {
    const main = document.querySelector('#mainContent')
    if(main) {
        const labels = Array.from(main.querySelectorAll('div, span, button, a'))
        const blocked = labels.some(label => isVisible(label) && /^blocked$/i.test(getElementText(label)))
        if(blocked) {
            rememberProfileBlocked()
            return true
        }
    }

    if(isProfileBlockedFromInlineState()) {
        rememberProfileBlocked()
        return true
    }

    return hasRecentProfileBlockHint()
}

function getProfileKey(href = location.href) {
    try {
        const url = new URL(href, location.href)
        const parts = url.pathname.split('/').filter(Boolean)
        if(parts[0] !== 'profile' || !parts[1]) return null

        return `https://www.quora.com/profile/${parts[1]}`
    }
    catch {
        return null
    }
}

function escapeRegex(text) {
    return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

function isProfileBlockedFromInlineState() {
    const profileKey = getProfileKey()
    if(!profileKey) return false

    let profilePath
    try {
        profilePath = new URL(profileKey).pathname
    }
    catch {
        return false
    }

    const pathPattern = escapeRegex(profilePath)
    const blockedPattern = /\\?"isBlockedByViewer\\?":true|\\?"isBlocking\\?":true/

    for(const script of Array.from(document.scripts || [])) {
        const text = script.textContent || ''
        if(!text || !text.includes(profilePath)) continue

        const match = text.match(new RegExp(`${pathPattern}[\\s\\S]{0,4000}`, 'i'))
        if(match && blockedPattern.test(match[0])) return true

        const reverseMatch = text.match(new RegExp(`[\\s\\S]{0,4000}${pathPattern}`, 'i'))
        if(reverseMatch && blockedPattern.test(reverseMatch[0])) return true
    }

    return false
}

function clearProfileBlockHint() {
    profileBlockHintKey = null
    profileBlockHintAt = 0
}

function rememberProfileBlocked() {
    const profileKey = getProfileKey()
    if(!profileKey) return false

    profileBlockHintKey = profileKey
    profileBlockHintAt = Date.now()
    return true
}

function noteProfileBlockMutation() {
    profileBlockMutationCount += 1
    rememberProfileBlocked()
}

function hasRecentProfileBlockHint(maxAgeMs = 20000) {
    const profileKey = getProfileKey()
    if(!profileKey || profileBlockHintKey !== profileKey || !profileBlockHintAt) return false
    return Date.now() - profileBlockHintAt <= maxAgeMs
}

function clearCloseTabFollowUps() {
    for(const timeoutId of closeTabRetryTimeouts) {
        clearTimeout(timeoutId)
    }

    closeTabRetryTimeouts = []
}

function clearBlockedCloseChecks() {
    for(const timeoutId of blockedCloseCheckTimeouts) {
        clearTimeout(timeoutId)
    }

    blockedCloseCheckTimeouts = []
}

function scheduleBlockedProfileCloseChecks(delays = [0, 100, 250, 500, 1000, 2000, 4000, 8000]) {
    clearBlockedCloseChecks()

    for(const delay of delays) {
        const timeoutId = setTimeout(() => {
            if(getPageType() !== 'profile') return

            if(isProfileBlocked()) {
                void requestCloseTab(1, 0, false)
                return
            }

            if(getProfileMenuButton()) {
                void (async () => {
                    const menuBlocked = await readProfileMenuState(/\bblock\b/i, /\bunblock\b/i, 700, 100)
                    if(menuBlocked === 'inverse') {
                        rememberProfileBlocked()
                        void requestCloseTab(1, 0, false)
                    }
                })()
            }
        }, delay)

        blockedCloseCheckTimeouts.push(timeoutId)
    }
}

function scheduleCloseTabFollowUps(delays = [500, 1500, 4000, 10000, 30000, 60000]) {
    clearCloseTabFollowUps()

    for(const delay of delays) {
        const timeoutId = setTimeout(() => {
            void requestCloseTab(2, 100, false)
        }, delay)

        closeTabRetryTimeouts.push(timeoutId)
    }
}

async function requestCloseTab(attempts = 3, delayMs = 150, scheduleFollowUps = true) {
    if(scheduleFollowUps) scheduleCloseTabFollowUps()

    for(let attempt = 0; attempt < attempts; attempt++) {
        try {
            const closed = !!await safeSendRuntimeMessage({action: 'close-tab'}, false)
            if(closed) return true
        }
        catch(error) {
            if(!isRuntimeConnectionError(error) && !isExtensionContextInvalidatedError(error)) {
                return false
            }
        }

        try {
            window.close()
        }
        catch {}

        if(attempt < attempts - 1) {
            await sleep(delayMs)
        }
    }

    return false
}

async function waitForProfileActionReady(timeoutMs = 5000) {
    if(isProfileBlocked()) return true
    return waitForCondition(() => isProfileBlocked() || !!getProfileMenuButton(), timeoutMs, 100)
}

function shouldDeferBlockedCloseTab(target) {
    return isProfileBlocked() && target?.type !== 'before-menu'
}

function insertProfileActionButton(btn, target, kind) {
    btn.dataset.mbProfileBtnKind = kind

    if(target.type === 'before-menu') {
        target.element.insertAdjacentElement('beforebegin', btn)
        normalizeProfileActionButtonOrder(target)
        return
    }

    target.element.insertAdjacentElement('afterend', btn)
    normalizeProfileActionButtonOrder(target)
}

function bindSinglePressAction(button, action) {
    let lastPointerPressAt = 0

    button.addEventListener('pointerdown', event => {
        if(event.button !== 0) return

        lastPointerPressAt = Date.now()
        event.preventDefault()
        event.stopPropagation()
        void action()
    })

    button.addEventListener('click', event => {
        event.preventDefault()
        event.stopPropagation()

        if(Date.now() - lastPointerPressAt < 1000) return
        void action()
    })
}

function injectCloseTabBtn() {
    let target = getProfileButtonInsertionTarget()
    if(!target) return

    if(shouldDeferBlockedCloseTab(target)) {
        document.querySelector('.mb-ext_close-tab-btn')?.remove()
        return
    }

    let btn = document.querySelector('.mb-ext_close-tab-btn')
    if(btn && isProfileTargetPlacement(btn, target)) return
    btn?.remove()

    btn = document.createElement('button')
    btn.innerText = 'Close tab'
    btn.classList.add('mb-ext_close-tab-btn')

    bindSinglePressAction(btn, async () => {
        btn.disabled = true
        btn.innerText = 'Closing...'
        await new Promise(resolve => requestAnimationFrame(resolve))

        void requestCloseTab().then(closed => {
            if(closed) return

            btn.disabled = false
            btn.innerText = 'Close tab'
        })
    })

    insertProfileActionButton(btn, target, 'close-tab')
}

function toggleMuteBlockBtn() {
    let existingBtn = document.querySelector('.mb-ext_mute-block-btn')

    if(isProfileBlocked()) {
        existingBtn?.remove()
    }
    else {
        let target = getProfileButtonInsertionTarget()
        if(!target) return

        if(existingBtn && isProfileTargetPlacement(existingBtn, target)) return
        existingBtn?.remove()

        let btn = document.createElement('button')
        btn.innerText = 'Mute Block'
        btn.classList.add('mb-ext_mute-block-btn')

        bindSinglePressAction(btn, () => handleMuteBlockClick(btn))
        insertProfileActionButton(btn, target, 'mute-block')
    }
}

function toggleMuteBlockCloseBtn() {
    let existingBtn = document.querySelector('.mb-ext_mute-block-close-btn')

    if(isProfileBlocked()) {
        existingBtn?.remove()
    }
    else {
        let target = getProfileButtonInsertionTarget()
        if(!target) return

        if(existingBtn && isProfileTargetPlacement(existingBtn, target)) return
        existingBtn?.remove()

        let btn = document.createElement('button')
        btn.innerText = 'Mute Block Close'
        btn.classList.add('mb-ext_mute-block-close-btn')

        bindSinglePressAction(btn, () => handleMuteBlockClick(btn, true))
        insertProfileActionButton(btn, target, 'mute-block-close')
    }
}

async function handleMuteBlockClick(button, closeAfterSuccess = false) {
    if(profileActionInProgress) return

    profileActionInProgress = true

    const closeBtn = document.querySelector('.mb-ext_close-tab-btn')
    const muteBtn = document.querySelector('.mb-ext_mute-block-btn')
    const muteCloseBtn = document.querySelector('.mb-ext_mute-block-close-btn')
    const originalText = button.innerText
    const originalCloseText = closeBtn?.innerText || ''
    const originalMuteText = muteBtn?.innerText || ''
    const originalMuteCloseText = muteCloseBtn?.innerText || ''

    button.innerText = 'Working...'
    for(const managedButton of [closeBtn, muteBtn, muteCloseBtn]) {
        if(managedButton) managedButton.disabled = true
    }

    if(closeBtn) {
        closeBtn.innerText = 'Please wait...'
    }

    try {
        const ready = await waitForProfileActionReady()
        if(!ready) {
            alert('Profile actions not ready')
            return
        }

        if(isProfileBlocked()) {
            if(closeAfterSuccess) {
                button.innerText = 'Closing...'
                await new Promise(resolve => requestAnimationFrame(resolve))

                const closed = await requestCloseTab()
                if(closed) return
            }

            return
        }

        const completed = await muteProfile()

        if(completed && closeAfterSuccess) {
            button.innerText = 'Closing...'
            await new Promise(resolve => requestAnimationFrame(resolve))

            const closed = await requestCloseTab()
            if(closed) return
        }

        if(!completed && !isProfileBlocked()) {
            button.innerText = originalText

            if(closeBtn) {
                closeBtn.disabled = false
                closeBtn.innerText = originalCloseText
            }

            if(muteBtn) {
                muteBtn.disabled = false
                muteBtn.innerText = originalMuteText || 'Mute Block'
            }

            if(muteCloseBtn) {
                muteCloseBtn.disabled = false
                muteCloseBtn.innerText = originalMuteCloseText || 'Mute Block Close'
            }
        }
    }
    finally {
        profileActionInProgress = false

        if(!isProfileBlocked()) {
            ensureProfileButtons()
        }
        else if(closeBtn && document.body.contains(closeBtn)) {
            closeBtn.disabled = false
            if(closeBtn.innerText === 'Please wait...') {
                closeBtn.innerText = originalCloseText || 'Close tab'
            }
        }
    }
}

async function injectQuestionPageFOPBtn() {
    if(document.querySelector('.mb-ext_find-op-btn')) return true

    let container = getSortContainer()?.container
    if(container) {
        container = await maybeFlipQuestionFilterToAnswers(container)
    }

    const actionTarget = getQuestionButtonInsertionTarget()
    if(!actionTarget) return false

    function centeredQuestionPageBtnWrapper() {
        let div = document.createElement('div')
        div.dataset.mbQuestionBtnWrapper = 'true'
        div.classList.add('mb-ext_question-center-slot')
        div.appendChild(actionAnchor())

        return div
    }

    function actionAnchor() {
        let anchor = document.createElement('a')
        anchor.innerText = 'Original Poster Profile'
        anchor.classList.add('mb-ext_find-op-btn')
        anchor.target = '_blank'
        anchor.href = getQuestionOriginalPosterLookupHref()

        return anchor
    }

    const wrapper = actionTarget.type === 'between-filter-and-sort' ?
        centeredQuestionPageBtnWrapper() :
        actionAnchor()

    insertQuestionPageBtn(wrapper, actionTarget.element, actionTarget.type !== 'before-question-menu')
    return true
}

function insertQuestionPageBtn(wrapper, target, after = true) {
    if(target?.matches?.('.qu-justifyContent--space-between')) {
        const left = target.firstElementChild
        const right = target.lastElementChild
        const existing = target.querySelector('[data-mb-question-btn-wrapper]')

        if(existing) existing.remove()

        if(right && left && right !== left) {
            right.insertAdjacentElement('beforebegin', wrapper)
            return
        }
    }

    if(after) {
        target.insertAdjacentElement('afterend', wrapper)
    }
    else {
        target.insertAdjacentElement('beforebegin', wrapper)
    }
}

function scheduleOriginalPosterRedirect(delay = 250) {
    if(getPageType() !== 'question-log' || !shouldAutoRedirectToOriginalPoster()) return

    clearTimeout(originalPosterRedirectTimeout)
    originalPosterRedirectTimeout = setTimeout(() => {
        void maybeRedirectToOriginalPoster()
    }, delay)
}

async function maybeRedirectToOriginalPoster() {
    if(originalPosterRedirectPending || getPageType() !== 'question-log' || !shouldAutoRedirectToOriginalPoster()) return

    originalPosterRedirectPending = true

    try {
        for(let attempt = 0; attempt < 10; attempt++) {
            const profileHref = getOriginalPosterProfileHref()
            if(profileHref) {
                location.replace(profileHref)
                return
            }

            originalPosterRedirectAttempts = attempt + 1
            await sleep(350 + attempt * 100)
        }
    }
    finally {
        originalPosterRedirectPending = false
    }
}

function normalizeQuoraProfileHref(href) {
    if(!href) return null

    try {
        const url = new URL(href, location.origin)
        if(!/^\/profile\/[^/?#]+/i.test(url.pathname)) return null

        return `${url.origin}${url.pathname.replace(/\/$/, '')}`
    }
    catch {
        return null
    }
}

function getOriginalPosterProfileHrefFromInlineData() {
    const parsedProfileHref = getOriginalPosterProfileHrefFromInlinePayloads()
    if(parsedProfileHref) return parsedProfileHref

    const patterns = [
        /\\"contentObject\\":\{\\"__typename\\":\\"Question\\"[\s\S]{0,12000}?\\"asker\\":\{[\s\S]{0,4000}?\\"profileUrl\\":\\"(\/profile\/[^"\\?#]+)(?:[?#][^"\\]*)?\\"/,
        /"contentObject":\{"__typename":"Question"[\s\S]{0,12000}?"asker":\{[\s\S]{0,4000}?"profileUrl":"(\/profile\/[^"?#]+)(?:[?#][^"]*)?"/,
        /\\"asker\\":\{[\s\S]{0,4000}?\\"profileUrl\\":\\"(\/profile\/[^"\\?#]+)(?:[?#][^"\\]*)?\\"/,
        /"asker":\{[\s\S]{0,4000}?"profileUrl":"(\/profile\/[^"?#]+)(?:[?#][^"]*)?"/
    ]

    for(const script of Array.from(document.scripts || [])) {
        const text = script.textContent || ''
        if(!text || (!text.includes('ContentLogPageLoadableQuery') && !text.includes('asker') && !text.includes('contentObject'))) {
            continue
        }

        for(const pattern of patterns) {
            const match = text.match(pattern)
            const href = normalizeQuoraProfileHref(match?.[1])
            if(href) return href
        }
    }

    return null
}

function getOriginalPosterProfileHrefFromInlinePayloads() {
    for(const script of Array.from(document.scripts || [])) {
        const text = script.textContent || ''
        if(!text || !text.includes('ContentLogPageLoadableQuery')) continue

        const pushMatches = text.matchAll(/\.push\("((?:\\.|[^"\\])*)"\)/g)

        for(const match of pushMatches) {
            const escapedPayload = match[1]

            try {
                const payload = JSON.parse(`"${escapedPayload}"`)
                const data = JSON.parse(payload)
                const href = normalizeQuoraProfileHref(data?.data?.contentObject?.asker?.profileUrl)
                if(href) return href
            }
            catch {
                continue
            }
        }
    }

    return null
}

function getOriginalPosterProfileHref() {
    const inlineProfileHref = getOriginalPosterProfileHrefFromInlineData()
    if(inlineProfileHref) return inlineProfileHref

    const main = document.querySelector('#mainContent, main, [role="main"]') || document.body
    if(!main) return null

    const profileLinks = Array.from(main.querySelectorAll('a[href*="/profile/"]'))
        .filter(link => isVisible(link) && /^https:\/\/www\.quora\.com\/profile\/[^/?#]+/i.test(link.href))
        .map(link => ({link, score: scoreOriginalPosterLink(link)}))
        .filter(entry => entry.score > 0)

    profileLinks.sort((left, right) => right.score - left.score)
    return normalizeQuoraProfileHref(profileLinks[0]?.link.href) || null
}

function scoreOriginalPosterLink(link) {
    const href = link.href || ''
    if(!/\/profile\//i.test(href)) return Number.NEGATIVE_INFINITY

    const rect = link.getBoundingClientRect()
    const context = getBestActionContext(link)
    const contextText = `${getElementText(link)} ${context?.text || ''}`.toLowerCase()

    let score = 0

    if(/\basked\b/.test(contextText)) score += 2000
    if(/\bquestion\s+(?:added|created|asked)\b/.test(contextText)) score += 1600
    if(/\bcreated\b/.test(contextText) && /\bquestion\b/.test(contextText)) score += 1200
    if(/\blog\b/.test(contextText)) score += 60
    if(/\banswer(?:ed|er|s)?\b/.test(contextText)) score -= 600
    if(/\bcomment(?:ed|er|s)?\b/.test(contextText)) score -= 600
    if(/\bfollow(?:er|ing|s)?\b/.test(contextText)) score -= 400

    score -= rect.top / 20
    score -= rect.left / 200

    return score
}

function getSortContainer() {
    let questionMain = getQuestionMain()
    if (!questionMain) return null

    return {main: questionMain, container: findQuestionSortContainer(questionMain)}
}

function getQuestionFilterButton(container) {
    if(!container) return null

    const childGroups = Array.from(container.children || [])
    const fallbackButtons = []

    for(const group of childGroups) {
        const filterButton = group.querySelector('button[aria-haspopup="menu"], [role="button"][aria-haspopup="menu"]')
        if(!filterButton || !isVisible(filterButton)) continue

        const text = getElementText(filterButton)
        if(/\ball related\b|\banswers\b/i.test(text)) return filterButton

        fallbackButtons.push(filterButton)
    }

    return fallbackButtons[0] || null
}

function scoreQuestionSortContainer(container) {
    if(!container) return Number.NEGATIVE_INFINITY

    let score = 0
    const rect = container.getBoundingClientRect()
    const filterButton = getQuestionFilterButton(container)
    const filterText = getElementText(filterButton)
    const rightGroup = container.lastElementChild
    const rightText = getElementText(rightGroup)
    const rightMenu = rightGroup?.querySelector('button[aria-haspopup="menu"], [role="button"][aria-haspopup="menu"]')

    if(filterButton) score += 200
    if(/\ball related\b|\banswers\b/i.test(filterText)) score += 600
    if(rightGroup) score += 80
    if(/\bsort\b/i.test(rightText)) score += 220
    if(rightMenu && isVisible(rightMenu)) score += 120
    if(container.firstElementChild && container.lastElementChild && container.firstElementChild !== container.lastElementChild) score += 80
    score -= rect.top / 100

    return score
}

function findQuestionMenuOption(pattern) {
    const roots = getOverlayRoots(false)

    for(const root of roots) {
        const candidates = Array.from(root.querySelectorAll('.puppeteer_test_popover_item, [role="menuitem"], [role="option"], button, [role="button"]'))
        const option = candidates.find(candidate => {
            if(!isVisible(candidate)) return false

            const text = getElementText(candidate)
            if(!pattern.test(text)) return false

            // Avoid matching the already-selected "All related" row or inert wrappers.
            return !/\ball related\b/i.test(text)
        })

        if(option) return option
    }

    return null
}

async function maybeFlipQuestionFilterToAnswers(container) {
    if(!settings.flipToAnswers) return container

    const filterButton = getQuestionFilterButton(container)
    if(!filterButton) return container

    const currentFilter = getElementText(filterButton)
    if(/\banswers\b/i.test(currentFilter)) return container
    if(!/\ball related\b/i.test(currentFilter)) return container

    filterButton.click()
    await sleep(200)

    let answerOption = null

    for(let attempt = 0; attempt < 6; attempt++) {
        answerOption = findQuestionMenuOption(/\banswer(?:s)?\b/i)
        if(answerOption) break
        await sleep(150)
    }

    if(!answerOption) return container

    answerOption.click()
    await sleep(settings.fopFlipDelay)

    return getSortContainer()?.container || container
}

function collectSpacePostBodyProfileUrls(textRoot, excludedHref = null) {
    if(!textRoot) return []

    const urls = []
    const seen = new Set()

    for(const link of Array.from(textRoot.querySelectorAll('a[href*="/profile/"]'))) {
        if(!isVisible(link)) continue

        const href = normalizeQuoraProfileHref(link.href)
        if(!href || href === excludedHref || seen.has(href)) continue

        seen.add(href)
        urls.push(href)
    }

    return urls
}

function getSpacePostPrimaryBodyRoot() {
    const candidates = Array.from(document.querySelectorAll('.qu-userSelect--text'))
        .filter(isVisible)
        .map(root => ({root, urls: collectSpacePostBodyProfileUrls(root)}))
        .filter(candidate => candidate.urls.length >= SPACE_POST_NUKE_MIN_PROFILES)

    candidates.sort((left, right) => {
        const leftRect = left.root.getBoundingClientRect()
        const rightRect = right.root.getBoundingClientRect()

        return leftRect.top - rightRect.top || leftRect.left - rightRect.left
    })

    return candidates[0]?.root || null
}

function getSpacePostPrimaryPostContainer() {
    const bodyRoot = getSpacePostPrimaryBodyRoot()
    if(!bodyRoot) return null

    const main = document.querySelector('#mainContent, main, [role="main"]') || document.body
    let node = bodyRoot.parentElement

    while(node) {
        if(node.nodeType === Node.ELEMENT_NODE && node.querySelector('a.post_timestamp, .post_timestamp')) {
            return node
        }

        if(node === main) break
        node = node.parentElement
    }

    return null
}

function getSpacePostTimestampLink(scope = null) {
    const root = scope || getSpacePostPrimaryPostContainer() || document
    const timestamps = Array.from(root.querySelectorAll('a.post_timestamp, .post_timestamp'))
        .filter(isVisible)

    timestamps.sort((left, right) => {
        const leftRect = left.getBoundingClientRect()
        const rightRect = right.getBoundingClientRect()

        return leftRect.top - rightRect.top || leftRect.left - rightRect.left
    })

    return timestamps[0] || null
}

function getSpacePostHeaderContainer() {
    const scopedContainer = getSpacePostPrimaryPostContainer()
    const timestamp = getSpacePostTimestampLink(scopedContainer)
    if(!timestamp) return scopedContainer || null

    const main = scopedContainer || document.querySelector('#mainContent, main, [role="main"]') || document.body
    const timestampRect = timestamp.getBoundingClientRect()
    let node = timestamp.parentElement
    let bestMatch = null

    while(node) {
        if(node.nodeType !== Node.ELEMENT_NODE) {
            node = node.parentElement
            continue
        }

        const followButtons = getSpacePostHeaderActionCandidates(node)
        const profileLinks = Array.from(node.querySelectorAll('a[href*="/profile/"]')).filter(isVisible)
        const rect = node.getBoundingClientRect()
        let score = 0

        if(followButtons.length) score += 600
        if(profileLinks.length) score += 240
        if(profileLinks.length <= 3) score += 120
        score -= Math.abs(rect.top - timestampRect.top) / 4

        if(score > 0 && (!bestMatch || score > bestMatch.score)) {
            bestMatch = {node, score}
        }

        if(node === main) break
        node = node.parentElement
    }

    return bestMatch?.node || timestamp.parentElement || null
}

function getSpacePostHeaderActionCandidates(root) {
    if(!root) return []

    const candidates = Array.from(root.querySelectorAll('button, a, [role="button"], .q-click-wrapper[tabindex], [tabindex="0"]'))
        .filter(isVisible)
        .filter(candidate => /^follow(?:ing| back)?$/i.test(getElementText(candidate)))

    candidates.sort((left, right) => {
        const leftRect = left.getBoundingClientRect()
        const rightRect = right.getBoundingClientRect()

        return leftRect.top - rightRect.top || leftRect.left - rightRect.left
    })

    return candidates
}

function getSpacePostHeaderActionAnchor() {
    const container = getSpacePostHeaderContainer()
    if(!container) return null

    const timestamp = getSpacePostTimestampLink()
    if(timestamp && container.contains(timestamp)) return timestamp

    const followButtons = getSpacePostHeaderActionCandidates(container)
    if(followButtons.length) return followButtons[followButtons.length - 1]

    const profileLinks = Array.from(container.querySelectorAll('a[href*="/profile/"]')).filter(isVisible)
    profileLinks.sort((left, right) => {
        const leftRect = left.getBoundingClientRect()
        const rightRect = right.getBoundingClientRect()

        return leftRect.top - rightRect.top || leftRect.left - rightRect.left
    })

    return profileLinks[0] || null
}

function getSpacePostHeaderProfileHref() {
    const container = getSpacePostHeaderContainer()
    if(!container) return null

    const profileLinks = Array.from(container.querySelectorAll('a[href*="/profile/"]')).filter(isVisible)
    profileLinks.sort((left, right) => {
        const leftRect = left.getBoundingClientRect()
        const rightRect = right.getBoundingClientRect()

        return leftRect.top - rightRect.top || leftRect.left - rightRect.left
    })

    return normalizeQuoraProfileHref(profileLinks[0]?.href) || null
}

function getSpacePostContentRoot() {
    const scopedContainer = getSpacePostPrimaryPostContainer()
    if(scopedContainer) return scopedContainer

    const timestamp = getSpacePostTimestampLink()
    if(!timestamp) return null

    const main = document.querySelector('#mainContent, main, [role="main"]') || document.body
    const timestampRect = timestamp.getBoundingClientRect()
    let node = timestamp.parentElement
    let bestMatch = null

    while(node) {
        if(node.nodeType !== Node.ELEMENT_NODE) {
            node = node.parentElement
            continue
        }

        const profileLinks = Array.from(node.querySelectorAll('a[href*="/profile/"]')).filter(isVisible)
        const bodyText = node.querySelector('.qu-userSelect--text, p')
        const rect = node.getBoundingClientRect()
        let score = 0

        if(bodyText) score += 700
        if(profileLinks.length >= SPACE_POST_NUKE_MIN_PROFILES) score += 500
        else if(profileLinks.length >= 2) score += 180
        if(profileLinks.length > 40) score -= 500
        score -= Math.abs(rect.top - timestampRect.top) / 6

        if(score > 0 && (!bestMatch || score > bestMatch.score)) {
            bestMatch = {node, score}
        }

        if(node === main) break
        node = node.parentElement
    }

    return bestMatch?.node || getSpacePostHeaderContainer()
}

function getSpacePostListedProfileLinks() {
    const headerProfileHref = getSpacePostHeaderProfileHref()
    const primaryBodyRoot = getSpacePostPrimaryBodyRoot()
    if(primaryBodyRoot) {
        return collectSpacePostBodyProfileUrls(primaryBodyRoot, headerProfileHref)
    }

    const root = getSpacePostContentRoot()
    if(!root) return []

    const headerAnchor = getSpacePostHeaderActionAnchor()
    const headerBottom = headerAnchor?.getBoundingClientRect().bottom || getSpacePostTimestampLink()?.getBoundingClientRect().bottom || 0
    let actionBarTop = Infinity

    for(const candidate of Array.from(root.querySelectorAll('button, a, [role="button"]'))) {
        if(!isVisible(candidate)) continue

        const label = getElementText(candidate).trim()
        if(!/^(?:upvote|comment|share|save)$/i.test(label)) continue

        const rect = candidate.getBoundingClientRect()
        if(rect.top > headerBottom + 12) {
            actionBarTop = Math.min(actionBarTop, rect.top)
        }
    }

    const bodyTextRoots = Array.from(root.querySelectorAll('.qu-userSelect--text'))
        .filter(isVisible)
        .filter(textRoot => {
            const rect = textRoot.getBoundingClientRect()
            if(rect.top <= headerBottom + 12) return false
            if(Number.isFinite(actionBarTop) && rect.top >= actionBarTop - 12) return false
            return true
        })

    const urls = []
    const seen = new Set()

    for(const textRoot of bodyTextRoots) {
        for(const link of Array.from(textRoot.querySelectorAll('a[href*="/profile/"]'))) {
            if(!isVisible(link)) continue

            const href = normalizeQuoraProfileHref(link.href)
            if(!href || href === headerProfileHref || seen.has(href)) continue

            const rect = link.getBoundingClientRect()
            if(headerBottom && rect.top <= headerBottom + 12) continue
            if(Number.isFinite(actionBarTop) && rect.top >= actionBarTop - 12) continue

            seen.add(href)
            urls.push(href)
        }
    }

    return urls
}

function setSpacePostNukeUrls(button, urls) {
    if(!button) return
    button.dataset.mbNukeUrls = JSON.stringify(urls || [])
}

function getSpacePostNukeUrls(button) {
    if(!button) return []

    try {
        const urls = JSON.parse(button.dataset.mbNukeUrls || '[]')
        return Array.isArray(urls) ? urls : []
    }
    catch {
        return []
    }
}

function getSpacePostButtonHost() {
    const postContainer = getSpacePostPrimaryPostContainer() || getSpacePostContentRoot()
    const headerContainer = getSpacePostHeaderContainer()
    if(!postContainer) return null

    const main = document.querySelector('#mainContent, main, [role="main"]') || document.body
    let anchorContainer = postContainer
    let node = postContainer.parentElement

    while(node) {
        if(node.nodeType !== Node.ELEMENT_NODE) {
            node = node.parentElement
            continue
        }

        const rect = node.getBoundingClientRect()
        const currentRect = anchorContainer.getBoundingClientRect()
        const isMeaningfullyWider = rect.width >= currentRect.width + 24
        const isReasonableHeight = rect.height <= currentRect.height * 1.75
        const isNotTooWide = rect.width <= postContainer.getBoundingClientRect().width * 1.5

        if(isMeaningfullyWider && isReasonableHeight && isNotTooWide) {
            anchorContainer = node
        }

        if(node === main) break
        node = node.parentElement
    }

    let slot = anchorContainer.querySelector(':scope > .mb-ext_post-nuke-slot')
    if(slot) return slot

    slot = document.createElement('div')
    slot.className = 'mb-ext_post-nuke-slot'
    anchorContainer.classList.add('mb-ext_post-card')

    if(headerContainer && postContainer.contains(headerContainer)) {
        headerContainer.classList.add('mb-ext_post-header-host')

        const headerRect = headerContainer.getBoundingClientRect()
        const anchorRect = anchorContainer.getBoundingClientRect()
        const top = Math.max(10, Math.round(headerRect.top - anchorRect.top + headerRect.height / 2))
        slot.style.top = `${top}px`
    }

    anchorContainer.appendChild(slot)
    return slot
}

function injectSpacePostNukeBtn() {
    let btn = document.querySelector('.mb-ext_post-nuke-btn')
    const host = getSpacePostButtonHost()
    if(!host) {
        btn?.remove()
        return false
    }

    const urls = getSpacePostListedProfileLinks()
    if(urls.length < SPACE_POST_NUKE_MIN_PROFILES) {
        btn?.remove()
        return false
    }

    if(btn && btn.parentElement !== host) {
        btn.remove()
        btn = null
    }

    if(!btn) {
        btn = document.createElement('button')
        btn.innerText = `Nuke 'Em`
        btn.classList.add('mb-ext_nuke-profiles-btn', 'mb-ext_post-nuke-btn')
        btn.addEventListener('click', async () => {
            const liveUrls = getSpacePostListedProfileLinks()
            const currentUrls = liveUrls.length ? liveUrls : getSpacePostNukeUrls(btn)
            if(!currentUrls.length) return

            await animateNukeButtonPress(btn)
            btn.disabled = true
            setNukeButtonWorking(btn)

            try {
                const result = await safeSendRuntimeMessage({
                    action: 'enqueue-tabs',
                    urls: currentUrls,
                    tabAction: 'nuke',
                    maxConcurrent: getProfilesPerBatch()
                }, {queued: 0})

                if((result?.queued || 0) > 0) {
                    await waitForOwnedNukeTabsToDrain(btn)
                }
                else {
                    const sweep = await sweepBlockedProfileTabs()
                    if(sweep.owned > 0) {
                        await waitForOwnedNukeTabsToDrain(btn)
                    }
                    else {
                        setNukeButtonIdle(btn)
                        alert('Nothing was queued')
                    }
                }
            }
            finally {
                btn.disabled = false
            }
        })
    }
    else {
        if(btn.dataset.mbNukeState !== 'working' && btn.dataset.mbNukeState !== 'done') {
            setNukeButtonIdle(btn)
        }
    }

    setSpacePostNukeUrls(btn, urls)
    host.classList.add('mb-ext_post-header-host', 'mb-ext_post-nuke-slot')

    if(btn.parentElement !== host) {
        host.insertAdjacentElement('beforeend', btn)
    }

    return true
}

function injectSpaceSidebarOpenProfilesBtn() {
    if(document.querySelector('.mb-ext_view-contributors-btn, .mb-ext_open-profiles-btn')) return

    const XPATH = "//div[contains(@class, 'q-click-wrapper') and contains(string(), 'View all')]"
    let query = document.evaluate(XPATH, document, null, XPathResult.ORDERED_NODE_SNAPSHOT_TYPE, null)

    let viewLink = query.snapshotItem(0)

    if(viewLink) {
        let btn = document.createElement('button')
        btn.innerText = 'View Contributors'
        btn.classList.add('mb-ext_open-profiles-btn', 'mb-ext_view-contributors-btn')
        btn.addEventListener('click', () => viewLink.click())

        viewLink.insertAdjacentElement('afterend', btn)
    }
    else {
        const XPATH = "//div[contains(@class, 'q-box') and contains(string(), 'Contributor')]"
        let query = document.evaluate(XPATH, document, null, XPathResult.ORDERED_NODE_SNAPSHOT_TYPE, null)

        let qbox = query.snapshotItem(query.snapshotLength-1)
        if(!qbox) return

        let btn = document.createElement('button')
        btn.innerHTML = `Open Profiles <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" stroke-width="2" stroke="currentColor" fill="none" stroke-linecap="round" stroke-linejoin="round">
            <path stroke="none" d="M0 0h24v24H0z" fill="none"/>
            <path d="M12 6h-6a2 2 0 0 0 -2 2v10a2 2 0 0 0 2 2h10a2 2 0 0 0 2 -2v-6" />
            <path d="M11 13l9 -9" />
            <path d="M15 4h5v5" />
        </svg>`

        btn.classList.add('mb-ext_open-profiles-btn')
        btn.addEventListener('click', e => {
            let items = document.querySelectorAll('.tribe_page_header_people_list_item:not([data-mb-opened])')

            for (const item of items) {
                item.dataset.mbOpened = true

                let link = item.querySelector('a[href*="/profile/"]')
                void safeSendRuntimeMessage({action: 'create-tab', url: link.href})

                item.style.backgroundColor = '#d4edda'
            }
        })

        qbox.insertAdjacentElement('afterend', btn)
    }
}

function injectModalOpenProfilesBtn() {
    const modal = syncActiveProfileModal(getProfilePeopleModal())
    if(!modal) return

    let items = getUnhandledProfileModalItems(modal)
    if(!items.length) return

    let dismissBtn = modal.querySelector('button[aria-label="Dismiss"]')
    if(!dismissBtn?.parentElement) return

    let btn = modal.querySelector('.mb-ext_open-profiles-btn')
    if(!btn) {
        btn = document.createElement('button')
        btn.classList.add('mb-ext_open-profiles-btn')
        btn.addEventListener('click', () => openModalProfiles())
        dismissBtn.parentElement.insertAdjacentElement('beforeend', btn)
    }

    btn.innerHTML = `${getModalOpenProfilesLabel(modal)} <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" stroke-width="2" stroke="currentColor" fill="none" stroke-linecap="round" stroke-linejoin="round">
        <path stroke="none" d="M0 0h24v24H0z" fill="none"/>
        <path d="M12 6h-6a2 2 0 0 0 -2 2v10a2 2 0 0 0 2 2h10a2 2 0 0 0 2 -2v-6" />
        <path d="M11 13l9 -9" />
        <path d="M15 4h5v5" />
    </svg>`
    btn.disabled = false

    let nukeBtn = modal.querySelector('.mb-ext_nuke-profiles-btn')
    if(!nukeBtn) {
        nukeBtn = document.createElement('button')
        nukeBtn.innerText = `Nuke 'Em`
        nukeBtn.classList.add('mb-ext_nuke-profiles-btn')
        nukeBtn.addEventListener('click', () => void nukeModalProfiles())
        dismissBtn.parentElement.insertAdjacentElement('beforeend', nukeBtn)
    }

    if(nukeBtn.dataset.mbNukeState !== 'working' && nukeBtn.dataset.mbNukeState !== 'done') {
        setNukeButtonIdle(nukeBtn)
    }
    nukeBtn.disabled = false
}

function getModalOpenProfilesLabel(modal = getProfilePeopleModal()) {
    const tabLabel = getActiveProfileModalTabLabel(modal)

    if(tabLabel === 'Followers') return 'Open Followers'
    if(tabLabel === 'Following') return 'Open Following'
    return 'Open Profiles'
}

function getProfilesPerBatch() {
    const value = Number.parseInt(settings.profilesPerBatch, 10)
    if(!Number.isFinite(value) || value < 1) return defaults.profilesPerBatch
    return value
}

function getModalProfileActionButtons(modal = getProfilePeopleModal()) {
    return {
        open: modal?.querySelector('.mb-ext_open-profiles-btn') || null,
        nuke: modal?.querySelector('.mb-ext_nuke-profiles-btn') || null
    }
}

function disableModalProfileActionButtons(modal, nukeText = 'Nuking...') {
    const buttons = getModalProfileActionButtons(modal)

    if(buttons.open) {
        buttons.open.disabled = true
        buttons.open.innerText = 'Please wait...'
    }

    if(buttons.nuke) {
        buttons.nuke.disabled = true
        setNukeButtonWorking(buttons.nuke, nukeText)
    }
}

function resetModalProfileActionButtons(modal) {
    const buttons = getModalProfileActionButtons(modal)

    if(buttons.open) {
        buttons.open.disabled = false
        buttons.open.innerHTML = `${getModalOpenProfilesLabel(modal)} <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" stroke-width="2" stroke="currentColor" fill="none" stroke-linecap="round" stroke-linejoin="round">
            <path stroke="none" d="M0 0h24v24H0z" fill="none"/>
            <path d="M12 6h-6a2 2 0 0 0 -2 2v10a2 2 0 0 0 2 2h10a2 2 0 0 0 2 -2v-6" />
            <path d="M11 13l9 -9" />
            <path d="M15 4h5v5" />
        </svg>`
    }

    if(buttons.nuke) {
        buttons.nuke.disabled = false
        if(buttons.nuke.dataset.mbNukeState === 'done') {
            setNukeButtonDone(buttons.nuke)
        }
        else {
            setNukeButtonIdle(buttons.nuke)
        }
    }
}

function getHandledProfileModalItems(modal = getProfilePeopleModal()) {
    modal = syncActiveProfileModal(modal)
    return getProfileModalItems(modal).filter(isModalItemHandled)
}

function getModalProfileLinks(items) {
    const urls = []
    const seen = new Set()

    for(const item of items) {
        const href = getModalItemProfileHref(item)
        if(!href || seen.has(href)) continue

        seen.add(href)
        urls.push(href)
    }

    return urls
}

function openModalProfiles(afterTimeout = false) {
    const modal = syncActiveProfileModal(getProfilePeopleModal())
    if(!modal) return

    const openProfiles = items => {
        for (const item of items) {
            let link = getModalItemProfileHref(item)
            if(!link) continue

            void safeSendRuntimeMessage({action: 'create-tab', url: link})
            item.scrollIntoView({block: 'nearest'})
        }

        markModalItemsHandled(items, '#d4edda')
    }

    const listItems = getUnhandledProfileModalItems(modal)

    let openProfilesBtn = getModalProfileActionButtons(modal).open
    if(!openProfilesBtn) return

    if(afterTimeout) {
        openProfilesBtn.remove()
        openProfiles(listItems)
    }
    else {
        resetModalProfileActionButtons(modal)

        const profilesPerBatch = getProfilesPerBatch()

        if(listItems.length < profilesPerBatch) {
            let openedItems = getHandledProfileModalItems(modal)

            if(openedItems.length) {
                profilesModalTimeout = setTimeout(openModalProfiles, 5000, true)

                disableModalProfileActionButtons(modal)

                openedItems[openedItems.length - 1].scrollIntoView({block: 'nearest'})
            }
            else {
                openProfilesBtn.remove()
                openProfiles(listItems)
            }
        }
        else {
            openProfiles(Array.from(listItems).slice(0, profilesPerBatch))
        }
    }
}

async function nukeModalProfiles() {
    const modal = syncActiveProfileModal(getProfilePeopleModal())
    if(!modal) return

    if(modal.dataset.mbNuking === 'true') return

    let items = getUnhandledProfileModalItems(modal)
    if(!items.length) {
        const buttons = getModalProfileActionButtons(modal)
        setNukeButtonDone(buttons.nuke, 'Rubble')
        return
    }

    const buttons = getModalProfileActionButtons(modal)
    await animateNukeButtonPress(buttons.nuke)
    modal.dataset.mbNuking = 'true'
    disableModalProfileActionButtons(modal)

    try {
        const maxConcurrent = getProfilesPerBatch()
        let idlePasses = 0

        while(idlePasses < 3) {
            items = getUnhandledProfileModalItems(modal)

            if(items.length) {
                const urls = getModalProfileLinks(items)

                if(urls.length) {
                    const result = await safeSendRuntimeMessage({
                        action: 'enqueue-tabs',
                        urls,
                        tabAction: 'nuke',
                        maxConcurrent
                    }, {queued: 0})

                    if((result?.queued || 0) <= 0) {
                        const sweep = await sweepBlockedProfileTabs()
                        if(sweep.owned > 0) {
                            await waitForOwnedNukeTabsToDrain(buttons.nuke)
                            break
                        }

                        setNukeButtonDone(buttons.nuke, 'Rubble')
                        return
                    }

                    markModalItemsHandled(items, '#f8d7da')
                    items[items.length - 1].scrollIntoView({block: 'nearest'})
                    idlePasses = 0
                }
                else {
                    idlePasses += 1
                }
            }
            else {
                idlePasses += 1
            }

            if(idlePasses < 3) await sleep(1500)
        }

        await waitForOwnedNukeTabsToDrain(buttons.nuke)
    }
    finally {
        delete modal.dataset.mbNuking

        if(getUnhandledProfileModalItems(modal).length) {
            resetModalProfileActionButtons(modal)
        }
        else {
            const buttons = getModalProfileActionButtons(modal)
            buttons.open?.remove()
            buttons.nuke?.remove()
        }
    }
}

async function maybeRunAutoProfileAction() {
    if(getPageType() !== 'profile' || autoProfileActionPending) return

    if(autoProfileAction === undefined) {
        autoProfileActionAttempts += 1
        autoProfileAction = await safeSendRuntimeMessage({action: 'claim-tab-action'}, null)

        if(!autoProfileAction && autoProfileActionAttempts < 6) {
            autoProfileAction = undefined
            setTimeout(() => void maybeRunAutoProfileAction(), 500)
            return
        }
    }

    if(autoProfileAction !== 'nuke') return

    autoProfileActionPending = true
    autoProfileAction = null
    autoProfileActionAttempts = 0

    try {
        scheduleBlockedProfileCloseChecks()

        let queuedTabReleased = false
        const releaseQueuedTabSlot = async () => {
            if(queuedTabReleased) return true
            queuedTabReleased = await notifyQueuedTabComplete()
            return queuedTabReleased
        }
        const closeQueuedBlockedTab = async () => {
            await releaseQueuedTabSlot()
            await requestCloseTab()
        }
        const abandonQueuedTab = async message => {
            console.warn(message)
            await releaseQueuedTabSlot()
            await requestCloseTab(1, 0, false)
        }

        if(isProfileBlocked()) {
            await closeQueuedBlockedTab()
            return
        }

        const ready = await waitForCondition(() => isProfileBlocked() || !!getProfileMenuButton(), 15000, 250)
        if(!ready) {
            await abandonQueuedTab('Profile actions not ready')
            return
        }

        if(isProfileBlocked()) {
            await closeQueuedBlockedTab()
            return
        }

        if(!isProfileBlocked()) {
            const completed = await muteProfile({allowBlockFallback: true, silent: true})
            if(!completed && !isProfileBlocked()) {
                await abandonQueuedTab('Queued profile action did not complete')
                return
            }
        }

        if(isProfileBlocked()) {
            await closeQueuedBlockedTab()
            return
        }

        const blocked = await waitForCondition(() => isProfileBlocked(), 2500, 250)
        if(blocked || isProfileBlocked()) {
            await closeQueuedBlockedTab()
        }
        else {
            await abandonQueuedTab('Queued profile never reached blocked state')
        }
    }
    finally {
        autoProfileActionPending = false
    }
}

function reportActionIssue(message, silent = false) {
    console.warn(message)
    if(!silent) alert(message)
}

async function muteProfile(options = {}) {
    const {allowBlockFallback = false, silent = false} = options
    const menuOpened = await ensureProfileMenuOpen(2500, silent)
    if(!menuOpened) {
        return allowBlockFallback ? blockProfile({silent}) : false
    }

    await sleep(500)

    const muteState = await waitForMenuState(/\bmute\b/i, /\bunmute\b/i, 5000, 250)
    if(muteState?.state === 'inverse') {
        await closeProfileMenu()
    }
    else {
        let muteBtn = muteState?.button || getMenuAction(/\bmute\b/i)
        if(!muteBtn) {
            reportActionIssue('Mute option not found', silent)
            return allowBlockFallback ? blockProfile({silent}) : false
        }

        muteBtn.click()

        let confirmBtn = await waitForAction(() => getMuteConfirmAction(), 8000, 250)
        if(!confirmBtn) {
            reportActionIssue('Confirm button not found', silent)
            return allowBlockFallback ? blockProfile({silent}) : false
        }

        confirmBtn.click()

        let confirmClosed = await waitForCondition(() => !isMuteConfirmPending(), 2500, 250)
        if(!confirmClosed) {
            confirmBtn = getMuteConfirmAction()
            if(confirmBtn) confirmBtn.click()
            confirmClosed = await waitForCondition(() => !isMuteConfirmPending(), 6000, 250)
        }

        if(!confirmClosed) {
            reportActionIssue('Mute confirm did not complete', silent)
            return allowBlockFallback ? blockProfile({silent}) : false
        }

        const mutedApplied = await waitForProfileMenuState('inverse', /\bmute\b/i, /\bunmute\b/i, 8000, 500)
        if(!mutedApplied) {
            reportActionIssue('Mute did not take effect', silent)
            return allowBlockFallback ? blockProfile({silent}) : false
        }

        await sleep(300)
    }

    return blockProfile({silent})
}

async function blockProfile(options = {}) {
    const {silent = false} = options

    if(isProfileBlocked()) {
        return true
    }

    const menuOpened = await ensureProfileMenuOpen(2500, silent)
    if(!menuOpened) return false

    await sleep(500)

    const blockState = await waitForMenuState(/\bblock\b/i, /\bunblock\b/i, 5000, 250)
    if(blockState?.state === 'inverse') {
        await closeProfileMenu()
        rememberProfileBlocked()
        return true
    }

    let blockOpt = blockState?.button || getMenuAction(/\bblock\b/i)
    if(!blockOpt) {
        if(isProfileBlocked()) {
            return true
        }

        reportActionIssue('Block option not found', silent)
        return false
    }

    const initialMutationCount = profileBlockMutationCount
    blockOpt.click()

    let blockBtn = await waitForAction(() => getBlockConfirmAction(), 8000, 250)
    if(!blockBtn) {
        reportActionIssue('Block button not found', silent)
        return false
    }

    blockBtn.click()

    const mutationSeen = await waitForCondition(() => profileBlockMutationCount > initialMutationCount, 5000, 250)
    if(mutationSeen) rememberProfileBlocked()

    let blockClosed = mutationSeen || await waitForCondition(() => !isBlockConfirmPending(), 2500, 250)
    if(!blockClosed) {
        blockBtn = getBlockConfirmAction()
        if(blockBtn) blockBtn.click()
        blockClosed = await waitForCondition(() => !isBlockConfirmPending(), 6000, 250)
    }

    if(!blockClosed && !isProfileBlocked()) {
        reportActionIssue('Block confirm did not complete', silent)
        return false
    }

    const blockedApplied = mutationSeen || await waitForCondition(() => isProfileBlocked(), 8000, 250)
    if(!blockedApplied) {
        const blockedViaMenu = await waitForProfileMenuState('inverse', /\bblock\b/i, /\bunblock\b/i, 6000, 500)
        if(!blockedViaMenu) {
            reportActionIssue('Block did not take effect', silent)
            return false
        }
    }

    rememberProfileBlocked()
    scheduleProfileButtonsRefresh(150)
    await waitForCondition(() => !document.querySelector('.mb-ext_mute-block-btn'), 3000, 150)
    return true
}

function toggleMenu(silent = false) {
    let menu = getProfileMenuButton()
    if(!menu) {
        reportActionIssue('Profile menu not found', silent)
        return false
    }

    menu.click()
    return true
}

function isProfileMenuOpen() {
    const menuButton = getProfileMenuButton()
    if(menuButton?.getAttribute('aria-expanded') === 'true') return true

    return getOverlayRoots(false).some(root => {
        return root.matches('[role="menu"]') || root.querySelector?.('[role="menuitem"]')
    })
}

async function ensureProfileMenuOpen(timeoutMs = 2500, silent = false) {
    if(isProfileMenuOpen()) return true
    if(!toggleMenu(silent)) return false

    const opened = await waitForCondition(() => isProfileMenuOpen(), timeoutMs, 100)
    if(!opened) {
        reportActionIssue('Profile menu did not open', silent)
        return false
    }

    return true
}

async function closeProfileMenu(timeoutMs = 1500) {
    if(!isProfileMenuOpen()) return true
    if(!toggleMenu()) return false

    return waitForCondition(() => !isProfileMenuOpen(), timeoutMs, 100)
}

function sleep(ms) {
    return new Promise(r => setTimeout(r, ms))
}
