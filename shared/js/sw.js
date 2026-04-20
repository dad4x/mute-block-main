const browser = require('webextension-polyfill')
const defaults = require('./defaults')
const pendingTabActions = new Map()
const queuedTabActions = []
const activeQueuedTabs = new Set()
const ownedTabIdsByParent = new Map()
const owningParentByChild = new Map()
const canceledQueuedUrlsByOwner = new Map()
const pausedQueuedOwners = new Set()
const OWNED_TAB_STATE_KEY = 'mbOwnedTabIdsByParent'
let persistOwnedTabIdsTimeout = null
let queuedTabConcurrency = 1

function serializeOwnedTabIdsByParent() {
    const serialized = {}

    for(const [parentTabId, childTabIds] of ownedTabIdsByParent.entries()) {
        if(!childTabIds.size) continue
        serialized[parentTabId] = Array.from(childTabIds)
    }

    return serialized
}

function rebuildOwningParentByChild() {
    owningParentByChild.clear()

    for(const [parentTabId, childTabIds] of ownedTabIdsByParent.entries()) {
        for(const childTabId of childTabIds) {
            owningParentByChild.set(childTabId, Number(parentTabId))
        }
    }
}

async function persistOwnedTabIdsByParent() {
    try {
        await browser.storage.local.set({[OWNED_TAB_STATE_KEY]: serializeOwnedTabIdsByParent()})
    }
    catch {}
}

function schedulePersistOwnedTabIdsByParent(delayMs = 250) {
    clearTimeout(persistOwnedTabIdsTimeout)
    persistOwnedTabIdsTimeout = setTimeout(() => {
        persistOwnedTabIdsTimeout = null
        void persistOwnedTabIdsByParent()
    }, delayMs)
}

async function loadOwnedTabIdsByParent() {
    try {
        const stored = await browser.storage.local.get({[OWNED_TAB_STATE_KEY]: {}})
        const serialized = stored?.[OWNED_TAB_STATE_KEY] || {}

        ownedTabIdsByParent.clear()

        for(const [parentTabId, childTabIds] of Object.entries(serialized)) {
            const numericParentTabId = Number.parseInt(parentTabId, 10)
            if(!numericParentTabId || !Array.isArray(childTabIds) || !childTabIds.length) continue

            ownedTabIdsByParent.set(numericParentTabId, new Set(childTabIds.map(tabId => Number.parseInt(tabId, 10)).filter(Boolean)))
        }

        rebuildOwningParentByChild()
    }
    catch {}
}

const ownedTabIdsReady = loadOwnedTabIdsByParent()

function sendTabMessage(tabId, message) {
    return browser.tabs.sendMessage(tabId, message).catch(error => {
        if(/Receiving end does not exist/i.test(error?.message || '')) return
    })
}

function registerOwnedTab(parentTabId, childTabId) {
    if(!parentTabId || !childTabId) return

    let ownedTabIds = ownedTabIdsByParent.get(parentTabId)
    if(!ownedTabIds) {
        ownedTabIds = new Set()
        ownedTabIdsByParent.set(parentTabId, ownedTabIds)
    }

    ownedTabIds.add(childTabId)
    owningParentByChild.set(childTabId, parentTabId)
    schedulePersistOwnedTabIdsByParent()
}

function unregisterOwnedTab(childTabId) {
    if(!childTabId) return

    const parentTabId = owningParentByChild.get(childTabId)
    if(!parentTabId) return

    owningParentByChild.delete(childTabId)

    const ownedTabIds = ownedTabIdsByParent.get(parentTabId)
    if(!ownedTabIds) return

    ownedTabIds.delete(childTabId)
    if(!ownedTabIds.size) {
        ownedTabIdsByParent.delete(parentTabId)
    }

    schedulePersistOwnedTabIdsByParent()
}

async function getLiveOwnedTabIds(parentTabId) {
    await ownedTabIdsReady

    const ownedTabIds = Array.from(ownedTabIdsByParent.get(parentTabId) || [])
    if(!ownedTabIds.length) return []

    const liveTabIds = []

    for(const tabId of ownedTabIds) {
        try {
            await browser.tabs.get(tabId)
            liveTabIds.push(tabId)
        }
        catch {
            unregisterOwnedTab(tabId)
        }
    }

    return liveTabIds
}

