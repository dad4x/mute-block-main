const {
    getBidiConfig,
    getOption,
    runMain,
    withSession
} = require('./lib/bidi')
const {
    parseMblockBlocks
} = require('../../shared/js/sharedModeration')

async function openTab(client, url) {
    const create = await client.send('browsingContext.create', {type: 'tab'}, 10000)
    const context = create.result?.context
    if(!context) throw new Error('browsingContext.create did not return a context id')

    await client.send('browsingContext.navigate', {
        context,
        url,
        wait: 'complete'
    }, 30000)

    return context
}

function parseJsonResult(response, label) {
    const value = response.result?.result?.value
    if(typeof value !== 'string') {
        throw new Error(`${label} did not return a JSON string`)
    }
    return JSON.parse(value)
}

runMain(async () => {
    const config = getBidiConfig()
    const url = getOption('url', process.argv.find(arg => /^https?:\/\//i.test(arg)) || 'http://127.0.0.1:8765/space/shared-blocks')

    const result = await withSession(async client => {
        const context = await openTab(client, url)
        const extraction = await client.send('script.evaluate', {
            expression: `JSON.stringify((() => {
                return {
                    title: document.title,
                    href: location.href,
                    bodyText: document.body.innerText || '',
                    mockKind: document.querySelector('meta[name="mute-block-mock-quora"]')?.content || '',
                    spaceUrl: document.querySelector('meta[name="mute-block-space-url"]')?.content || '',
                    spaceSlug: document.querySelector('meta[name="mute-block-space-slug"]')?.content || ''
                }
            })())`,
            target: {context},
            awaitPromise: false,
            resultOwnership: 'none'
        }, 15000)

        const page = parseJsonResult(extraction, 'mblock extraction')
        const blocks = parseMblockBlocks(page.bodyText).map(block => ({
            version: block.version,
            ok: block.ok,
            error: block.error,
            document_id: block.document?.document_id || '',
            schema: block.document?.schema || '',
            event_count: Array.isArray(block.document?.events) ? block.document.events.length : 0,
            event_types: Array.isArray(block.document?.events) ? block.document.events.map(event => event.type || '') : []
        }))

        return {
            endpoint: config.wsUrl,
            url,
            title: page.title,
            href: page.href,
            mockKind: page.mockKind,
            spaceUrl: page.spaceUrl,
            spaceSlug: page.spaceSlug,
            block_count: blocks.length,
            blocks
        }
    }, {config})

    console.log(JSON.stringify(result, null, 2))
})
