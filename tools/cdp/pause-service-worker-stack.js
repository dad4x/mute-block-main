#!/usr/bin/env node

const {
    getCdpConfig,
    getTargets,
    runMain
} = require('./lib/cdp')

function connect(wsUrl, timeoutMs = 5000) {
    return new Promise((resolve, reject) => {
        const ws = new WebSocket(wsUrl)
        const timeout = setTimeout(() => {
            try { ws.close() } catch {}
            reject(new Error(`WebSocket timeout opening ${wsUrl}`))
        }, timeoutMs)
        ws.addEventListener('open', () => {
            clearTimeout(timeout)
            resolve(ws)
        }, {once: true})
        ws.addEventListener('error', event => {
            clearTimeout(timeout)
            reject(event.error || new Error(`WebSocket error for ${wsUrl}`))
        }, {once: true})
    })
}

function sendCommand(ws, id, method, params = {}) {
    ws.send(JSON.stringify({id, method, params}))
}

runMain(async () => {
    const config = getCdpConfig()
    const targets = await getTargets(config)
    const serviceWorker = targets.find(target =>
        target.type === 'service_worker' && (target.url || '').includes(config.extensionId)
    )

    if(!serviceWorker) {
        console.log(JSON.stringify({serviceWorker: false}, null, 2))
        return
    }

    const ws = await connect(serviceWorker.webSocketDebuggerUrl)
    let nextId = 1
    const result = await new Promise((resolve, reject) => {
        const timeout = setTimeout(() => {
            try { ws.close() } catch {}
            reject(new Error('Debugger pause timed out'))
        }, 10000)

        ws.addEventListener('message', event => {
            const message = JSON.parse(event.data)
            if(message.method === 'Debugger.paused') {
                clearTimeout(timeout)
                resolve({
                    target: {
                        id: serviceWorker.id,
                        title: serviceWorker.title,
                        url: serviceWorker.url
                    },
                    reason: message.params?.reason || '',
                    callFrames: (message.params?.callFrames || []).map(frame => ({
                        functionName: frame.functionName || '(anonymous)',
                        url: frame.url || frame.location?.scriptId || '',
                        lineNumber: Number(frame.location?.lineNumber) + 1,
                        columnNumber: Number(frame.location?.columnNumber) + 1
                    }))
                })
            }
        })
        ws.addEventListener('error', event => {
            clearTimeout(timeout)
            reject(event.error || new Error('WebSocket error while pausing debugger'))
        }, {once: true})

        sendCommand(ws, nextId++, 'Debugger.enable')
        sendCommand(ws, nextId++, 'Debugger.pause')
    })

    try {
        sendCommand(ws, nextId++, 'Debugger.resume')
    }
    catch {}
    try { ws.close() } catch {}

    console.log(JSON.stringify(result, null, 2))
})
