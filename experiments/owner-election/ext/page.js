// Each page tries for an exclusive Web Lock. A page with role 'holder' takes it
// immediately (ifAvailable) and keeps it. A page with role 'waiter' queues for it.
// The driver reads the outcome through window.spike.state().
const params = new URLSearchParams(location.search)
const role = params.get('role') || 'waiter'
const state = {role, acquired: false, acquiredAt: null, requestedAt: Date.now(), ifAvailableResult: null}

const options = role === 'holder' ? {mode: 'exclusive', ifAvailable: true} : {mode: 'exclusive'}
navigator.locks.request('mb-owner', options, (lock) => {
    if(lock === null) {
        state.ifAvailableResult = 'not-available'
        return
    }
    state.acquired = true
    state.acquiredAt = Date.now()
    state.ifAvailableResult = role === 'holder' ? 'granted' : null
    return new Promise(() => {})
})

window.spike = {
    state: () => ({...state, now: Date.now()})
}
