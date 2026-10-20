const http = require('http')
const path = require('path')

const DEFAULT_HOST = '127.0.0.1'
const DEFAULT_PORT = 9222
const DEFAULT_EXTENSION_ID = 'ajcjckiafbnhioeafaejlaehkmdcdeha'
const DEFAULT_CHROME_DEV_PATH = path.resolve(__dirname, '..', '..', '..', 'chrome-dev')

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
        extensionId: getOption('extension-id', process.env.MB_EXTENSION_ID || DEFAULT_EXTENSION_ID),
        extensionPath: getOption('extension-path', process.env.MB_EXTENSION_PATH || ''),
        extensionVersion: getOption('extension-version', process.env.MB_EXTENSION_VERSION || '')
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

function normalizeExtensionPath(value = '') {
    return `${value || ''}`
        .replace(/\\/g, '/')
        .replace(/\/+$/g, '')
        .toLowerCase()
}

async function openChromeExtensionsPage(config = getCdpConfig(), targets = null) {
    const currentTargets = targets || await getTargets(config)
    let extensionsPage = currentTargets.find(target => target.url === 'chrome://extensions/')
    if(extensionsPage) return extensionsPage

    const versionInfo = await getJson('/json/version', config)
    await cdpCommand(versionInfo.webSocketDebuggerUrl, 'Target.createTarget', {
        url: 'chrome://extensions/',
        background: true
    })
    await sleep(1500)
    extensionsPage = (await getTargets(config)).find(target => target.url === 'chrome://extensions/')
    if(extensionsPage) return extensionsPage

    await cdpCommand(versionInfo.webSocketDebuggerUrl, 'Target.createTarget', {
        url: 'chrome://extensions/'
    })
    await sleep(1500)
    return (await getTargets(config)).find(target => target.url === 'chrome://extensions/') || null
}

async function getInstalledExtensions(config = getCdpConfig(), extensionsPage = null) {
    const page = extensionsPage || await openChromeExtensionsPage(config)
    if(!page) throw new Error('chrome://extensions/ target not found')
    return evaluate(page.webSocketDebuggerUrl, `new Promise(resolve => {
        chrome.developerPrivate.getExtensionsInfo(info => resolve((info || []).map(item => ({
            id: item.id || '',
            name: item.name || '',
            version: item.version || '',
            location: item.location || '',
            state: item.state || '',
            path: item.path || '',
            updateUrl: item.updateUrl || '',
            webStoreUrl: item.webStoreUrl || '',
            manifestErrors: (item.manifestErrors || []).length,
            runtimeErrors: (item.runtimeErrors || []).length,
            installWarnings: (item.installWarnings || []).length
        }))))
    })`, 15000)
}

function extensionMatchesAutoCriteria(info = {}, config = {}) {
    if(!info || !info.id) return false
    if(info.location !== 'UNPACKED') return false
    if(!/^Mute Block(?: Dev)?$/i.test(info.name || '')) return false
    if(config.extensionVersion && info.version !== config.extensionVersion) return false

    const expectedPath = normalizeExtensionPath(config.extensionPath || '')
    if(expectedPath) {
        const actualPath = normalizeExtensionPath(info.path || '')
        if(actualPath !== expectedPath && !actualPath.endsWith(`/${path.posix.basename(expectedPath)}`)) return false
    }

    return true
}

async function resolveExtensionId(config = getCdpConfig(), options = {}) {
    if(config.extensionId && config.extensionId !== 'auto') return config.extensionId

    const normalizedConfig = {
        ...config,
        extensionPath: config.extensionPath || options.extensionPath || DEFAULT_CHROME_DEV_PATH,
        extensionVersion: config.extensionVersion || options.extensionVersion || ''
    }
    const extensions = await getInstalledExtensions(normalizedConfig)
    const matches = extensions.filter(info => extensionMatchesAutoCriteria(info, normalizedConfig))
    if(matches.length !== 1) {
        throw new Error(`auto extension discovery expected one unpacked Mute Block match, found ${matches.length}: ${JSON.stringify(matches.map(item => ({
            id: item.id,
            name: item.name,
            version: item.version,
            path: item.path,
            location: item.location,
            state: item.state
        })))}`)
    }
    return matches[0].id
}

async function resolveCdpConfig(config = getCdpConfig(), options = {}) {
    if(config.extensionId && config.extensionId !== 'auto') return config

    const extensionPath = config.extensionPath || options.extensionPath || DEFAULT_CHROME_DEV_PATH
    const extensionVersion = config.extensionVersion || options.extensionVersion || ''
    const extensionId = await resolveExtensionId({
        ...config,
        extensionPath,
        extensionVersion
    })
    return {
        ...config,
        extensionId,
        extensionPath,
        extensionVersion,
        extensionIdResolvedFrom: 'auto'
    }
}


