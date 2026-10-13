#!/usr/bin/env node

const {
    evaluate,
    getCdpConfig,
    getOption,
    getTargets,
    runMain,
    sleep
} = require('./lib/cdp')

function isProfileSearchTarget(target, needle) {
    if(target.type !== 'page') return false
    const url = target.url || ''
    if(!/^https:\/\/www\.quora\.com\/search\?/i.test(url)) return false
    try {
        const parsed = new URL(url)
        if((parsed.searchParams.get('type') || '').toLowerCase() !== 'profile') return false
        if(!needle) return true
        return url.toLowerCase().includes(needle)
    }
    catch {
        return false
    }
}

async function readButton(target) {
    return await evaluate(target.webSocketDebuggerUrl, `(${function buttonState() {
        const button = document.querySelector('.mb-ext_profile-search-collect-btn')
        const nukeButton = document.querySelector('.mb-ext_profile-search-nuke-btn')
        return {
            found: !!button,
            text: button ? (button.textContent || '').trim() : '',
            disabled: button ? button.disabled === true : false,
            nukeText: nukeButton ? (nukeButton.textContent || '').trim() : '',
            scrollY: Math.round(window.scrollY || document.documentElement.scrollTop || 0),
            scrollHeight: Math.round(document.documentElement.scrollHeight || document.body?.scrollHeight || 0),
            visibleProfileLinks: Array.from(document.querySelectorAll('a[href*="/profile/"]'))
                .map(link => link.href)
                .filter(Boolean)
                .slice(0, 20)
        }
    }})()`, 10000)
}

function isSettled(state, previousText) {
    const text = state?.text || ''
    if(!state?.found) return true
    if(/No new candidates|Nothing queued|Stopped/i.test(text)) return true
    if(/Nuking\s+\d+/i.test(text)) return true
    if(/Collect\s+\d+\s+More/i.test(text) && previousText && /Collecting/i.test(previousText)) return true
    return false
}

runMain(async () => {
    const config = getCdpConfig()
    const needle = getOption('needle', process.env.MB_SEARCH_NEEDLE || '').toLowerCase()
    const timeoutMs = Number.parseInt(getOption('timeout-ms', '180000'), 10) || 180000
    const targets = await getTargets(config)
    const target = targets.find(candidate => isProfileSearchTarget(candidate, needle))

    if(!target) {
        console.log(JSON.stringify({
            ok: false,
            reason: 'profile-search-target-not-found',
            needle
        }, null, 2))
        process.exitCode = 1
        return
    }

    const before = await readButton(target)
    if(!before.found) {
        console.log(JSON.stringify({
            ok: false,
            reason: 'collect-button-not-found',
            target: {id: target.id, title: target.title || '', url: target.url || ''},
            before
        }, null, 2))
        process.exitCode = 1
        return
    }

    const clicked = await evaluate(target.webSocketDebuggerUrl, `(${function clickCollectButton() {
        const button = document.querySelector('.mb-ext_profile-search-collect-btn')
        if(!button) return {clicked: false, reason: 'collect-button-not-found'}
        button.scrollIntoView({block: 'center', inline: 'nearest'})
        button.click()
        return {
            clicked: true,
            text: (button.textContent || '').trim(),
            scrollY: Math.round(window.scrollY || document.documentElement.scrollTop || 0)
        }
    }})()`, 10000)

    const startedAt = Date.now()
    const samples = []
    let previousText = before.text || ''
    let finalState = null

    while(Date.now() - startedAt < timeoutMs) {
        await sleep(1500)
        const state = await readButton(target)
        samples.push({
            text: state.text || '',
            nukeText: state.nukeText || '',
            scrollY: state.scrollY || 0,
            scrollHeight: state.scrollHeight || 0
        })
        if(samples.length > 12) samples.shift()
        if(isSettled(state, previousText)) {
            finalState = state
            break
        }
        previousText = state.text || previousText
    }

    if(!finalState) finalState = await readButton(target)

    console.log(JSON.stringify({
        ok: !!clicked.clicked && !/No new candidates/i.test(finalState?.text || ''),
        target: {id: target.id, title: target.title || '', url: target.url || ''},
        before,
        clicked,
        finalState,
        samples,
        elapsedMs: Date.now() - startedAt,
        timedOut: Date.now() - startedAt >= timeoutMs
    }, null, 2))
})
