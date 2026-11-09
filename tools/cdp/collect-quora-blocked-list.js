#!/usr/bin/env node

// Collects the signed-in viewer's Quora Blocked Users list (BlockedUsersListQuery). Read-only: it opens one background window on
// the chosen debug port, reads the list page by page with fetch() inside that page, and closes only the window it opened.
// It clicks nothing, types nothing, and changes no block state. The paging and retry logic lives in tools/quora-blocked-list-core.js.
//
// Progress: prints a line on start, each retry, each heartbeat while backing off, every 10 pages or 5 seconds, and at the end.
// Checkpoints: every 25 pages, so an interrupted run resumes from the saved cursor when run again with the same --checkpoint.
//
// Usage: node tools/cdp/collect-quora-blocked-list.js --port=9222 --out=<file> [--checkpoint=<file>] [--keep-window]
const fs = require('fs')
const path = require('path')
const {cdpCommand, evaluate, getCdpConfig, getJson, getOption, getTargets, runMain, sleep} = require('./lib/cdp')
const {collectBlockedList} = require('../quora-blocked-list-core')

const SETTINGS_URL = 'https://www.quora.com/settings/muting'
const HASH = 'd109684097d4a02dcc381030351f860f2744de62e2400a470b4deb1bcd154882'
const PAGE_SIZE = 10

function pageExpression(after) {
    return `(async () => {
        const formkey = window.ansFrontendGlobals?.earlySettings?.formkey || null
        if (!formkey) return {status: 0, error: 'no formkey on page'}
        const res = await fetch('https://www.quora.com/graphql/gql_POST?q=BlockedUsersListQuery', {method: 'POST', credentials: 'include',
            headers: {'Content-Type': 'application/json', 'Quora-Formkey': formkey},
            body: JSON.stringify({queryName: 'BlockedUsersListQuery', variables: {first: ${PAGE_SIZE}, after: ${JSON.stringify(after)}}, extensions: {hash: '${HASH}'}})})
        const text = await res.text()
        let json = null
        try { json = JSON.parse(text) } catch (e) { json = null }
        const conn = json?.data?.viewer?.userSettings?.mutingSettings?.blockedUsersList || null
        if (res.status !== 200 || !conn) return {status: res.status, error: 'no connection', head: text.slice(0, 80)}
        return {
            status: res.status,
            edges: (conn.edges || []).filter(e => e.node).map(e => ({uid: e.node.uid, url: e.node.profileUrl, name: e.node.names?.[0]?.fullName || null, blockedFlag: e.node.isBlockedByViewer})),
            hasNextPage: !!conn.pageInfo?.hasNextPage,
            endCursor: conn.pageInfo?.endCursor ?? null
        }
    })()`
}

const identityExpression = `(() => ({
    avatars: Array.from(document.querySelectorAll('img[alt]')).map(i => i.alt).filter(a => /profile photo/i.test(a)).slice(0, 2),
    ready: document.readyState
}))()`

async function waitForPage(config, targetId) {
    for (let i = 0; i < 80; i += 1) {
        await sleep(500)
        const page = (await getTargets(config)).find(t => t.id === targetId)
        if (page) return page
    }
    return null
}

const stamp = () => new Date().toTimeString().slice(0, 8)

runMain(async () => {
    const config = getCdpConfig()
    const out = getOption('out', '')
    if (!out) throw new Error('usage: --out=<file> is required')
    const checkpointPath = getOption('checkpoint', out + '.checkpoint.json')
    const keepWindow = process.argv.includes('--keep-window')

    const version = await getJson('/json/version', config)
    const created = await cdpCommand(version.webSocketDebuggerUrl, 'Target.createTarget', {url: SETTINGS_URL, background: true, newWindow: true})
    try {
        const page = await waitForPage(config, created.targetId)
        if (!page) throw new Error('collector window did not appear')
        for (let i = 0; i < 60; i += 1) {
            const ready = await evaluate(page.webSocketDebuggerUrl, identityExpression, 20000).catch(() => null)
            if (ready && ready.ready === 'complete') break
            await sleep(1000)
        }
        const identity = await evaluate(page.webSocketDebuggerUrl, identityExpression, 20000)
        const account = (identity.avatars || []).map(a => a.replace(/^Profile photo for /, ''))[0] || null
        if (!account) throw new Error('no account name on the settings page; not signed in?')

        let resume = null
        if (fs.existsSync(checkpointPath)) {
            const saved = JSON.parse(fs.readFileSync(checkpointPath, 'utf8'))
            if (saved.account === account && !saved.finished) resume = saved
        }

        let lastPrint = 0
        const onProgress = (event) => {
            const now = Date.now()
            const always = event.type === 'retry' || event.type === 'start' || event.type === 'resume' || event.type === 'done' || event.type === 'failed'
            const periodic = event.type === 'page' && event.pages % 10 === 0
            const heartbeat = event.type === 'waiting' && now - lastPrint >= 5000
            if (!always && !periodic && !heartbeat) return
            lastPrint = now
            const detail = event.type === 'retry' ? ` status=${event.status} wait=${event.waitMs / 1000}s ${event.error}` :
                event.type === 'waiting' ? ` ${event.secondsLeft}s to retry` :
                event.type === 'done' || event.type === 'failed' ? ` end=${event.end} ${Math.round(event.elapsedMs / 1000)}s` : ''
            console.log(`[${stamp()}] ${event.type.padEnd(7)} pages=${event.pages} rows=${event.rows} retries=${event.retries}${detail}`)
        }

        console.log(`[${stamp()}] account: ${account}${resume ? ` (resuming at ${resume.pages} pages)` : ''}`)
        const result = await collectBlockedList({
            fetchPage: after => evaluate(page.webSocketDebuggerUrl, pageExpression(after), 60000),
            sleep,
            saveCheckpoint: state => fs.writeFileSync(checkpointPath, JSON.stringify({account, ...state})),
        }, {resume, onProgress, pageSize: PAGE_SIZE})

        const finalResult = {
            account,
            collectedAt: new Date().toISOString(),
            hash: HASH,
            pageSize: PAGE_SIZE,
            end: result.end,
            pages: result.pages,
            rows: result.rows.length,
            distinctUids: result.distinctUids,
            duplicateRows: result.duplicateRows,
            notBlockedFlagRows: result.notBlockedFlagRows,
            retries: result.failures.length,
            failures: result.failures,
            list: result.rows
        }
        fs.mkdirSync(path.dirname(path.resolve(out)), {recursive: true})
        fs.writeFileSync(out, JSON.stringify(finalResult, null, 2))
        const {list, failures, ...summary} = finalResult
        console.log(JSON.stringify(summary, null, 2))
        if (result.end !== 'hasNextPage=false') process.exitCode = 1
    }
    finally {
        if (!keepWindow) await cdpCommand(version.webSocketDebuggerUrl, 'Target.closeTarget', {targetId: created.targetId}).catch(() => null)
    }
})
