const {
    flattenContexts,
    getBidiConfig,
    runMain,
    withSession
} = require('./lib/bidi')

function classifyUrl(url = '') {
    if(/^http:\/\/127\.0\.0\.1:\d+\/space\//i.test(url)) return 'mock-quora-space'
    if(/^http:\/\/127\.0\.0\.1:\d+\/composer\b/i.test(url)) return 'mock-quora-composer'
    if(/^https:\/\/www\.quora\.com\/profile\//i.test(url)) return 'quora-profile'
    if(/^https:\/\/(?!www\.)[^/]+\.quora\.com\//i.test(url)) return 'quora-space'
    if(/^moz-extension:\/\//i.test(url)) return 'extension'
    if(/^about:/i.test(url)) return 'about'
    if(!url) return 'blank'
    return 'other'
}

async function titleForContext(client, contextId) {
    try {
        const response = await client.send('script.evaluate', {
            expression: 'document.title',
            target: {context: contextId},
            awaitPromise: false,
            resultOwnership: 'none'
        }, 5000)
        return response.result?.result?.value || ''
    }
    catch(error) {
        return ''
    }
}

runMain(async () => {
    const config = getBidiConfig()
    const result = await withSession(async client => {
        const tree = await client.send('browsingContext.getTree', {}, 10000)
        const contexts = flattenContexts(tree.result?.contexts || [])
        const topLevel = contexts.filter(context => context.depth === 0)

        const pages = []
        for(const context of topLevel) {
            pages.push({
                context: context.context,
                userContext: context.userContext || '',
                url: context.url || '',
                type: classifyUrl(context.url || ''),
                title: await titleForContext(client, context.context),
                childCount: (context.children || []).length
            })
        }

        return {
            endpoint: config.wsUrl,
            totalContexts: contexts.length,
            topLevelCount: topLevel.length,
            counts: pages.reduce((counts, page) => {
                counts[page.type] = (counts[page.type] || 0) + 1
                return counts
            }, {}),
            pages
        }
    }, {config})

    console.log(JSON.stringify(result, null, 2))
})
