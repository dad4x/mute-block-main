#!/usr/bin/env node

const {
    evaluate,
    getCdpConfig,
    getOption,
    getTargets,
    runMain
} = require('./lib/cdp')

runMain(async () => {
    const config = getCdpConfig()
    const needle = getOption('needle', process.env.MB_PROFILE_CLICK_NEEDLE || '').toLowerCase()
    const targets = await getTargets(config)
    const profilePages = targets.filter(target => {
        if(target.type !== 'page') return false
        if(!/^https:\/\/www\.quora\.com\/profile\//i.test(target.url || '')) return false
        if(!needle) return true
        return `${target.url || ''}\n${target.title || ''}`.toLowerCase().includes(needle)
    })
    const results = []

    for(const target of profilePages) {
        const result = await evaluate(target.webSocketDebuggerUrl, `(${function clickMuteBlockClose() {
            const buttons = Array.from(document.querySelectorAll('button'))
            const button = buttons.find(candidate => /Mute Block Close/i.test(candidate.textContent || '')) ||
                buttons.find(candidate => /Mute and block this profile, then close/i.test(candidate.getAttribute('aria-label') || ''))
            if(!button) {
                return {
                    clicked: false,
                    reason: 'button-not-found',
                    url: location.href,
                    title: document.title
                }
            }

            button.scrollIntoView({block: 'center', inline: 'nearest'})
            button.click()
            return {
                clicked: true,
                text: (button.textContent || '').trim(),
                url: location.href,
                title: document.title
            }
        }})()`, 10000)
        results.push({
            id: target.id,
            url: target.url || '',
            ...result
        })
    }

    console.log(JSON.stringify({matched: profilePages.length, results}, null, 2))
})
