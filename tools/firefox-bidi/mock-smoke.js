const {
    getBidiConfig,
    getOption,
    runMain,
    sleep,
    withSession
} = require('./lib/bidi')

function parseJsonResult(response, label) {
    const value = response.result?.result?.value
    if(typeof value !== 'string') {
        throw new Error(`${label} did not return a JSON string`)
    }
    return JSON.parse(value)
}

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

async function evaluateJson(client, context, expression, label) {
    const response = await client.send('script.evaluate', {
        expression,
        target: {context},
        awaitPromise: true,
        resultOwnership: 'none'
    }, 15000)
    return parseJsonResult(response, label)
}

function assert(condition, message) {
    if(!condition) throw new Error(message)
}

runMain(async () => {
    const config = getBidiConfig()
    const baseUrl = getOption('base-url', process.env.MB_MOCK_QUORA_BASE_URL || 'http://127.0.0.1:8765')

    const result = await withSession(async client => {
        const sharedContext = await openTab(client, `${baseUrl}/space/shared-blocks`)
        const shared = await evaluateJson(client, sharedContext, `JSON.stringify((() => {
            const bodyText = document.body.innerText || ''
            const match = bodyText.match(/MBLOCK:BEGIN v=1\\s*([\\s\\S]*?)\\s*MBLOCK:END/)
            let parsed = null
            if(match) parsed = JSON.parse(match[1])
            return {
                title: document.title,
                mockKind: document.querySelector('meta[name="mute-block-mock-quora"]')?.content || '',
                spaceUrl: document.querySelector('meta[name="mute-block-space-url"]')?.content || '',
                spaceSlug: document.querySelector('meta[name="mute-block-space-slug"]')?.content || '',
                hasMblock: !!match,
                documentId: parsed && parsed.document_id,
                eventTypes: parsed ? parsed.events.map(event => event.type) : [],
                timestampCount: document.querySelectorAll('a.post_timestamp').length,
                composerCount: document.querySelectorAll('.puppeteer_test_tribe_composer').length,
                categoryButtons: Array.from(document.querySelectorAll('.mb-ext_space-category-btn')).map(button => button.textContent.trim())
            }
        })())`, 'shared-blocks inspection')

        assert(shared.mockKind === 'space', `unexpected mock kind ${shared.mockKind}`)
        assert(shared.spaceUrl === 'https://shared-blocks.quora.com/', `unexpected shared space URL ${shared.spaceUrl}`)
        assert(shared.spaceSlug === 'shared-blocks', `unexpected shared space slug ${shared.spaceSlug}`)
        assert(shared.hasMblock, 'shared-blocks page did not expose an MBLOCK block')
        assert(shared.documentId === 'mbj:mock:2026-05-18:001', `unexpected document id ${shared.documentId}`)
        assert(shared.eventTypes.includes('profile.block.add'), 'missing profile.block.add event')
        assert(shared.eventTypes.includes('space.classification.set'), 'missing space.classification.set event')
        assert(shared.timestampCount >= 1, 'missing post timestamp')
        assert(shared.composerCount >= 1, 'missing mock composer entry')
        assert(shared.categoryButtons.join('|') === 'Asset|Neutral|Target', 'unexpected category buttons')

        const composerContext = await openTab(client, `${baseUrl}/composer?space=muteblockdevelopment`)
        const postText = [
            'Harness BiDi mock post',
            '',
            'This verifies that Firefox BiDi can drive the mock composer.',
            '',
            'MBLOCK:BEGIN v=1',
            '{"schema":"com.muteblock.eventJournal","document_id":"mbj:mock:bidi-smoke"}',
            'MBLOCK:END'
        ].join('\\n')

        const click = await evaluateJson(client, composerContext, `JSON.stringify((() => {
            const textarea = document.querySelector('#post-body')
            const button = document.querySelector('#post-button')
            textarea.value = ${JSON.stringify(postText)}
            textarea.dispatchEvent(new InputEvent('input', {bubbles: true, inputType: 'insertText', data: ${JSON.stringify(postText)}}))
            button.click()
            return {
                clicked: true,
                valueLength: textarea.value.length
            }
        })())`, 'composer click')

        assert(click.clicked, 'mock composer click did not run')
        assert(click.valueLength === postText.length, 'mock composer textarea did not receive the full post')

        await sleep(1000)

        const posted = await evaluateJson(client, composerContext, `JSON.stringify((() => {
            return {
                href: location.href,
                bodyText: document.body.innerText || ''
            }
        })())`, 'composer post')

        assert(posted.bodyText.includes('Harness BiDi mock post'), 'posted mock content was not visible after composer submit')
        assert(posted.bodyText.includes('mbj:mock:bidi-smoke'), 'posted MBLOCK proof was not visible after composer submit')

        return {
            endpoint: config.wsUrl,
            baseUrl,
            shared,
            posted: {
                href: posted.href,
                sawTitle: posted.bodyText.includes('Harness BiDi mock post'),
                sawDocumentId: posted.bodyText.includes('mbj:mock:bidi-smoke')
            }
        }
    }, {config})

    console.log(JSON.stringify({ok: true, ...result}, null, 2))
})
