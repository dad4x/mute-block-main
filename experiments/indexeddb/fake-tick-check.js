'use strict'

// Q3: can an IndexedDB operation complete under the test suite's clock model?
// The suite's flushAsync (test/swSynthetic.test.js) drains microtasks only, and
// its fake setTimeout never fires on its own. This checks how an in-memory IDB
// (fake-indexeddb) behaves under those constraints.
//
//   node experiments/indexeddb/fake-tick-check.js

const path = require('node:path')
require(path.join(__dirname, 'node', 'node_modules', 'fake-indexeddb', 'auto'))

function openDb(name) {
    return new Promise((resolve, reject) => {
        const request = indexedDB.open(name, 1)
        request.onupgradeneeded = () => request.result.createObjectStore('rows', {keyPath: 'key'})
        request.onsuccess = () => resolve(request.result)
        request.onerror = () => reject(request.error)
    })
}

function putOne(db, key) {
    return new Promise((resolve, reject) => {
        const tx = db.transaction('rows', 'readwrite')
        tx.objectStore('rows').put({key, value: 'x'})
        tx.oncomplete = () => resolve(true)
        tx.onerror = () => reject(tx.error)
        tx.onabort = () => reject(tx.error || new Error('aborted'))
    })
}

async function flushMicrotasks(rounds) {
    for(let index = 0; index < rounds; index += 1) {
        await Promise.resolve()
    }
}

async function countMacrotasksUntil(promise) {
    let done = false
    promise.then(() => { done = true })
    let turns = 0
    while(!done && turns < 10000) {
        await new Promise(resolve => setImmediate(resolve))
        turns += 1
    }
    return {completed: done, macrotaskTurns: turns}
}

async function main() {
    const results = {}

    const db = await openDb('tick-check-a')
    const microtaskOnly = putOne(db, 'a')
    let settledUnderMicrotasks = false
    microtaskOnly.then(() => { settledUnderMicrotasks = true }, () => { settledUnderMicrotasks = true })
    await flushMicrotasks(10000)
    results.microtaskFlush10000 = {settled: settledUnderMicrotasks}
    await countMacrotasksUntil(microtaskOnly)

    const turnsForOnePut = await countMacrotasksUntil(putOne(db, 'b'))
    results.onePutMacrotaskTurns = turnsForOnePut

    const twoStore = new Promise((resolve, reject) => {
        const tx = db.transaction('rows', 'readwrite')
        tx.objectStore('rows').put({key: 'c', value: 1})
        tx.objectStore('rows').put({key: 'd', value: 2})
        tx.oncomplete = () => resolve(true)
        tx.onerror = () => reject(tx.error)
    })
    results.twoPutTransactionMacrotaskTurns = await countMacrotasksUntil(twoStore)

    const originalSetTimeout = globalThis.setTimeout
    globalThis.setTimeout = () => 0
    try {
        const withFakeTimeout = await countMacrotasksUntil(putOne(db, 'e'))
        results.onePutWithSetTimeoutDisabled = withFakeTimeout
    }
    finally {
        globalThis.setTimeout = originalSetTimeout
    }

    db.close()
    console.log(JSON.stringify(results, null, 2))
}

main().catch((error) => {
    console.error(error)
    process.exit(1)
})