async function sweepOwnedBlockedProfileTabs(parentTabId) {
    const ownedTabIds = await getLiveOwnedTabIds(parentTabId)
    if(!ownedTabIds.length) return {owned: 0, signaled: 0}

    let signaled = 0

    for(const tabId of ownedTabIds) {
        try {
            const response = await sendTabMessage(tabId, {action: 'close-if-blocked'})
            if(response?.willClose) signaled += 1
        }
        catch {}
    }

    return {owned: ownedTabIds.length, signaled}
}

function getOwnedNukeStatus(parentTabId) {
    const owned = ownedTabIdsByParent.get(parentTabId)?.size || 0
    const active = Array.from(activeQueuedTabs).filter(tabId => owningParentByChild.get(tabId) === parentTabId).length
    const queued = queuedTabActions.filter(action => action.ownerTabId === parentTabId && action.tabAction === 'nuke').length
    const paused = pausedQueuedOwners.has(parentTabId)
    return {active, owned, queued, paused}
}

function rememberCanceledOwnerUrls(ownerTabId, urls) {
    if(!ownerTabId || !Array.isArray(urls) || !urls.length) return

    const existing = canceledQueuedUrlsByOwner.get(ownerTabId) || []
    canceledQueuedUrlsByOwner.set(ownerTabId, existing.concat(urls.filter(Boolean)))
}

function cancelQueuedOwnerActions(ownerTabId, tabAction = null) {
    if(!ownerTabId) return []

    const canceledUrls = []

    for(let index = queuedTabActions.length - 1; index >= 0; index -= 1) {
        const action = queuedTabActions[index]
        if(action.ownerTabId !== ownerTabId) continue
        if(tabAction && action.tabAction !== tabAction) continue

        if(action.url) {
            canceledUrls.push(action.url)
        }
        queuedTabActions.splice(index, 1)
    }

    return canceledUrls
}

function consumeCanceledOwnerUrls(ownerTabId) {
    if(!ownerTabId) return []

    const urls = canceledQueuedUrlsByOwner.get(ownerTabId) || []
    canceledQueuedUrlsByOwner.delete(ownerTabId)
    return urls
}

function releaseQueuedTab(tabId) {
    pendingTabActions.delete(tabId)

    if(activeQueuedTabs.delete(tabId)) {
        void fillQueuedTabs()
    }
}

async function fillQueuedTabs() {
    await ownedTabIdsReady

    while(activeQueuedTabs.size < queuedTabConcurrency && queuedTabActions.length) {
        const next = queuedTabActions.shift()
        if(pausedQueuedOwners.has(next.ownerTabId)) {
            rememberCanceledOwnerUrls(next.ownerTabId, next.url ? [next.url] : [])
            continue
        }

        try {
            void sweepOwnedBlockedProfileTabs(next.ownerTabId)
            const tab = await browser.tabs.create({url: next.url, active: false})
            activeQueuedTabs.add(tab.id)
            pendingTabActions.set(tab.id, next.tabAction)
            registerOwnedTab(next.ownerTabId, tab.id)
            void sweepOwnedBlockedProfileTabs(next.ownerTabId)
        }
        catch {}
    }
}

browser.runtime.onInstalled.addListener(details => {
    if(details.reason === 'install') {
        browser.storage.local.set(defaults)
    }
})

browser.tabs.onRemoved.addListener(tabId => {
    void ownedTabIdsReady.then(() => {
        pausedQueuedOwners.delete(tabId)
        releaseQueuedTab(tabId)
        unregisterOwnedTab(tabId)
    })
})

browser.tabs.onUpdated.addListener((tabId, changeInfo) => {
    if(changeInfo.status !== 'loading') return

    pausedQueuedOwners.add(tabId)
    const canceledUrls = cancelQueuedOwnerActions(tabId, 'nuke')
    rememberCanceledOwnerUrls(tabId, canceledUrls)
})

