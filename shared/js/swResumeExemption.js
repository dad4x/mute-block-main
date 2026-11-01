// The progress resume exemption (review F2; coder decision 30, 18 Oct). A storage update that writes only progress keys does not start
// queued work. The decision is made from the keys a write carries, never from its metric label: a label that happens to match, or
// not match, a name changes nothing. A storage update that writes anything other than progress is not exempt, even if it also writes
// progress. A non-progress write clears only a suppression that a progress-only write set, never one the caller set.
//
// The key names are passed in (the view key and the shard prefix live in the worker and in storageKeys.js), so this module keeps no
// copy of them.

// Whether one key is a progress key: the progress view, or one of the progress shards.
function isProgressStorageKey(key, keyNames = {}) {
    return key === keyNames.viewKey || `${key || ''}`.startsWith(keyNames.shardPrefix || '\u0000')
}

// What one storage write carries, by its keys alone.
//   wroteProgress: at least one key is a progress key.
//   progressOnly:  every key is a progress key (and there is at least one key).
//   nonProgress:   at least one key is not a progress key.
function classifyStorageWriteForResume(keys = [], keyNames = {}) {
    const list = Array.from(keys || [])
    const progressCount = list.filter(key => isProgressStorageKey(key, keyNames)).length
    return {
        wroteProgress: progressCount > 0,
        progressOnly: list.length > 0 && progressCount === list.length,
        nonProgress: progressCount < list.length
    }
}

// Applies one write's classification to the storage update's context. A progress-only write counts as exempt, and suppresses the
// durable resume for the update unless a non-progress write has already happened in it. A non-progress write marks the update as
// having non-progress work. It clears only a suppression this module set for a progress-only write: a suppression the caller set when
// the update started (the recovered-queue path passes one) is kept. A write with no keys changes nothing.
function applyResumeExemptionToUpdate(context = null, write = {}) {
    if(!context || typeof context !== 'object') return
    if(write.progressOnly) {
        context.profileProgressProjectionOnlyWrites = (Number.parseInt(context.profileProgressProjectionOnlyWrites, 10) || 0) + 1
        // An update that is already suppressed (by its caller) is not claimed here, so a later non-progress write cannot clear it.
        if(context.nonProgressProjectionWrite !== true && context.suppressDurableIdleResume !== true) {
            context.suppressDurableIdleResume = true
            context.progressResumeExempt = true
        }
        return
    }
    if(write.nonProgress) {
        context.nonProgressProjectionWrite = true
        if(context.progressResumeExempt === true) {
            context.suppressDurableIdleResume = false
            context.progressResumeExempt = false
        }
    }
}

module.exports = {
    isProgressStorageKey,
    classifyStorageWriteForResume,
    applyResumeExemptionToUpdate
}
