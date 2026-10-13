#!/usr/bin/env node

const {getCdpConfig, getTargets, runMain} = require('./lib/cdp')

runMain(async () => {
    const targets = await getTargets(getCdpConfig())
    const profilePages = targets.filter(target => target.type === 'page' && /^https:\/\/www\.quora\.com\/profile\//i.test(target.url || ''))
    const spacePages = targets.filter(target => target.type === 'page' && /^https:\/\/(?!www\.)[^/]+\.quora\.com\//i.test(target.url || ''))
    const challengeFrames = targets.filter(target => /challenges\.cloudflare\.com/i.test(target.url || ''))
    const extensionPages = targets.filter(target => target.type === 'page' && /^chrome-extension:\/\//i.test(target.url || ''))
    console.log(JSON.stringify({
        totalTargets: targets.length,
        profilePageCount: profilePages.length,
        profilePages: profilePages.slice(0, 80).map(target => ({
            id: target.id,
            title: target.title || '',
            url: target.url || ''
        })),
        spacePageCount: spacePages.length,
        spacePages: spacePages.map(target => ({
            id: target.id,
            title: target.title || '',
            url: target.url || ''
        })),
        challengeFrameCount: challengeFrames.length,
        extensionPages: extensionPages.map(target => ({
            id: target.id,
            title: target.title || '',
            url: target.url || ''
        }))
    }, null, 2))
})
