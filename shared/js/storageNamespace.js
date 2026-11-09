// Layout namespace for chrome.storage (step 2 of the storage-key plan). Every key is stored as STORAGE_LAYOUT_PREFIX plus its name
// (storageKeys.js), so 'mbCoordinatorRuns' is stored as 'v1.6.mbCoordinatorRuns'. The worker and its pages use these wrappers and
// never the raw areas, so the names they pass are the plain names and the stored names carry the prefix.
//
// Builds of this layout share the prefix, so they read each other's keys. A build with the unprefixed layout never sees these keys,
// and these builds never see its keys: each leaves the other's data alone. Nothing here migrates the unprefixed keys. The erase clears
// them, and a fresh start under this layout begins with an empty store.
//
// clear and getBytesInUse touch only prefixed keys, so an area shared with another layout is never cleared past this layout's keys.

const {STORAGE_LAYOUT_PREFIX} = require('./storageKeys')

function prefixedName(key) {
    return `${STORAGE_LAYOUT_PREFIX}${key}`
}

// The plain name of a stored name, or null when the stored name is not in this layout.
function plainName(storedName) {
    if(typeof storedName !== 'string' || !storedName.startsWith(STORAGE_LAYOUT_PREFIX)) return null
    return storedName.slice(STORAGE_LAYOUT_PREFIX.length)
}

// A get or remove argument as stored names. null and undefined mean every key, as chrome.storage reads them.
function prefixedKeys(keys) {
    if(keys === null || keys === undefined) return null
    if(typeof keys === 'string') return prefixedName(keys)
    if(Array.isArray(keys)) return keys.map(prefixedName)
    if(typeof keys === 'object') return Object.fromEntries(Object.entries(keys).map(([key, value]) => [prefixedName(key), value]))
    return keys
}

// The stored result of a read, with its plain names. Stored keys from another layout are left out.
function plainEntries(stored) {
    const entries = {}
    for(const [storedName, value] of Object.entries(stored || {})) {
        const key = plainName(storedName)
        if(key !== null) entries[key] = value
    }
    return entries
}

// The stored names of this layout that an area holds.
async function ownStoredNames(area) {
    return Object.keys((await area.get(null)) || {}).filter(name => plainName(name) !== null)
}

// A namespaced view of a chrome.storage area (local or session). A missing area gives null, so callers can keep their optional chains.
function namespaceArea(area) {
    if(!area) return null
    // No prefix means plain names: the area is used as it is, so a call takes no extra promise hop (the fake-timer tests depend on it).
    if(!STORAGE_LAYOUT_PREFIX) return area
    return {
        get: async keys => plainEntries(await area.get(prefixedKeys(keys))),
        set: items => area.set(prefixedKeys(items)),
        remove: keys => area.remove(prefixedKeys(keys)),
        clear: async () => {
            const names = await ownStoredNames(area)
            if(names.length) await area.remove(names)
        },
        getBytesInUse: async keys => {
            if(typeof area.getBytesInUse !== 'function') return 0
            if(keys !== null && keys !== undefined) return area.getBytesInUse(prefixedKeys(keys))
            return area.getBytesInUse(await ownStoredNames(area))
        }
    }
}

// An onChanged payload with plain names, for this layout's keys only. Null when none of the changed keys is in this layout.
function namespaceChanges(changes) {
    if(!STORAGE_LAYOUT_PREFIX) return changes && Object.keys(changes).length ? changes : null
    const entries = {}
    for(const [storedName, change] of Object.entries(changes || {})) {
        const key = plainName(storedName)
        if(key !== null) entries[key] = change
    }
    return Object.keys(entries).length ? entries : null
}

// The one read of plain (unprefixed) names, for the one-time import of the 1.5 space registry (27 Oct, sw.js
// importSpaceRegistryFromVersion15). Version 1.5 stored that key under its plain name, which this layout never reads through
// namespaceArea. The names are read as they are, from the browser's local area, and nothing is written here.
async function readPlainLocalNames(browserApi, names) {
    const area = browserApi?.storage?.local || null
    if(!area) return {}
    return (await area.get(names)) || {}
}

// The one removal of plain (unprefixed) names, for the erase (owner, 27 Oct; sw.js eraseBlockHistoryRequested and runPendingBlockHistoryErase).
// The 1.5 space registry is under its plain name, so the erase removes it here as well as through namespaceArea. Nothing else is removed here.
// It rejects when the browser rejects, so the caller can count the failure and carry on with the erase. With no local area it rejects too,
// since a removal that did not happen must not look like one that did.
async function removePlainLocalNames(browserApi, names) {
    const area = browserApi?.storage?.local || null
    if(!area) throw new Error('removePlainLocalNames: no local storage area')
    if(!Array.isArray(names) || !names.length) return
    await area.remove(names)
}

module.exports = {
    namespaceArea,
    namespaceChanges,
    prefixedName,
    plainName,
    readPlainLocalNames,
    removePlainLocalNames
}