function getWebSocketState(ws) {
    if(!ws) return -1
    if(typeof ws.readyState === 'number') return ws.readyState
    return -1
}

function safeCloseWebSocket(ws, reason = 'cleanup') {
    if(!ws) return false
    try {
        const noop = () => {}
        if(typeof ws.addEventListener === 'function') {
            ws.addEventListener('error', noop)
            ws.addEventListener('close', noop)
        }
        else if(typeof ws.on === 'function') {
            ws.on('error', noop)
            ws.on('close', noop)
        }
    }
    catch {}

    const state = getWebSocketState(ws)
    const openState = typeof WebSocket !== 'undefined' ? WebSocket.OPEN : 1
    const closingState = typeof WebSocket !== 'undefined' ? WebSocket.CLOSING : 2
    if(state !== openState && state !== closingState) return false

    try {
        ws.close(1000, `${reason || 'cleanup'}`.slice(0, 120))
        return true
    }
    catch {
        return false
    }
}

function websocketEventError(event, fallbackMessage) {
    const error = event?.error
    if(error?.message) return new Error(error.message)
    if(error) return new Error(`${error}`)
    return new Error(fallbackMessage)
}

function isTransientWebSocketError(error) {
    const message = `${error?.message || error || ''}`
    return /WebSocket.*(?:closed|close|socket|terminated|network|hang up)|terminated|ECONNRESET|UND_ERR|TypeError/i.test(message)
}

function connect(wsUrl, timeoutMs = 5000) {
    return new Promise((resolve, reject) => {
        const ws = new WebSocket(wsUrl)
        let settled = false
        const finishReject = error => {
            if(settled) return
            settled = true
            clearTimeout(timeout)
            reject(error)
        }
        const timeout = setTimeout(() => {
            finishReject(new Error(`WebSocket timeout opening ${wsUrl}`))
            safeCloseWebSocket(ws, 'connect-timeout')
        }, timeoutMs)
        ws.addEventListener('open', () => {
            if(settled) {
                safeCloseWebSocket(ws, 'late-open-after-connect-timeout')
                return
            }
            settled = true
            clearTimeout(timeout)
            resolve(ws)
        }, {once: true})
        ws.addEventListener('error', event => {
            finishReject(websocketEventError(event, `WebSocket error for ${wsUrl}`))
        }, {once: true})
        ws.addEventListener('close', () => {
            finishReject(new Error(`WebSocket closed before opening ${wsUrl}`))
        }, {once: true})
    })
}

async function cdpCommand(wsUrl, method, params = {}, timeoutMs = 15000) {
    let lastError = null
    for(let attempt = 0; attempt < 2; attempt += 1) {
        const ws = await connect(wsUrl).catch(error => {
            lastError = error
            return null
        })
        if(!ws) {
            if(attempt === 0 && isTransientWebSocketError(lastError)) {
                await sleep(250)
                continue
            }
            throw lastError
        }
        try {
            return await new Promise((resolve, reject) => {
                const id = 1
                let settled = false
                const timeout = setTimeout(() => {
                    safeCloseWebSocket(ws, 'cdp-command-timeout')
                    finish(new Error(`${method} timed out after ${timeoutMs}ms`))
                }, timeoutMs)
                const finish = (error, value) => {
                    if(settled) return
                    settled = true
                    clearTimeout(timeout)
                    if(error) reject(error)
                    else resolve(value)
                }
                ws.addEventListener('message', event => {
                    const message = JSON.parse(event.data)
                    if(message.id !== id) return
                    if(message.error) finish(new Error(JSON.stringify(message.error)))
                    else finish(null, message.result || {})
                    safeCloseWebSocket(ws, 'cdp-command-complete')
                })
                ws.addEventListener('error', event => {
                    finish(websocketEventError(event, `WebSocket error during ${method}`))
                }, {once: true})
                ws.addEventListener('close', () => {
                    finish(new Error(`WebSocket closed during ${method}`))
                }, {once: true})
                try {
                    ws.send(JSON.stringify({id, method, params}))
                }
                catch(error) {
                    finish(error)
                }
            })
        }
        catch(error) {
            lastError = error
            if(attempt === 0 && isTransientWebSocketError(error)) {
                await sleep(250)
                continue
            }
            throw error
        }
        finally {
            safeCloseWebSocket(ws, 'cdp-command-cleanup')
        }
    }
    throw lastError || new Error(`${method} failed`)
}

