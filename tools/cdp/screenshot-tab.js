#!/usr/bin/env node

const fs = require('node:fs')
const path = require('node:path')
const {cdpCommand, getCdpConfig, getOption, getTargets, runMain} = require('./lib/cdp')

runMain(async () => {
    const needle = getOption('needle', '').toLowerCase()
    const outFile = getOption('out', path.resolve(__dirname, '..', '..', 'tmp', 'screenshot.png'))
    const targets = await getTargets(getCdpConfig())
    const pages = targets.filter(target => target.type === 'page')

    const target = needle
        ? pages.find(candidate => `${candidate.title || ''} ${candidate.url || ''}`.toLowerCase().includes(needle))
        : pages.find(candidate => candidate.url && !candidate.url.startsWith('chrome://') && !candidate.url.startsWith('chrome-extension://'))

    if(!target) {
        throw new Error(`no matching page target found${needle ? ` for needle "${needle}"` : ''}: ${JSON.stringify(pages.map(item => ({title: item.title, url: item.url})))}`)
    }

    await cdpCommand(target.webSocketDebuggerUrl, 'Page.enable', {})
    const {data} = await cdpCommand(target.webSocketDebuggerUrl, 'Page.captureScreenshot', {format: 'png', captureBeyondViewport: false})

    fs.mkdirSync(path.dirname(outFile), {recursive: true})
    fs.writeFileSync(outFile, Buffer.from(data, 'base64'))

    console.log(JSON.stringify({ok: true, matchedTarget: {title: target.title, url: target.url}, outFile}, null, 2))
})
