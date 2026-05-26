const {
    getBidiConfig,
    getOption,
    runMain,
    withSession
} = require('./lib/bidi')

runMain(async () => {
    const config = getBidiConfig()
    const url = getOption('url', process.argv.find(arg => /^https?:\/\//i.test(arg)) || 'http://127.0.0.1:8765/')

    const result = await withSession(async client => {
        const create = await client.send('browsingContext.create', {
            type: 'tab'
        }, 10000)
        const context = create.result?.context
        if(!context) throw new Error('browsingContext.create did not return a context id')

        const navigate = await client.send('browsingContext.navigate', {
            context,
            url,
            wait: 'complete'
        }, 30000)

        return {
            endpoint: config.wsUrl,
            context,
            url,
            navigation: navigate.result || navigate
        }
    }, {config})

    console.log(JSON.stringify(result, null, 2))
})
