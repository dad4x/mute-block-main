const browser = require('webextension-polyfill')
const defaults = require('./defaults')

let profilesModalTimeout
let profileButtonsTimeout
let profileButtonsRefreshTimeout
let profileButtonsPending = false
let questionPageBtnTimeout
let questionPageBtnPending = false
let currentUrl = location.href
let settings = {...defaults}

addEventListener('load', init)

async function init() {
    settings = await browser.storage.local.get(defaults)
    browser.runtime.onMessage.addListener(onMessage)
    installNavigationHooks()

    const page = getPageType()

    if(page === 'profile') {
        ensureProfileButtons()
    }
    else if(page === 'question') {
        ensureQuestionPageFOPBtn()
    }
    else if(page === 'space') {
        injectSpaceSidebarOpenProfilesBtn()
    }

    startObserver()
}

function startObserver() {
    new MutationObserver(async mutations => {
        if(location.href !== currentUrl) {
            currentUrl = location.href
            resetQuestionPageBtn()
        }

        const page = getPageType()

        if(page === 'profile' && shouldRefreshProfileButtons(mutations)) {
            scheduleProfileButtonsRefresh()
        }

        if(page === 'question') {
            ensureQuestionPageFOPBtn()
        }

        let modal = document.querySelector('[role="dialog"][aria-modal="true"]:not([data-mb-checked])')
        if(!modal) return

        modal.dataset.mbChecked = true
        console.log('modal opened')

        let tabs = Array.from(modal.querySelectorAll('.q-click-wrapper[role="tab"]'))
        let tabMatched = tabs.some(tab => /followers|following/i.test(tab.innerText))

        if(tabMatched) {
            console.log('followers+following modal opened')
            await sleep(1e3)

            let items = document.querySelectorAll('.modal_content_inner [role="listitem"]:not([data-mb-opened])')
            if(items.length) injectModalOpenProfilesBtn()
        }
    }).observe(document.body, {childList: true, subtree: true})
}

function syncProfileButtons() {
    injectCloseTabBtn()
    toggleMuteBlockBtn()
}

function hasProfileButtons() {
    const hasCloseBtn = !!document.querySelector('.mb-ext_close-tab-btn')
    const hasMuteBtn = !!document.querySelector('.mb-ext_mute-block-btn') || isProfileBlocked()
    return hasCloseBtn && hasMuteBtn
}

function shouldRefreshProfileButtons(mutations) {
    if(profileButtonsPending) return false
    if(hasProfileButtons()) return false

    return mutations.some(mutation => {
        return Array.from(mutation.removedNodes).some(node => {
            return node.nodeType === Node.ELEMENT_NODE &&
                (node.matches?.('.mb-ext_close-tab-btn, .mb-ext_mute-block-btn') ||
                    node.querySelector?.('.mb-ext_close-tab-btn, .mb-ext_mute-block-btn'))
        }) || Array.from(mutation.addedNodes).some(node => {
            return node.nodeType === Node.ELEMENT_NODE &&
                (node.matches?.('[role="menu"], [data-popper-placement], [aria-haspopup="menu"]') ||
                    node.querySelector?.('[role="menu"], [data-popper-placement], [aria-haspopup="menu"]'))
        })
    })
}

function scheduleProfileButtonsRefresh(delay = 400) {
    clearTimeout(profileButtonsRefreshTimeout)
    profileButtonsRefreshTimeout = setTimeout(() => ensureProfileButtons(), delay)
}

function ensureProfileButtons() {
    if(profileButtonsPending) return

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
                profileButtonsTimeout = setTimeout(() => trySync(retriesLeft - 1), 750)
            }
        }
    }

    profileButtonsTimeout = setTimeout(() => trySync(8), 200)
}

function onMessage(request, sender, sendResponse) {
    console.log(request)

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
            let btn = document.querySelector('.mb-ext_open-profiles-btn')

            if(btn && btn.disabled) {
                btn.disabled = false
                clearTimeout(profilesModalTimeout)
                setTimeout(openModalProfiles, 2e3)
            }
            break
        }
        case 'profile-block-updated':
            ensureProfileButtons()
            toggleMuteBlockBtn()
            break
        case 'question-page-loaded':
            ensureQuestionPageFOPBtn()
            break
        case 'question-log-loaded':
            break
        default:
            console.warn(`Unknown status: ${request.status}`)
    }
}

