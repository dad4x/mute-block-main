// The stop reason a collect leaves on its button is one formatter, used by the space page and the contributors popup (4 Nov).
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const {formatCollectEndNotice} = require('../shared/js/candidateCollect')

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

test('the stop reason words and the time are the same for both pages', () => {
    assert.equal(formatCollectEndNotice({stopped: true}), 'Stopped')
    assert.equal(formatCollectEndNotice({collected: 0, noun: 'posts'}), 'No new posts')
    assert.equal(formatCollectEndNotice({collected: 0, noun: 'contributors'}), 'No new contributors')
    assert.equal(formatCollectEndNotice({collected: 12, endReached: true, elapsedMs: 65000, endLabel: 'end of list'}), 'Collected 12 · end of list · 1:05')
    assert.equal(formatCollectEndNotice({collected: 12, endReached: true, elapsedMs: 65000, endLabel: 'end of feed'}), 'Collected 12 · end of feed · 1:05')
    assert.equal(formatCollectEndNotice({collected: 5, stalled: true, elapsedMs: 3000}), 'Collected 5 · stalled · 0:03')
    assert.equal(formatCollectEndNotice({collected: 5, elapsedMs: 3000}), 'Collected 5 · 0:03')
})

test('both Collect buttons call the shared formatter and keep the notice through the shared check', () => {
    const content = readRepoFile('shared/js/content.js')
    assert.equal(content.split('formatCollectEndNotice({').length - 1, 3, 'space page, popup and search page each call the formatter once')
    assert.match(content, /endCollectDisplay\(\{collectButtons: spaceCollectButtons\(\), notice, idleLabel: currentSpaceFeedCollectLabel\(\)\}\)/)
    assert.match(content, /function setCollectResult\(button, reason, idleLabel\) \{/)
})

// Nuke 'Em is off while a collect runs on its list, and dimmed while it is off (4 Nov).
test('Nuke Em is gated during a collect on both pages, its click does nothing, and it is dimmed', () => {
    const content = readRepoFile('shared/js/content.js')
    const css = readRepoFile('shared/css/content.css')
    assert.match(content, /function applyCollectNukeGate\(button, collecting\) \{/)
    assert.match(content, /setSpaceFeedNukeCollectGate\(true\)/)
    assert.match(content, /setSpaceFeedNukeCollectGate\(false\)/)
    assert.match(content, /beginCollectDisplay\(\{collectButtons: \[button\], nukeButtons: \[modal\.querySelector\('\.mb-ext_nuke-profiles-btn'\)\]/)
    assert.match(content, /function beginCollectDisplay\(/)
    assert.match(content, /function applyCollectNukeGate\(button, collecting\) \{/)
    assert.match(content, /applyCollectNukeGate\(button, spaceFeedCollecting\)/)
    assert.match(content, /activeButton\.dataset\.mbNukeState === 'working' \|\| spaceFeedCollecting/)
    assert.match(css, /\.mb-ext_nuke-profiles-btn\[data-mb-collect-gated="true"\] \{[\s\S]*?opacity: 0\.45;/)
})

// The collect's stop reason persists, and the owned-nuke drain no longer writes debug counts onto a button (4 Nov).
test('collect notices persist, and the drain label carries no debug counts', () => {
    const content = readRepoFile('shared/js/content.js')
    assert.match(content, /function setCollectResult\(button, reason, idleLabel\) \{/)
    assert.match(content, /endCollectDisplay\(\{collectButtons: \[button\], notice, idleLabel: currentSpaceFeedCollectLabel\(\)\}\)/)
    assert.doesNotMatch(content, /\[t:\$\{status\.owned\}/)
    assert.match(content, /setNukeButtonIdle\(button, `Nuking \$\{active \+ queued\}\.\.\.`\)/)
})

// A contributors collect keeps the candidates it has seen, and Nuke Em queues them, not only the rows on screen (4 Nov).
test('the contributors collect keeps its candidates, and Nuke Em queues the kept ones', () => {
    const content = readRepoFile('shared/js/content.js')
    assert.match(content, /function retainModalCandidates\(modal = getProfilePeopleModal\(\)\) \{/)
    assert.match(content, /function getModalQueueableUrls\(modal = getProfilePeopleModal\(\), items = getNukeableProfileModalItems\(modal\)\) \{/)
    // The popup's collect reads its rows into the space's list, and counts only what it added (7 Nov).
    assert.match(content, /retainModalCandidates\(modal\)\s*\n\s*const found = /)
    assert.match(content, /addContributorsToSpaceList\(fresh\.slice\(0, room\)\)/)
    assert.match(content, /progress\.collected = countSpaceFeedCandidatesAddedSince\(startKeys\)/)
    // The popup's Nuke 'Em sends the space's batch, and shows the space's count.
    assert.match(content, /nukeSpaceFeedFromPopup\(event\.currentTarget\)/)
    assert.match(content, /const modalQueueable = getSpaceFeedQueueableProfileCount\(\)/)
})