browser.runtime.onMessage.addListener((request, sender, sendResponse) => {
    if(request.action === 'create-tab') {
        return browser.tabs.create({url: request.url, active: false}).then(tab => {
            if(request.tabAction) pendingTabActions.set(tab.id, request.tabAction)
            return {tabId: tab.id}
        })
    }
    else if(request.action === 'enqueue-tabs') {
        const urls = Array.isArray(request.urls) ? request.urls.filter(Boolean) : []
        if(!urls.length) return Promise.resolve({queued: 0})
        const ownerTabId = sender.tab?.id || null

        return ownedTabIdsReady.then(() => {
            pausedQueuedOwners.delete(ownerTabId)
            queuedTabConcurrency = Math.max(1, Number.parseInt(request.maxConcurrent, 10) || 1)

            for(const url of urls) {
                queuedTabActions.push({url, tabAction: request.tabAction || null, ownerTabId})
            }

            void sweepOwnedBlockedProfileTabs(ownerTabId)
            return fillQueuedTabs().then(() => ({queued: urls.length}))
        })
    }
    else if(request.action === 'claim-tab-action') {
        const tabId = sender.tab?.id
        if(!tabId) return Promise.resolve(null)

        const action = pendingTabActions.get(tabId) || null
        pendingTabActions.delete(tabId)
        return Promise.resolve(action)
    }
    else if(request.action === 'release-tab-slot') {
        const tabId = sender.tab?.id
        if(!tabId) return Promise.resolve({released: false})

        releaseQueuedTab(tabId)
        return Promise.resolve({released: true})
    }
    else if(request.action === 'cancel-queued-owner-nukes') {
        const ownerTabId = sender.tab?.id || null
        const canceledUrls = consumeCanceledOwnerUrls(ownerTabId)
            .concat(cancelQueuedOwnerActions(ownerTabId, 'nuke'))
        return Promise.resolve({
            canceledUrls
        })
    }
    else if(request.action === 'pause-owner-nukes') {
        const ownerTabId = sender.tab?.id || null
        pausedQueuedOwners.add(ownerTabId)
        const canceledUrls = cancelQueuedOwnerActions(ownerTabId, 'nuke')
        return Promise.resolve({
            canceledUrls
        })
    }
    else if(request.action === 'close-tab') {
        const tabId = sender.tab?.id
        releaseQueuedTab(tabId)

        if(tabId) {
            setTimeout(() => {
                void browser.tabs.remove(tabId).catch(() => {})
            }, 0)
            return Promise.resolve({closed: true})
        }

        return Promise.resolve({closed: false})
    }
    else if(request.action === 'get-owned-nuke-status') {
        return ownedTabIdsReady.then(async () => {
            await getLiveOwnedTabIds(sender.tab?.id || null)
            return getOwnedNukeStatus(sender.tab?.id || null)
        })
    }
    else if(request.action === 'sweep-owned-blocked-profile-tabs') {
        return sweepOwnedBlockedProfileTabs(sender.tab?.id || null)
    }
})

browser.webRequest.onCompleted.addListener(details => {
    if(details.url.match(/TribePeopleModalQuery/i)) {
        sendTabMessage(details.tabId, {status: 'space-people-modal-loaded'})
    }
    else if(details.url.match(/TribeContributorOrHigherListQuery/i)) {
        sendTabMessage(details.tabId, {status: 'space-contributors-loaded'})
    }
    else if(details.url.match(/UserProfileFollowersModalQuery/i)) {
        sendTabMessage(details.tabId, {status: 'profile-followers-modal-loaded'})
    }
    else if(details.url.match(/UserProfileFollowers_ProfileTopics_Query/i)) {
        sendTabMessage(details.tabId, {status: 'profile-followers-loaded'})
    }
    else if(details.url.match(/UserProfileFollowingPeople_ProfileTopics_Query/i)) {
        sendTabMessage(details.tabId, {status: 'profile-following-loaded'})
    }
    else if(details.url.match(/userBlockModalInnerUtils_userSetBlock_Mutation/i)) {
        sendTabMessage(details.tabId, {status: 'profile-block-updated'})
    }
    else if(details.url.match(/ContentLogMainQuery/i)) {
        sendTabMessage(details.tabId, {status: 'question-log-loaded'})
    }
    else if(details.url.match(/QuestionCollapsedAnswerLoaderQuery/i)) {
        sendTabMessage(details.tabId, {status: 'question-page-loaded'})
    }
},
{
    urls: [
        'https://*.quora.com/graphql/gql_para_POST?q=TribePeopleModalQuery',
        'https://*.quora.com/graphql/gql_para_POST?q=TribeContributorOrHigherListQuery',

        'https://www.quora.com/graphql/gql_para_POST?q=UserProfileFollowersModalQuery',
        'https://www.quora.com/graphql/gql_para_POST?q=UserProfileFollowers_ProfileTopics_Query',
        'https://www.quora.com/graphql/gql_POST?q=userBlockModalInnerUtils_userSetBlock_Mutation',
        'https://www.quora.com/graphql/gql_para_POST?q=UserProfileFollowingPeople_ProfileTopics_Query',

        'https://www.quora.com/graphql/gql_para_POST?q=ContentLogMainQuery',
        'https://www.quora.com/graphql/gql_para_POST?q=QuestionCollapsedAnswerLoaderQuery'
    ]
})