function ensureQuestionPageFOPBtn() {
    const expectedHref = getQuestionLogHref()
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

    questionPageBtnTimeout = setTimeout(() => tryInject(10), settings.fopDelay)
}

function resetQuestionPageBtn() {
    clearTimeout(questionPageBtnTimeout)
    questionPageBtnPending = false

    document.querySelectorAll('.mb-ext_find-op-btn').forEach(removeQuestionPageBtn)
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

function installNavigationHooks() {
    if(window.__mbNavHooksInstalled) return
    window.__mbNavHooksInstalled = true

    const notify = () => {
        setTimeout(() => {
            if(location.href === currentUrl) return

            currentUrl = location.href
            clearTimeout(profileButtonsTimeout)
            profileButtonsPending = false
            resetQuestionPageBtn()

            if(getPageType() === 'profile') {
                ensureProfileButtons()
            }
            else if(getPageType() === 'question') {
                ensureQuestionPageFOPBtn()
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
    else if(document.querySelector('.puppeteer_test_tribe_info_header')) {
        return 'space'
    }
    else if(isQuestionPage()) {
        return 'question'
    }

    return false
}

function isQuestionPage() {
    if(isSecurityVerificationPage()) return false
    if(/\/answer\//i.test(location.pathname)) return false
    if(document.querySelector('.puppeteer_test_question_main')) return true
    if(findQuestionSortContainer()) return true

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

function getProfilePrimaryAction() {
    const actionRow = getProfileActionRow()
    if(!actionRow) return null

    const actionButtons = getActionButtons(actionRow, /^(follow|following|requested)$/i)
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

    const primaryCandidates = getVisibleButtons(main).filter(button => {
        return /^(follow|following|requested)$/i.test(getElementText(button))
    })

    primaryCandidates.sort((left, right) => {
        const leftRect = left.getBoundingClientRect()
        const rightRect = right.getBoundingClientRect()

        return leftRect.top - rightRect.top || leftRect.left - rightRect.left
    })

    for(const primaryAction of primaryCandidates) {
        let node = primaryAction.parentElement

        while(node && node !== document.body) {
            const sameRowButtons = getVisibleButtons(node).filter(button => isSameRow(primaryAction, button))
            const actionButtons = sameRowButtons.filter(button => /^(follow|following|requested|notify me|ask)$/i.test(getElementText(button)))
            const menuButtons = sameRowButtons.filter(button => button.getAttribute('aria-haspopup') === 'menu')
            const rowTexts = actionButtons.map(button => getElementText(button).toLowerCase())
            const hasSecondaryAction = rowTexts.includes('notify me') || rowTexts.includes('ask')

            if(actionButtons.includes(primaryAction) &&
                actionButtons.length >= 3 &&
                actionButtons.length <= 4 &&
                hasSecondaryAction &&
                menuButtons.length === 1 &&
                sameRowButtons.length <= 6) {
                return node
            }

            node = node.parentElement
        }
    }

    return null
}

function isProfileTargetPlacement(button, target) {
    if(!button || !target?.element) return false
    if(button.parentElement !== target.element.parentElement) return false

    if(target.type === 'before-menu') {
        if(button.classList?.contains('mb-ext_mute-block-btn')) {
            return button.nextElementSibling === target.element
        }

        const next = button.nextElementSibling
        return next === target.element || next?.classList?.contains('mb-ext_mute-block-btn')
    }

    if(target.element.nextElementSibling === button) return true

    if(button.classList?.contains('mb-ext_mute-block-btn')) {
        const firstSibling = target.element.nextElementSibling
        return firstSibling?.classList?.contains('mb-ext_close-tab-btn') && firstSibling.nextElementSibling === button
    }

    return false
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

    return null
}

function getProfileMenuButton() {
    const actionRow = getProfileActionRow()
    if(!actionRow) return null

    const primaryAction = getProfilePrimaryAction()
    const rowMenuButtons = getVisibleButtons(actionRow).filter(button => {
        return button.getAttribute('aria-haspopup') === 'menu' && isSameRow(primaryAction, button)
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
        const primaryAction = getProfilePrimaryAction()
        const actionButtons = getVisibleButtons(actionRow).filter(button => {
            return isSameRow(primaryAction, button) &&
                /^(follow|following|requested|notify me|ask)$/i.test(getElementText(button))
        })
        actionButtons.sort((left, right) => right.getBoundingClientRect().left - left.getBoundingClientRect().left)

        if(actionButtons.length) return {type: 'after-primary', element: actionButtons[0]}
    }

    const primaryAction = getProfilePrimaryAction()
    if(primaryAction) return {type: 'after-primary', element: primaryAction}

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
    if(candidate.classList?.contains('mb-ext_find-op-btn')) return true
    if(candidate.classList?.contains('mb-ext_open-profiles-btn')) return true

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
    if(!toggleMenu()) return null

    await sleep(400)

    const state = await waitForMenuState(primaryRegex, inverseRegex, timeoutMs, intervalMs)

    if(state?.state) {
        toggleMenu()
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
    if(!main) return false

    const labels = Array.from(main.querySelectorAll('div, span, button, a'))
    return labels.some(label => isVisible(label) && /^blocked$/i.test(getElementText(label)))
}

function injectCloseTabBtn() {
    let target = getProfileButtonInsertionTarget()
    if(!target) return console.debug('profile action container not found')

    let btn = document.querySelector('.mb-ext_close-tab-btn')
    if(btn && isProfileTargetPlacement(btn, target)) return
    btn?.remove()

    btn = document.createElement('button')
    btn.innerText = 'Close tab'
    btn.classList.add('mb-ext_close-tab-btn')

    btn.addEventListener('click', () => browser.runtime.sendMessage({action: 'close-tab'}))
    if(target.type === 'before-menu') {
        const muteBtn = document.querySelector('.mb-ext_mute-block-btn')
        if(muteBtn?.parentElement === target.element.parentElement) {
            muteBtn.insertAdjacentElement('beforebegin', btn)
        }
        else {
            target.element.insertAdjacentElement('beforebegin', btn)
        }
    }
    else {
        target.element.insertAdjacentElement('afterend', btn)
    }
}

function toggleMuteBlockBtn() {
    let existingBtn = document.querySelector('.mb-ext_mute-block-btn')

    if(isProfileBlocked()) {
        console.log('profile blocked')
        existingBtn?.remove()
    }
    else {
        console.log('profile not blocked')

        let target = getProfileButtonInsertionTarget()
        if(!target) return console.debug('profile action container not found')

        if(existingBtn && isProfileTargetPlacement(existingBtn, target)) return
        existingBtn?.remove()

        let btn = document.createElement('button')
        btn.innerText = 'Mute Block'
        btn.classList.add('mb-ext_mute-block-btn')

        btn.addEventListener('click', muteProfile)
        if(target.type === 'before-menu') {
            target.element.insertAdjacentElement('beforebegin', btn)
        }
        else {
            target.element.insertAdjacentElement('afterend', btn)
        }
    }
}

async function injectQuestionPageFOPBtn() {
    if(document.querySelector('.mb-ext_find-op-btn')) return true

    let container = getSortContainer()?.container
    if(!container) return false

    container = await maybeFlipQuestionFilterToAnswers(container)

    const actionTarget = getQuestionButtonInsertionTarget()
    if(!actionTarget || actionTarget.type !== 'between-filter-and-sort') return false

    function centeredQuestionPageBtnWrapper() {
        let div = document.createElement('div')
        div.dataset.mbQuestionBtnWrapper = 'true'
        div.classList.add('mb-ext_question-center-slot')
        div.appendChild(actionAnchor())

        return div
    }

    function actionAnchor() {
        let anchor = document.createElement('a')
        anchor.innerText = 'Original Poster on Log Page'
        anchor.classList.add('mb-ext_find-op-btn')
        anchor.target = '_blank'
        anchor.href = getQuestionLogHref()

        return anchor
    }

    insertQuestionPageBtn(centeredQuestionPageBtnWrapper(), actionTarget.element)
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

    if(!answerOption) {
        console.debug('Answers option not found')
        return container
    }

    answerOption.click()
    await sleep(settings.fopFlipDelay)

    return getSortContainer()?.container || container
}

function injectSpaceSidebarOpenProfilesBtn() {
    if(document.querySelector('.mb-ext_view-contributors-btn, .mb-ext_open-profiles-btn')) return

    const XPATH = "//div[contains(@class, 'q-click-wrapper') and contains(string(), 'View all')]"
    let query = document.evaluate(XPATH, document, null, XPathResult.ORDERED_NODE_SNAPSHOT_TYPE, null)

    let viewLink = query.snapshotItem(query.snapshotLength-1)

    if(viewLink) {
        let btn = document.createElement('button')
        btn.innerText = 'View Contributors'
        btn.classList.add('mb-ext_open-profiles-btn', 'mb-ext_view-contributors-btn')
        btn.addEventListener('click', () => viewLink.click())

        viewLink.insertAdjacentElement('afterend', btn)
    }
    else {
        console.log('space contributors modal will not open')

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
                browser.runtime.sendMessage({action: 'create-tab', url: link.href})

                item.style.backgroundColor = '#d4edda'
            }
        })

        qbox.insertAdjacentElement('afterend', btn)
    }
}

function injectModalOpenProfilesBtn() {
    let items = document.querySelectorAll('.modal_content_inner [role="listitem"]:not([data-mb-opened])')
    if(!items.length) return console.log('no profiles in modal')

    let btn = document.querySelector('.modal_content_inner .mb-ext_open-profiles-btn')
    if(btn) return console.log('button already injected')

    let modal = document.querySelector('.modal_content_inner')
    let dismissBtn = modal.querySelector('button[aria-label="Dismiss"]')

    btn = document.createElement('button')
    btn.innerHTML = `Open Profiles <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" stroke-width="2" stroke="currentColor" fill="none" stroke-linecap="round" stroke-linejoin="round">
        <path stroke="none" d="M0 0h24v24H0z" fill="none"/>
        <path d="M12 6h-6a2 2 0 0 0 -2 2v10a2 2 0 0 0 2 2h10a2 2 0 0 0 2 -2v-6" />
        <path d="M11 13l9 -9" />
        <path d="M15 4h5v5" />
    </svg>`

    btn.classList.add('mb-ext_open-profiles-btn')
    btn.addEventListener('click', () => openModalProfiles())

    dismissBtn.parentElement.insertAdjacentElement('beforeend', btn)
}

function openModalProfiles(afterTimeout = false) {
    console.log('afterTimeout', afterTimeout)

    const openProfiles = items => {
        for (const item of items) {
            item.dataset.mbOpened = true

            let followBtn = item.querySelector('[aria-label*="Follow"]')
            if(!followBtn) continue

            let link = item.querySelector('a[href*="/profile/"]')
            browser.runtime.sendMessage({action: 'create-tab', url: link.href})

            item.style.backgroundColor = '#d4edda'
            item.scrollIntoView({block: 'nearest'})
        }
    }

    const listItems = document.querySelectorAll('.modal_content_inner [role="listitem"]:not([data-mb-opened])')
    console.log('list items length', listItems.length)

    let openProfilesBtn = document.querySelector('.mb-ext_open-profiles-btn')

    if(afterTimeout) {
        openProfilesBtn.remove()
        openProfiles(listItems)
    }
    else {
        openProfilesBtn.disabled = false
        openProfilesBtn.innerHTML = `Open Profiles <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" stroke-width="2" stroke="currentColor" fill="none" stroke-linecap="round" stroke-linejoin="round">
            <path stroke="none" d="M0 0h24v24H0z" fill="none"/>
            <path d="M12 6h-6a2 2 0 0 0 -2 2v10a2 2 0 0 0 2 2h10a2 2 0 0 0 2 -2v-6" />
            <path d="M11 13l9 -9" />
            <path d="M15 4h5v5" />
        </svg>`

        if(listItems.length < settings.profilesPerBatch) {
            let openedItems = document.querySelectorAll('.modal_content_inner [role="listitem"][data-mb-opened]')

            if(openedItems.length) {
                profilesModalTimeout = setTimeout(openModalProfiles, 5000, true)

                openProfilesBtn.innerText = 'Please wait...'
                openProfilesBtn.disabled = true

                openedItems[openedItems.length - 1].scrollIntoView({block: 'nearest'})
                console.log('loading more...')
            }
            else {
                openProfilesBtn.remove()
                openProfiles(listItems)
            }
        }
        else {
            openProfiles(Array.from(listItems).slice(0, settings.profilesPerBatch))
        }
    }
}

async function muteProfile() {
    if(!toggleMenu()) return

    await sleep(500)

    const muteState = await waitForMenuState(/\bmute\b/i, /\bunmute\b/i, 5000, 250)
    if(muteState?.state === 'inverse') {
        toggleMenu()
        console.log('profile already muted')
    }
    else {
        let muteBtn = muteState?.button || getMenuAction(/\bmute\b/i)
        if(!muteBtn) return alert('Mute option not found')

        muteBtn.click()

        let confirmBtn = await waitForAction(() => getMuteConfirmAction(), 8000, 250)
        if(!confirmBtn) return alert('Confirm button not found')

        confirmBtn.click()

        let confirmClosed = await waitForCondition(() => !isMuteConfirmPending(), 2500, 250)
        if(!confirmClosed) {
            confirmBtn = getMuteConfirmAction()
            if(confirmBtn) confirmBtn.click()
            confirmClosed = await waitForCondition(() => !isMuteConfirmPending(), 6000, 250)
        }

        if(!confirmClosed) return alert('Mute confirm did not complete')

        const mutedApplied = await waitForProfileMenuState('inverse', /\bmute\b/i, /\bunmute\b/i, 8000, 500)
        if(!mutedApplied) return alert('Mute did not take effect')

        await sleep(300)
    }

    await blockProfile()
}

async function blockProfile() {
    if(isProfileBlocked()) {
        console.log('profile already blocked')
        return
    }

    if(!toggleMenu()) return

    await sleep(500)

    const blockState = await waitForMenuState(/\bblock\b/i, /\bunblock\b/i, 5000, 250)
    if(blockState?.state === 'inverse') return toggleMenu(), console.log('profile already blocked')

    let blockOpt = blockState?.button || getMenuAction(/\bblock\b/i)
    if(!blockOpt) {
        if(isProfileBlocked()) return console.log('profile already blocked')
        return alert('Block option not found')
    }

    blockOpt.click()

    let blockBtn = await waitForAction(() => getBlockConfirmAction(), 8000, 250)
    if(!blockBtn) return alert('Block button not found')

    blockBtn.click()

    let blockClosed = await waitForCondition(() => !isBlockConfirmPending(), 2500, 250)
    if(!blockClosed) {
        blockBtn = getBlockConfirmAction()
        if(blockBtn) blockBtn.click()
        blockClosed = await waitForCondition(() => !isBlockConfirmPending(), 6000, 250)
    }

    if(!blockClosed && !isProfileBlocked()) return alert('Block confirm did not complete')

    const blockedApplied = await waitForCondition(() => isProfileBlocked(), 8000, 250)
    if(!blockedApplied) {
        const blockedViaMenu = await waitForProfileMenuState('inverse', /\bblock\b/i, /\bunblock\b/i, 6000, 500)
        if(!blockedViaMenu) return alert('Block did not take effect')
    }
}

function toggleMenu() {
    let menu = getProfileMenuButton()
    if(!menu) {
        alert('Profile menu not found')
        return false
    }

    menu.click()
    return true
}

function sleep(ms) {
    return new Promise(r => setTimeout(r, ms))
}
