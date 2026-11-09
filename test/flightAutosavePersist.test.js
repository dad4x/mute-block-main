// The flight recorder's Save-every setting is stored by the worker, the same way as dev mode, so it survives a dashboard reload (4 Nov).
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const {FLIGHT_RECORDER_AUTOSAVE_KEY} = require('../shared/js/storageKeys')

function readRepoFile(relativePath) {
    return fs.readFileSync(path.join(__dirname, '..', relativePath), 'utf8')
}

function test(name, fn) {
    try {
        fn()
        console.log(`ok - ${name}`)
    }
    catch (error) {
        console.error(`not ok - ${name}`)
        console.error(error)
        process.exitCode = 1
    }
}

test('the Save-every key is stored under its own name, and the worker writes only 0 or 50', () => {
    assert.equal(FLIGHT_RECORDER_AUTOSAVE_KEY, 'mbDashboardFlightRecorderAutosaveEvery')
    const sw = readRepoFile('shared/js/sw.js')
    assert.match(sw, /async function setFlightRecorderAutosaveRequested\(every = 0\) \{[\s\S]*?Number\.parseInt\(every, 10\) === 50 \? 50 : 0/)
    assert.match(sw, /COORDINATOR_DASHBOARD_STATE_KEYS = makeCoordinatorDashboardStateKeys\(\[[\s\S]*?FLIGHT_RECORDER_AUTOSAVE_KEY/)
})

test('the worker route and the dashboard load, change and push all use the key', () => {
    const bootstrap = readRepoFile('shared/js/swBootstrap.js')
    assert.match(bootstrap, /request\.action === 'set-flight-recorder-autosave'/)
    const coordinator = readRepoFile('shared/js/coordinator.js')
    assert.match(coordinator, /loadFlightRecorderAutosaveStored\(\)/)
    assert.match(coordinator, /action: 'set-flight-recorder-autosave'/)
    assert.match(coordinator, /hasOwnProperty\.call\(incomingState, FLIGHT_RECORDER_AUTOSAVE_KEY\)/)
})
