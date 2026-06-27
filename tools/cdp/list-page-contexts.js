#!/usr/bin/env node

const {
    getCdpConfig,
    getOption,
    getTargets,
    runMain,
    sleep
} = require('./lib/cdp')

function targetMatches(target, needle) {
    if(target.type !== 'page') return false
    if(!needle) return /^https:\/\/www\.quora\.com\//i.test(target.url || '')
    return [target.url || '', target.title || ''].join('\n').toLowerCase().includes(needle.toLowerCase())
}

function connect(wsUrl, timeoutMs = 5000) {
    return new Promise((resolve, reject) => {
        const ws = new WebSocket(wsUrl)
        let settled = false
        const timeout = setTimeout(() => {
            if(settled) return
            settled = true
            try { ws.close(1000, 'list-contexts-connect-timeout') } catch {}
            reject(new Error(`WebSocket timeout opening ${wsUrl}`))
        }, timeoutMs)
        ws.addEventListener('open', () => {
            if(settled) return
            settled = true
            clearTimeout(timeout)
            resolve(ws)
        }, {once: true})
        ws.addEventListener('error', event => {
            if(settled) return
            settled = true
            clearTimeout(timeout)
            reject(event.error || new Error(`WebSocket error for ${wsUrl}`))
        }, {once: true})
    })
}

runMain(async () => {
    const config = getCdpConfig()
    const needle = getOption('needle', '')
    const targets = await getTargets(config)
    const target = targets.find(candidate => targetMatches(candidate, needle))
    if(!target) {
        console.log(JSON.stringify({ok: false, reason: 'page-target-not-found', needle}, null, 2))
        process.exitCode = 1
        return
    }

    const ws = await connect(target.webSocketDebuggerUrl)
    const contexts = []
    let nextId = 1
    const pending = new Map()

    const send = (method, params = {}, timeoutMs = 5000) => {
        const id = nextId++
        ws.send(JSON.stringify({id, method, params}))
        return new Promise((resolve, reject) => {
            const timeout = setTimeout(() => {
                pending.delete(id)
                reject(new Error(`${method} timed out after ${timeoutMs}ms`))
            }, timeoutMs)
            pending.set(id, {resolve, reject, timeout})
        })
    }

    ws.addEventListener('message', event => {
        const message = JSON.parse(event.data)
        if(message.method === 'Runtime.executionContextCreated') {
            contexts.push(message.params?.context || {})
            return
        }
        if(message.id && pending.has(message.id)) {
            const pendingCommand = pending.get(message.id)
            pending.delete(message.id)
            clearTimeout(pendingCommand.timeout)
            if(message.error) pendingCommand.reject(new Error(JSON.stringify(message.error)))
            else pendingCommand.resolve(message.result || {})
        }
    })

    try {
        await send('Runtime.enable')
        await sleep(Number.parseInt(getOption('wait-ms', '1000'), 10) || 1000)
        console.log(JSON.stringify({
            ok: true,
            target: {id: target.id, title: target.title || '', url: target.url || ''},
            contexts: contexts.map(context => ({
                id: context.id,
                origin: context.origin || '',
                name: context.name || '',
                type: context.auxData?.type || '',
                frameId: context.auxData?.frameId || '',
                isDefault: context.auxData?.isDefault === true
            }))
        }, null, 2))
    }
    finally {
        for(const pendingCommand of pending.values()) clearTimeout(pendingCommand.timeout)
        try { ws.close(1000, 'list-contexts-complete') } catch {}
    }
})
