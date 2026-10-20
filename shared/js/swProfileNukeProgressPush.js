// The worker's push that tells content tabs their profile progress changed (decision 31, and the content trigger choice D13 (b) in the
// progress durability note: the storage listener's progress arm is replaced by this push). A push carries no data. The tab asks again
// for its own scoped state, as it does on every page request. Only tabs that have asked for page state are pushed to, identified by
// the sender's tab id, the same rule the queue bar uses (decision 15). A tab whose push fails is dropped from the set.
//
// Tools read the whole progress through the worker with PROFILE_NUKE_PROGRESS_GET_ACTION (decision 32). The answer is the worker's
// stored copy, the same one the content page reads through its scoped request.

const PROFILE_NUKE_PROGRESS_PUSH_ACTION = 'profile-nuke-progress-changed'
const PROFILE_NUKE_PROGRESS_GET_ACTION = 'get-profile-nuke-progress'
// The worker's clear of the whole progress. Only an extension page may send it, and the worker refuses a message from a tab (20 Oct review).
const PROFILE_NUKE_PROGRESS_CLEAR_ACTION = 'clear-profile-nuke-progress'

// deps.getTabs returns the tabs API (browser.tabs) when it is called, so the module does not touch the browser at load time.
// Each subscription has a generation. A push remembers the generation of each tab it sends to, and a failed send drops the tab only
// if that generation is still current. So a failure that arrives after the tab asked again keeps the new subscription (20 Oct review).
function createProfileNukeProgressPush(deps = {}) {
    const generations = new Map()
    let nextGeneration = 1

    function subscribe(tabId) {
        const id = Number.parseInt(tabId, 10)
        if(Number.isFinite(id) && id >= 0) generations.set(id, nextGeneration++)
    }

    // Sends the push to every subscribed tab. Returns how many tabs it was sent to; a failed send removes its tab later.
    function push() {
        const targets = Array.from(generations.entries())
        for(const [tabId, generation] of targets) {
            Promise.resolve()
                .then(() => deps.getTabs().sendMessage(tabId, {action: PROFILE_NUKE_PROGRESS_PUSH_ACTION}))
                .catch(() => {
                    if(generations.get(tabId) === generation) generations.delete(tabId)
                })
        }
        return targets.length
    }

    return {
        subscribe,
        push,
        size: () => generations.size
    }
}

module.exports = {
    PROFILE_NUKE_PROGRESS_PUSH_ACTION,
    PROFILE_NUKE_PROGRESS_CLEAR_ACTION,
    PROFILE_NUKE_PROGRESS_GET_ACTION,
    createProfileNukeProgressPush
}
