const http = require('http')

const DEFAULT_HOST = '127.0.0.1'
const DEFAULT_PORT = 9223
const DEFAULT_EXTENSION_ID = 'ajcjckiafbnhioeafaejlaehkmdcdeha'

function getOption(name, fallback = '') {
    const prefix = `--${name}=`
    const match = process.argv.find(arg => arg.startsWith(prefix))
    if(match) return match.slice(prefix.length)

    const index = process.argv.indexOf(`--${name}`)
    if(index >= 0 && process.argv[index + 1]) return process.argv[index + 1]

    return fallback
}

function getCdpConfig() {
    return {
        host: getOption('host', process.env.MB_CDP_HOST || DEFAULT_HOST),
        port: Number.parseInt(getOption('port', process.env.MB_CDP_PORT || DEFAULT_PORT), 10) || DEFAULT_PORT,
        extensionId: getOption('extension-id', process.env.MB_EXTENSION_ID || DEFAULT_EXTENSION_ID)
    }
}

function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms))
}

function cdpGet(path, config = getCdpConfig(), timeoutMs = 30000) {
    return new Promise((resolve, reject) => {
        const req = http.get({host: config.host, port: config.port, path, timeout: timeoutMs}, response => {
            let body = ''
            response.setEncoding('utf8')
            response.on('data', chunk => body += chunk)
            response.on('end', () => resolve(body))
        })
        req.on('timeout', () => req.destroy(new Error(`HTTP timeout for ${path}`)))
        req.on('error', reject)
    })
}

async function getJson(path, config = getCdpConfig(), timeoutMs = 30000) {
    return JSON.parse(await cdpGet(path, config, timeoutMs))
}

async function getTargets(config = getCdpConfig()) {
    return getJson('/json/list', config)
}

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

async function cdpCommand(wsUrl, method, params = {}, timeoutMs = 15000) {
    const ws = await connect(wsUrl)
    try {
        return await new Promise((resolve, reject) => {
            const id = 1
            const timeout = setTimeout(() => {
                try { ws.close() } catch {}
                reject(new Error(`${method} timed out after ${timeoutMs}ms`))
            }, timeoutMs)
            ws.addEventListener('message', event => {
                const message = JSON.parse(event.data)
                if(message.id !== id) return
                clearTimeout(timeout)
                if(message.error) reject(new Error(JSON.stringify(message.error)))
                else resolve(message.result || {})
                try { ws.close() } catch {}
            })
            ws.send(JSON.stringify({id, method, params}))
        })
    }
    finally {
        try { ws.close() } catch {}
    }
}

async function evaluate(wsUrl, expression, timeoutMs = 20000) {
    const ws = await connect(wsUrl)
    try {
        return await new Promise((resolve, reject) => {
            const id = 1
            const timeout = setTimeout(() => {
                try { ws.close() } catch {}
                reject(new Error(`Runtime.evaluate timed out after ${timeoutMs}ms`))
            }, timeoutMs)
            ws.addEventListener('message', event => {
                const message = JSON.parse(event.data)
                if(message.id !== id) return
                clearTimeout(timeout)
                if(message.error) reject(new Error(JSON.stringify(message.error)))
                else if(message.result?.exceptionDetails) reject(new Error(JSON.stringify(message.result.exceptionDetails)))
                else resolve(message.result?.result?.value)
                try { ws.close() } catch {}
            })
            ws.send(JSON.stringify({
                id,
                method: 'Runtime.evaluate',
                params: {expression, awaitPromise: true, returnByValue: true}
            }))
        })
    }
    finally {
        try { ws.close() } catch {}
    }
}

function jsString(value) {
    return JSON.stringify(`${value || ''}`)
}

function isSpacePageTarget(target = {}) {
    return target.type === 'page' && /^https:\/\/(?!www\.)[^/]+\.quora\.com\//i.test(target.url || '')
}

function spaceKeyFromUrl(url = '') {
    try {
        const parsed = new URL(url)
        if(!/\.quora\.com$/i.test(parsed.hostname) || /^www\./i.test(parsed.hostname)) return ''
        return `quora-space:${parsed.origin}`
    }
    catch {
        return ''
    }
}

async function runMain(main) {
    try {
        await main()
    }
    catch(error) {
        console.error(JSON.stringify({error: error.message, stack: error.stack}, null, 2))
        process.exit(1)
    }
}

module.exports = {
    DEFAULT_EXTENSION_ID,
    cdpCommand,
    cdpGet,
    evaluate,
    getCdpConfig,
    getJson,
    getOption,
    getTargets,
    isSpacePageTarget,
    jsString,
    runMain,
    sleep,
    spaceKeyFromUrl
}
