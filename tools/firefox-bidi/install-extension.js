const path = require('path')

const {
    getBidiConfig,
    getOption,
    runMain,
    withSession
} = require('./lib/bidi')

runMain(async () => {
    const config = getBidiConfig()
    const extensionPath = path.resolve(getOption('path', 'firefox'))

    const result = await withSession(async client => {
        const install = await client.send('webExtension.install', {
            extensionData: {
                type: 'path',
                path: extensionPath
            }
        }, 30000)

        return {
            endpoint: config.wsUrl,
            extensionPath,
            result: install.result || install
        }
    }, {config})

    console.log(JSON.stringify(result, null, 2))
})
