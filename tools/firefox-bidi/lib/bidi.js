const DEFAULT_HOST = '127.0.0.1'
const DEFAULT_PORT = 9224
const DEFAULT_PATH = '/session'

function getOption(name, fallback = '') {
    const prefix = `--${name}=`
    const match = process.argv.find(arg => arg.startsWith(prefix))
    if(match) return match.slice(prefix.length)

    const index = process.argv.indexOf(`--${name}`)
    if(index >= 0 && process.argv[index + 1]) return process.argv[index + 1]

    return fallback
}

function getBidiConfig() {
    const explicitWs = getOption('ws', process.env.MB_FIREFOX_BIDI_WS || '')
    if(explicitWs) return {wsUrl: explicitWs}

    const host = getOption('host', process.env.MB_FIREFOX_BIDI_HOST || DEFAULT_HOST)
    const port = Number.parseInt(getOption('port', process.env.MB_FIREFOX_BIDI_PORT || `${DEFAULT_PORT}`), 10) || DEFAULT_PORT
    const path = getOption('path', process.env.MB_FIREFOX_BIDI_PATH || DEFAULT_PATH)
    const connectTimeoutMs = Number.parseInt(
        getOption('connect-timeout-ms', process.env.MB_FIREFOX_BIDI_CONNECT_TIMEOUT_MS || '5000'),
        10
    ) || 5000
    return {host, port, path, connectTimeoutMs, wsUrl: `ws://${host}:${port}${path}`}
}

function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms))
}

class BidiClient {
    constructor(config = getBidiConfig()) {
        this.config = config
        this.ws = null
        this.nextId = 1
        this.pending = new Map()
        this.events = []
        this.sessionStarted = false
    }

    connect(timeoutMs = 5000) {
        if(this.ws) return Promise.resolve()

        return new Promise((resolve, reject) => {
            const ws = new WebSocket(this.config.wsUrl)
            const timeout = setTimeout(() => {
                try { ws.close() } catch {}
                reject(new Error(`WebSocket timeout opening ${this.config.wsUrl}`))
            }, timeoutMs)

            ws.addEventListener('open', () => {
                clearTimeout(timeout)
                this.ws = ws
                resolve()
            }, {once: true})

            ws.addEventListener('message', event => this.handleMessage(event.data))

            ws.addEventListener('error', event => {
                clearTimeout(timeout)
                const detail = event.error?.message || event.message || ''
                reject(new Error(`WebSocket error for ${this.config.wsUrl}${detail ? `: ${detail}` : ''}`))
            }, {once: true})
        })
    }

    handleMessage(data) {
        const message = JSON.parse(data.toString())
        if(message.id && this.pending.has(message.id)) {
            const {resolve, reject, timeout} = this.pending.get(message.id)
            clearTimeout(timeout)
            this.pending.delete(message.id)
            if(message.type === 'error' || message.error) {
                reject(new Error(formatBidiError(message)))
            }
            else {
                resolve(message)
            }
            return
        }

        this.events.push(message)
    }

    async send(method, params = {}, timeoutMs = 15000) {
        await this.connect()

        const id = this.nextId++
        const message = {id, method, params}
        return new Promise((resolve, reject) => {
            const timeout = setTimeout(() => {
                this.pending.delete(id)
                reject(new Error(`${method} timed out after ${timeoutMs}ms`))
            }, timeoutMs)
            this.pending.set(id, {resolve, reject, timeout})
            this.ws.send(JSON.stringify(message))
        })
    }

    async newSession(capabilities = {}) {
        const response = await this.send('session.new', {capabilities})
        this.sessionStarted = true
        return response.result || {}
    }

    async endSession() {
        if(!this.sessionStarted) return null
        try {
            const response = await this.send('session.end', {}, 5000)
            this.sessionStarted = false
            return response.result || {}
        }
        catch(error) {
            this.sessionStarted = false
            throw error
        }
    }

    close() {
        for(const [id, entry] of this.pending.entries()) {
            clearTimeout(entry.timeout)
            entry.reject(new Error(`WebSocket closed before response ${id}`))
        }
        this.pending.clear()
        if(this.ws) {
            try { this.ws.close() } catch {}
        }
        this.ws = null
    }
}

function formatBidiError(message = {}) {
    const parts = [
        message.error || message.type || 'BiDi error',
        message.message || ''
    ].filter(Boolean)
    return parts.join(': ')
}

function flattenContexts(contexts = [], depth = 0, result = []) {
    for(const context of contexts || []) {
        result.push({...context, depth})
        flattenContexts(context.children || [], depth + 1, result)
    }
    return result
}

async function withSession(main, options = {}) {
    const client = new BidiClient(options.config || getBidiConfig())
    try {
        await client.connect(options.connectTimeoutMs || client.config.connectTimeoutMs || 5000)
        const session = await client.newSession(options.capabilities || {})
        return await main(client, session)
    }
    finally {
        try {
            await client.endSession()
        }
        finally {
            client.close()
        }
    }
}

async function runMain(main) {
    try {
        await main()
    }
    catch(error) {
        console.error(JSON.stringify({
            error: error.message || String(error),
            stack: error.stack || ''
        }, null, 2))
        process.exit(1)
    }
}

module.exports = {
    BidiClient,
    DEFAULT_HOST,
    DEFAULT_PATH,
    DEFAULT_PORT,
    flattenContexts,
    getBidiConfig,
    getOption,
    runMain,
    sleep,
    withSession
}