async function evaluate(wsUrl, expression, timeoutMs = 20000) {
    let lastError = null
    for(let attempt = 0; attempt < 2; attempt += 1) {
        const ws = await connect(wsUrl).catch(error => {
            lastError = error
            return null
        })
        if(!ws) {
            if(attempt === 0 && isTransientWebSocketError(lastError)) {
                await sleep(250)
                continue
            }
            throw lastError
        }
        try {
            return await new Promise((resolve, reject) => {
                const id = 1
                let settled = false
                const timeout = setTimeout(() => {
                    safeCloseWebSocket(ws, 'evaluate-timeout')
                    finish(new Error(`Runtime.evaluate timed out after ${timeoutMs}ms`))
                }, timeoutMs)
                const finish = (error, value) => {
                    if(settled) return
                    settled = true
                    clearTimeout(timeout)
                    if(error) reject(error)
                    else resolve(value)
                }
                ws.addEventListener('message', event => {
                    const message = JSON.parse(event.data)
                    if(message.id !== id) return
                    if(message.error) finish(new Error(JSON.stringify(message.error)))
                    else if(message.result?.exceptionDetails) finish(new Error(JSON.stringify(message.result.exceptionDetails)))
                    else finish(null, message.result?.result?.value)
                    safeCloseWebSocket(ws, 'evaluate-complete')
                })
                ws.addEventListener('error', event => {
                    finish(websocketEventError(event, 'WebSocket error during Runtime.evaluate'))
                }, {once: true})
                ws.addEventListener('close', () => {
                    finish(new Error('WebSocket closed during Runtime.evaluate'))
                }, {once: true})
                try {
                    ws.send(JSON.stringify({
                        id,
                        method: 'Runtime.evaluate',
                        params: {expression, awaitPromise: true, returnByValue: true}
                    }))
                }
                catch(error) {
                    finish(error)
                }
            })
        }
        catch(error) {
            lastError = error
            if(attempt === 0 && isTransientWebSocketError(error)) {
                await sleep(250)
                continue
            }
            throw error
        }
        finally {
            safeCloseWebSocket(ws, 'evaluate-cleanup')
        }
    }
    throw lastError || new Error('Runtime.evaluate failed')
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

// The worker's message, sent from an extension page (decision 32, route a). The worker cannot message itself, so the message goes from
// an extension page: the first one in the target list, or a coordinator page opened in the background when none is open.
async function sendFromExtensionPage(config, message) {
    const extensionPrefix = `chrome-extension://${config.extensionId}/`
    const findExtensionPage = targets => targets.find(target => target.type === 'page' && (target.url || '').startsWith(extensionPrefix))
    let page = findExtensionPage(await getTargets(config))
    if(!page) {
        const versionInfo = await getJson('/json/version', config)
        await cdpCommand(versionInfo.webSocketDebuggerUrl, 'Target.createTarget', {
            url: `${extensionPrefix}coordinator.html`,
            background: true
        }, 10000)
        page = findExtensionPage(await getTargets(config))
    }
    if(!page) throw new Error('no extension page is open to send the message from')
    const reply = await evaluate(page.webSocketDebuggerUrl, `chrome.runtime.sendMessage(${JSON.stringify(message)})`, 20000)
    if(!reply || typeof reply !== 'object') throw new Error(`the worker did not answer ${message.action}`)
    return reply
}

// The profile progress, read through the worker. Resolves to the records keyed by profile href, the shape the progress view's records had.
async function readProfileNukeProgressFromWorker(config = getCdpConfig()) {
    const reply = await sendFromExtensionPage(config, {action: 'get-profile-nuke-progress'})
    return reply.profileNukeProgress && typeof reply.profileNukeProgress === 'object' ? reply.profileNukeProgress : {}
}

// The worker's clear of the whole progress (20 Oct review). Resolves to {cleared, saved, reason}.
async function clearProfileNukeProgressThroughWorker(config = getCdpConfig()) {
    return sendFromExtensionPage(config, {action: 'clear-profile-nuke-progress'})
}

module.exports = {
    DEFAULT_EXTENSION_ID,
    DEFAULT_CHROME_DEV_PATH,
    cdpCommand,
    cdpGet,
    clearProfileNukeProgressThroughWorker,
    evaluate,
    getCdpConfig,
    getInstalledExtensions,
    getJson,
    getOption,
    getTargets,
    isSpacePageTarget,
    jsString,
    openChromeExtensionsPage,
    readProfileNukeProgressFromWorker,
    resolveCdpConfig,
    resolveExtensionId,
    runMain,
    sleep,
    spaceKeyFromUrl
}
