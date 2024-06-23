const browser = require('webextension-polyfill')

const PROFILE_BATCH_LIMIT = 10
let profilesModalTimeout

addEventListener('load', init)

function init() {
    browser.runtime.onMessage.addListener(onMessage)

    const page = getPageType()

    if(page === 'profile') {
        injectCloseTabBtn()
        toggleMuteBlockBtn()
    }
    else if(page === 'question-log') {
        injectQuestionLogPageFOPBtn()
    }
    else if(page === 'space') {
        injectSpaceSidebarOpenProfilesBtn()
    }
    // else if(pageType === 'question') {
    //     injectQuestionPageFOPBtn()
    // }

    startObserver()
}

function startObserver() {
    new MutationObserver(async mutations => {
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
            toggleMuteBlockBtn()
            break
        case 'question-page-loaded':
            injectQuestionPageFOPBtn()
            break

        case 'question-log-loaded': {
            let findOpBtn = document.querySelector('.mb-ext_find-op-log-btn')
            if(findOpBtn && findOpBtn.disabled) setTimeout(findOriginalPoster, 1e3)
            break
        }
        default:
            console.warn(`Unknown status: ${request.status}`)
    }
}

function getPageType() {
    const params = new URLSearchParams(location.search)

    if(/\/profile\/.+/i.test(location.pathname) && params.get('__nsrc__') !== 'notif_page') {
        return 'profile'
    }
    else if(/question\slog/i.test(document.title)) {
        return 'question-log'
    }
    else if(document.querySelector('.puppeteer_test_tribe_info_header')) {
        return 'space'
    }
    // content=article is not always for question type pages, so we need to check this as last condition
    else if(document.querySelector('meta[property="og:type"][content="article"]')) {
        return 'question'
    }

    return false
}

function injectCloseTabBtn() {
    let selector = '#mainContent > div:nth-last-child(2) > div:first-child > div:nth-child(2) > div:nth-child(3) > span'
    let target = document.querySelector(selector)

    let btn = document.createElement('button')
    btn.innerText = 'Close tab'
    btn.classList.add('mb-ext_close-tab-btn')

    btn.addEventListener('click', () => browser.runtime.sendMessage({action: 'close-tab'}))
    target.insertAdjacentElement('beforeend', btn)
}

function toggleMuteBlockBtn() {
    const XPATH = "//div[contains(@class, 'qu-bg--red') and contains(string(), 'Blocked')]"
    const main = document.querySelector('#mainContent')
    let query = document.evaluate(XPATH, main, null, XPathResult.ORDERED_NODE_SNAPSHOT_TYPE, null)

    let badge = query.snapshotItem(query.snapshotLength-1)

    if(badge) {
        console.log('profile blocked')
        document.querySelector('.mb-ext_mute-block-btn')?.remove()
    }
    else {
        console.log('profile not blocked')

        let selector = '#mainContent > div:nth-last-child(2) > div:first-child > div:nth-child(2) > div:nth-child(3) > span'
        let target = document.querySelector(selector)

        let btn = document.createElement('button')
        btn.innerText = 'Mute Block'
        btn.classList.add('mb-ext_mute-block-btn')

        btn.addEventListener('click', muteProfile)
        target.insertAdjacentElement('beforeend', btn)
    }
}

async function injectQuestionPageFOPBtn() {
    let {main, container} = getSortContainer()

    let anchor = document.createElement('a')
    anchor.innerText = 'Find Original Poster'
    anchor.classList.add('mb-ext_find-op-btn')

    anchor.target = '_blank'
    anchor.href = location.origin + location.pathname + '/log?extaction=findop'

    if(container) {
        let dropdownBtns = container.querySelectorAll('button[aria-haspopup="menu"]')
        let allRelatedBtn = Array.from(dropdownBtns).find(btn => /all related/igm.test(btn.innerText))

        if(allRelatedBtn) {
            allRelatedBtn.click()

            await sleep(200)

            let menuItems = document.querySelectorAll('.puppeteer_test_popover_item')
            let item = Array.from(menuItems).find(i => /answer/igm.test(i.innerText))

            if(item) {
                item.click()
                await sleep(2e3)

                container = getSortContainer().container
            }
            else {
                console.debug('Answer dropdown not found')
            }

            let child = container.firstElementChild
            child.insertAdjacentElement('afterend', anchor)
        }
        else {
            console.debug('All Related dropdown not found')

            let child = container.firstElementChild
            child.insertAdjacentElement('afterend', anchor)
        }
    }
    else if(main) {
        container = main.querySelector('#mainContent > *:first-child')
        if(!container) return console.log('first child not found')

        let div = document.createElement('div')
        div.classList.add('qu-display--flex', 'qu-justifyContent--center', 'qu-mt--small', 'qu-mb--small')

        div.appendChild(anchor)

        container.insertAdjacentElement('afterend', div)
    }
}

function getSortContainer() {
    let selector = '.puppeteer_test_question_main'
    let questionMain = document.querySelector(selector)
    if (!questionMain) return null

    const XPATH = "//div[contains(@class, 'qu-justifyContent--space-between') and contains(string(), 'Sort')]"
    let query = document.evaluate(XPATH, questionMain, null, XPathResult.ORDERED_NODE_SNAPSHOT_TYPE, null)

    return {main: questionMain, container: query.snapshotItem(query.snapshotLength-1)}
}

function injectQuestionLogPageFOPBtn() {
    let qbox = document.querySelector('#mainContent + .q-box')
    let target = qbox.querySelector('.qu-borderAll')

    let btn = document.createElement('button')
    btn.innerText = 'Find Original Poster'
    btn.classList.add('mb-ext_find-op-log-btn')

    btn.addEventListener('click', () => {
        btn.innerText = 'Please wait...'
        btn.disabled = true

        findOriginalPoster()
    })

    target.insertAdjacentElement('afterend', btn)

    if(location.search.match(/extaction=findop/i)) btn.click()
}

async function findOriginalPoster() {
    const XPATH = "//*[contains(string(), 'Question added by')]"

    let query = document.evaluate(XPATH, document, null, XPathResult.ORDERED_NODE_SNAPSHOT_TYPE, null)
    let target = query.snapshotItem(query.snapshotLength-1)

    if(target) {
        let logBtn = document.querySelector('.mb-ext_find-op-log-btn')
        logBtn.innerText = 'Find Original Poster'
        logBtn.disabled = false

        target.scrollIntoView({block: 'nearest'})

        target.style.outline = '3px solid #eab308'
        target.style.outlineOffset = '15px'

        await sleep(3e3)

        target.style.removeProperty('outline')
        target.style.removeProperty('outlineOffset')
    }
    else {
        scrollBy(0, document.body.scrollHeight)
    }
}

function injectSpaceSidebarOpenProfilesBtn() {
    const XPATH = "//div[contains(@class, 'q-click-wrapper') and contains(string(), 'View all')]"
    let query = document.evaluate(XPATH, document, null, XPathResult.ORDERED_NODE_SNAPSHOT_TYPE, null)

    let viewLink = query.snapshotItem(query.snapshotLength-1)

    if(!viewLink) {
        console.log('space contributors modal will not open')

        const XPATH = "//div[contains(@class, 'q-box') and contains(string(), 'Contributor')]"
        let query = document.evaluate(XPATH, document, null, XPathResult.ORDERED_NODE_SNAPSHOT_TYPE, null)

        let qbox = query.snapshotItem(query.snapshotLength-1)

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

        if(listItems.length < PROFILE_BATCH_LIMIT) {
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
            openProfiles(Array.from(listItems).slice(0, PROFILE_BATCH_LIMIT))
        }
    }
}

async function muteProfile() {
    setTimeout(blockProfile, 1500)

    toggleMenu()

    await sleep(500)

    let items = document.querySelectorAll('.puppeteer_test_popover_item')
    let unmuteBtn = Array.from(items).find(i => /unmute/i.test(i.innerText))
    if(unmuteBtn) return toggleMenu(), console.log('profile already muted')

    let muteBtn = Array.from(items).find(i => /mute/i.test(i.innerText))
    if(!muteBtn) return alert('Mute option not found')

    muteBtn.click()

    await sleep(500)

    let btns = document.querySelectorAll('button.qu-bg--blue')
    let confirmBtn = Array.from(btns).find(b => /confirm/i.test(b.innerText))
    if(!confirmBtn) return alert('Confirm button not found')

    confirmBtn.click()
}

async function blockProfile() {
    toggleMenu()

    await sleep(500)

    let items = document.querySelectorAll('.puppeteer_test_popover_item')

    let unblockOpt = Array.from(items).find(i => /unblock/i.test(i.innerText))
    if(unblockOpt) return toggleMenu(), console.log('profile already blocked')

    let blockOpt = Array.from(items).find(i => /block/i.test(i.innerText))
    if(!blockOpt) return alert('Block option not found')

    blockOpt.click()

    await sleep(500)

    let btns = document.querySelectorAll('button.qu-bg--blue')
    let blockBtn = Array.from(btns).find(b => /block/i.test(b.innerText))
    if(!blockBtn) return alert('Block button not found')

    blockBtn.click()
}

function toggleMenu() {
    let menus = document.querySelectorAll('#mainContent .puppeteer_test_overflow_menu')
    let menu = Array.from(menus).find(m => m.style.boxShadow.length)
    menu.click()
}

function sleep(ms) {
    return new Promise(r => setTimeout(r, ms))
}